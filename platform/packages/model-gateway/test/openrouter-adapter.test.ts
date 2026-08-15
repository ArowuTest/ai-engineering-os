import { describe, expect, it } from 'vitest';
import {
  ProviderExecutionError,
  createOpenRouterAdapter,
  openRouterRouteId,
  type ModelRequest,
} from '../src/index.js';

const request: ModelRequest = {
  taskId: 'review-1',
  role: 'reviewer',
  messages: [
    { role: 'system', content: 'Review the supplied change independently.' },
    { role: 'user', content: 'Find material correctness defects.' },
  ],
  requiredCapabilities: ['chat'],
  routing: { subscriptionFirst: false, allowMeteredApi: true },
};

describe('OpenRouter adapter', () => {
  it('creates deterministic collision-resistant route IDs from model slugs', () => {
    expect(openRouterRouteId('qwen/qwen3.5')).toBe(openRouterRouteId('qwen/qwen3.5'));
    expect(openRouterRouteId('qwen/qwen3.5')).toMatch(/^openrouter-[a-z0-9-]+$/);
    expect(openRouterRouteId('vendor/model-a')).not.toBe(openRouterRouteId('vendor-model/a'));
    expect(openRouterRouteId('Vendor/Model')).not.toBe(openRouterRouteId('vendor/model'));

    const prefix = `vendor/${'a'.repeat(90)}`;
    const first = openRouterRouteId(`${prefix}-one`);
    const second = openRouterRouteId(`${prefix}-two`);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(second.length).toBeLessThanOrEqual(64);
  });

  it('executes the exact configured model and maps text usage without leaking its key', async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = createOpenRouterAdapter({
      apiKey: 'openrouter-secret-value',
      model: 'qwen/qwen3.5',
      client: {
        chat: {
          completions: {
            create: async (input: Record<string, unknown>) => {
              captured = input;
              return {
                choices: [{ message: { content: '  Material finding.  ' } }],
                usage: { prompt_tokens: 19, completion_tokens: 6 },
              };
            },
          },
        },
      } as never,
    });

    const result = await adapter.execute(request);
    expect(adapter.route).toMatchObject({
      id: openRouterRouteId('qwen/qwen3.5'),
      provider: 'openrouter',
      model: 'qwen/qwen3.5',
      executionMode: 'api',
      costType: 'metered_api',
    });
    expect(adapter.route.capabilities.structuredOutput).toBe(false);
    expect(captured).toMatchObject({ model: 'qwen/qwen3.5' });
    expect(JSON.stringify(captured)).toContain('Review the supplied change independently.');
    expect(result).toEqual({
      content: 'Material finding.',
      usage: { inputTokens: 19, outputTokens: 6 },
    });
    const serialized = JSON.stringify({ route: adapter.route, result });
    expect(serialized).not.toContain('openrouter-secret-value');
  });

  it('normalizes provider failures and rejects blank provider output', async () => {
    const blank = createOpenRouterAdapter({
      apiKey: 'x',
      model: 'z-ai/glm-5',
      client: {
        chat: {
          completions: {
            create: async () => ({ choices: [{ message: { content: '  ' } }] }),
          },
        },
      } as never,
    });
    await expect(blank.execute(request)).rejects.toMatchObject({
      name: 'ProviderExecutionError',
      provider: 'openrouter',
    });

    const cause = new Error('upstream secret detail');
    const failed = createOpenRouterAdapter({
      apiKey: 'x',
      model: 'x-ai/grok-4',
      client: {
        chat: {
          completions: {
            create: async () => {
              throw cause;
            },
          },
        },
      } as never,
    });
    await expect(failed.execute(request)).rejects.toBeInstanceOf(ProviderExecutionError);
  });
});
