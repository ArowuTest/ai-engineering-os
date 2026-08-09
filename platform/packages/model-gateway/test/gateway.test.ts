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
    },
    ...overrides,
  };
}
function adapter(modelRoute: ModelRoute, content = modelRoute.id): ModelAdapter {
  return {
    route: modelRoute,
    async execute() {
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
  it('registers multiple execution routes for the same provider', () => {
    const gateway = new ModelGateway();    gateway.register(adapter(route()));
    gateway.register(
      adapter(
        route({
          id: 'anthropic-api',
          executionMode: 'api',
          costType: 'metered_api',
          localWorkspace: undefined,
          priority: 20,
        } as Partial<ModelRoute>),
      ),
    );

    expect(gateway.listRoutes('anthropic').map((item) => item.id)).toEqual([
      'claude-subscription',
      'anthropic-api',
    ]);
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
          },
        }),
      ),
    );

    const response = await gateway.execute(request({ requiredCapabilities: ['chat', 'vision'] }));
    expect(response.provider).toBe('google');
    expect(response.routeId).toBe('gemini-vision-subscription');
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

  it('uses priority to choose between equally eligible routes', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route({ id: 'subscription-slow', priority: 20 }), 'slow'));
    gateway.register(adapter(route({ id: 'subscription-preferred', priority: 5 }), 'preferred'));

    const response = await gateway.execute(request());
    expect(response.routeId).toBe('subscription-preferred');
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });
});
