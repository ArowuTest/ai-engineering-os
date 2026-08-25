import { describe, expect, it } from 'vitest';
import {
  ModelGateway,
  NoEligibleRouteError,
  type ModelAdapter,
  type ModelRequest,
  type ModelRoute,
} from '../src/index.js';

function route(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    id: 'claude-subscription',
    provider: 'anthropic',
    model: 'claude',
    executionMode: 'subscription',
    costType: 'included_subscription',
    available: true,
    priority: 10,
    capabilities: {
      chat: true,
      tools: true,
      vision: false,
      files: true,
      mcp: true,
      localWorkspace: true,
      headless: true,
      structuredOutput: false,
    } as ModelRoute['capabilities'],
    ...overrides,
  };
}

function adapter(
  modelRoute: ModelRoute,
  content = modelRoute.id,
  execute?: ModelAdapter['execute'],
): ModelAdapter {
  return {
    route: modelRoute,
    async execute(request) {
      if (execute) return execute(request);
      return {
        content,
        usage: { inputTokens: 12, outputTokens: 7 },
      };
    },
  };
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    taskId: 'task-001',
    role: 'engineer',
    messages: [{ role: 'user', content: 'Implement the approved requirement.' }],
    requiredCapabilities: ['chat', 'tools'],
    routing: {
      subscriptionFirst: true,
      allowMeteredApi: true,
    },
    ...overrides,
  };
}

describe('ModelGateway', () => {
  it('registers multiple execution routes and models for the same provider', () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'anthropic-sonnet', model: 'claude-sonnet' })));
    gateway.register(
      adapter(
        route({
          id: 'anthropic-opus',
          model: 'claude-opus',
          executionMode: 'api',
          costType: 'metered_api',
          priority: 20,
        }),
      ),
    );

    expect(gateway.listRoutes('anthropic').map((item) => [item.id, item.model])).toEqual([
      ['anthropic-sonnet', 'claude-sonnet'],
      ['anthropic-opus', 'claude-opus'],
    ]);
  });

  it('executes an arbitrary valid future provider route', async () => {
    const gateway = new ModelGateway();
    gateway.register(
      adapter(
        route({
          id: 'future-provider-api',
          provider: 'future-provider' as ModelRoute['provider'],
          model: 'future-model-v1',
          executionMode: 'api',
          costType: 'metered_api',
        }),
        'future-result',
      ),
    );

    const response = await gateway.execute(request({ routing: { subscriptionFirst: false, allowMeteredApi: true } }));
    expect(response.provider).toBe('future-provider');
    expect(response.routeId).toBe('future-provider-api');
    expect(response.model).toBe('future-model-v1');
    expect(response.content).toBe('future-result');
  });

  it('rejects duplicate route identifiers even across different models', () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'shared-route', model: 'model-a' })));

    expect(() =>
      gateway.register(
        adapter(
          route({
            id: 'shared-route',
            provider: 'openai',
            model: 'model-b',
          }),
        ),
      ),
    ).toThrow('model route already registered: shared-route');
  });

  it.each([
    [{ id: '' }, 'route id'],
    [{ id: 'Bad Route' }, 'route id'],
    [{ provider: 'auto' as ModelRoute['provider'] }, 'provider'],
    [{ provider: 'OpenAI' as ModelRoute['provider'] }, 'provider'],
    [{ provider: 'bad provider' as ModelRoute['provider'] }, 'provider'],
    [{ model: '   ' }, 'model'],
  ])('rejects invalid route registration %#', (overrides, expectedField) => {
    const gateway = new ModelGateway();
    expect(() => gateway.register(adapter(route(overrides)))).toThrow(expectedField);
  });

  it('prefers an eligible subscription route over a metered API route', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route(), 'subscription-result'));
    gateway.register(
      adapter(
        route({ id: 'anthropic-api', executionMode: 'api', costType: 'metered_api', priority: 1 }),
        'api-result',
      ),
    );

    const response = await gateway.execute(request());
    expect(response.content).toBe('subscription-result');
    expect(response.provider).toBe('anthropic');
    expect(response.routeId).toBe('claude-subscription');
    expect(response.costType).toBe('included_subscription');
  });

  it('falls back to an API route when subscription execution is unavailable', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ available: false }), 'unavailable'));
    gateway.register(
      adapter(
        route({ id: 'anthropic-api', executionMode: 'api', costType: 'metered_api' }),
        'api-result',
      ),
    );

    const response = await gateway.execute(request());
    expect(response.routeId).toBe('anthropic-api');
    expect(response.content).toBe('api-result');
  });

  it('selects only routes that satisfy every required capability', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route()));
    gateway.register(
      adapter(
        route({
          id: 'gemini-vision-subscription',
          provider: 'google',
          model: 'gemini',
          capabilities: {
            chat: true,
            tools: true,
            vision: true,
            files: true,
            mcp: true,
            localWorkspace: true,
            headless: true,
            structuredOutput: false,
          } as ModelRoute['capabilities'],
        }),
      ),
    );

    const response = await gateway.execute(request({ requiredCapabilities: ['chat', 'vision'] }));
    expect(response.provider).toBe('google');
    expect(response.routeId).toBe('gemini-vision-subscription');
  });

  it('keeps ordinary chat eligible when structured output is not required', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'plain-chat' }), 'plain-chat-result'));

    const response = await gateway.execute(
      request({ requiredCapabilities: ['chat'] }),
    );
    expect(response.routeId).toBe('plain-chat');
  });

  it('requires a route that explicitly advertises structured output', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'plain-chat', priority: 1 })));
    gateway.register(
      adapter(
        route({
          id: 'structured-chat',
          priority: 50,
          capabilities: {
            ...route().capabilities,
            structuredOutput: true,
          } as ModelRoute['capabilities'],
        }),
        'structured-result',
      ),
    );

    const response = await gateway.execute(
      request({
        requiredCapabilities: ['chat', 'structuredOutput' as never],
      }),
    );
    expect(response.routeId).toBe('structured-chat');
    expect(response.content).toBe('structured-result');
  });

  it('does not infer structured-output eligibility merely because a response contract exists', async () => {
    const gateway = new ModelGateway();
    let captured: ModelRequest | undefined;
    gateway.register(
      adapter(route({ id: 'plain-chat' }), 'plain', async (modelRequest) => {
        captured = modelRequest;
        return { content: 'plain' };
      }),
    );

    const withContract = {
      ...request({ requiredCapabilities: ['chat'] }),
      responseContract: {
        type: 'json_schema',
        name: 'example_v1',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    } as ModelRequest;

    await gateway.execute(withContract);
    expect(captured).toBe(withContract);
  });

  it('refuses metered API routes when policy disables them', async () => {
    const gateway = new ModelGateway();
    gateway.register(
      adapter(route({ id: 'openai-api', provider: 'openai', executionMode: 'api', costType: 'metered_api' })),
    );

    await expect(
      gateway.execute(
        request({
          routing: { subscriptionFirst: true, allowMeteredApi: false },
        }),
      ),
    ).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  it('honours an explicit eligible route instead of silently re-ranking to another model', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'subscription-priority', priority: 1 }), 'priority'));
    gateway.register(adapter(route({ id: 'subscription-explicit', priority: 50 }), 'explicit'));

    const response = await gateway.execute(request({
      routing: {
        subscriptionFirst: true,
        allowMeteredApi: true,
        preferredRouteId: 'subscription-explicit',
      },
    }));
    expect(response.routeId).toBe('subscription-explicit');
    expect(response.content).toBe('explicit');
  });

  it('fails closed when an explicit route is unavailable instead of falling back', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'subscription-fallback', priority: 1 }), 'fallback'));
    gateway.register(adapter(route({ id: 'subscription-explicit', available: false }), 'unavailable'));

    await expect(gateway.execute(request({
      routing: {
        subscriptionFirst: true,
        allowMeteredApi: true,
        preferredRouteId: 'subscription-explicit',
      },
    }))).rejects.toBeInstanceOf(NoEligibleRouteError);
  });
  it('preserves connection provenance when the same model is available through distinct routes', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({
      id: 'openrouter-deepseek', provider: 'openrouter', model: 'deepseek-v4',
      connection: { id: 'connection-openrouter', ownerType: 'user', ownerId: 'user-001' },
    }), 'openrouter'));
    gateway.register(adapter(route({
      id: 'together-deepseek', provider: 'together', model: 'deepseek-v4',
      connection: { id: 'connection-together', ownerType: 'organisation', ownerId: 'org-001' },
    }), 'together'));

    const response = await gateway.execute(request({ routing: {
      subscriptionFirst: false, allowMeteredApi: true, preferredRouteId: 'together-deepseek',
    } }));
    expect(response.routeId).toBe('together-deepseek');
    expect(response.connection).toEqual({
      id: 'connection-together', ownerType: 'organisation', ownerId: 'org-001',
    });
  });

  it('rejects malformed connection provenance on route registration', () => {
    const gateway = new ModelGateway();
    expect(() => gateway.register(adapter(route({
      id: 'bad-connection-route',
      connection: { id: 'Bad Connection', ownerType: 'user', ownerId: 'user-001' },
    })))).toThrow(/connection id/i);
  });

  it('uses priority to choose between equally eligible routes', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'subscription-slow', priority: 20 }), 'slow'));
    gateway.register(adapter(route({ id: 'subscription-preferred', priority: 5 }), 'preferred'));

    const response = await gateway.execute(request());
    expect(response.routeId).toBe('subscription-preferred');
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });
});

describe('ModelGateway dynamic exact-route resolution', () => {
  it('resolves an unregistered preferred route only through the execution-scoped resolver', async () => {
    const gateway = new ModelGateway();
    const calls: string[] = [];
    const resolver = async (routeId: string) => {
      calls.push(routeId);
      return routeId === 'connection-route.dynamic'
        ? adapter(route({ id: routeId, provider: 'future-provider', model: 'future/model' }), 'dynamic')
        : null;
    };
    const response = await gateway.execute(request({ routing: {
      subscriptionFirst: false, allowMeteredApi: true, preferredRouteId: 'connection-route.dynamic',
    } }), { dynamicAdapterResolver: resolver });
    expect(calls).toEqual(['connection-route.dynamic']);
    expect(response.routeId).toBe('connection-route.dynamic');
    await expect(gateway.execute(request({ routing: {
      subscriptionFirst: false, allowMeteredApi: true, preferredRouteId: 'connection-route.dynamic',
    } }))).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  it('does not let an execution-scoped resolver substitute a different route identity', async () => {
    const gateway = new ModelGateway();
    await expect(gateway.execute(request({ routing: {
      subscriptionFirst: false, allowMeteredApi: true, preferredRouteId: 'connection-route.requested',
    } }), { dynamicAdapterResolver: async () =>
      adapter(route({ id: 'connection-route.other', provider: 'future-provider' }), 'wrong')
    })).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  it('does not consult dynamic routes for an unpinned Auto request', async () => {
    const gateway = new ModelGateway();
    let calls = 0;
    gateway.register(adapter(route({ id: 'static-route' }), 'static'));
    const response = await gateway.execute(request(), {
      dynamicAdapterResolver: async () => { calls += 1; return null; },
    });
    expect(response.routeId).toBe('static-route');
    expect(calls).toBe(0);
  });
});
