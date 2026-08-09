import { describe, expect, it } from 'vitest';
import {
  ProviderExecutionError,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
  type ModelRequest,
} from '../src/index.js';

const request: ModelRequest = {
  taskId: 'product-turn-1',
  role: 'product_partner',
  messages: [
    { role: 'system', content: 'Act as a product strategist.' },
    { role: 'user', content: 'I want a PPV livestream product.' },
    { role: 'assistant', content: 'Who is the paying customer?' },
    { role: 'user', content: 'Consumers and telco bundles.' },
  ],
  requiredCapabilities: ['chat'],
  routing: { subscriptionFirst: false, allowMeteredApi: true },
};

describe('official API provider adapters', () => {
  it('translates a Product Partner request to OpenAI Responses and maps usage', async () => {
    let captured: unknown;
    const client = {
      responses: {
        create: async (input: unknown) => {
          captured = input;
          return {
            output_text: 'Clarify who owns the streaming rights.',
            usage: { input_tokens: 12, output_tokens: 7 },
          };
        },
      },
    };
    const adapter = createOpenAIAdapter({ apiKey: 'test-openai', client: client as never });
    const result = await adapter.execute(request);

    expect(adapter.route).toMatchObject({
      provider: 'openai', model: 'gpt-5.6', executionMode: 'api', costType: 'metered_api',
    });
    expect(captured).toMatchObject({ model: 'gpt-5.6' });
    expect(JSON.stringify(captured)).toContain('Act as a product strategist.');
    expect(JSON.stringify(captured)).toContain('Consumers and telco bundles.');
    expect(result).toEqual({
      content: 'Clarify who owns the streaming rights.',
      usage: { inputTokens: 12, outputTokens: 7 },
    });
  });

  it('translates history to Anthropic Messages and maps text usage', async () => {
    let captured: Record<string, unknown> | undefined;
    const client = {
      messages: {
        create: async (input: Record<string, unknown>) => {
          captured = input;
          return {
            content: [{ type: 'text', text: 'Define the entitlement rules.' }],
            usage: { input_tokens: 20, output_tokens: 8 },
          };
        },
      },
    };

    const adapter = createAnthropicAdapter({ apiKey: 'test-anthropic', client: client as never });
    const result = await adapter.execute(request);
    expect(adapter.route).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(captured?.system).toBe('Act as a product strategist.');
    expect(captured?.messages).toEqual([
      { role: 'user', content: 'I want a PPV livestream product.' },
      { role: 'assistant', content: 'Who is the paying customer?' },
      { role: 'user', content: 'Consumers and telco bundles.' },
    ]);
    expect(result).toEqual({ content: 'Define the entitlement rules.', usage: { inputTokens: 20, outputTokens: 8 } });
  });

  it('translates history to Gemini Interactions and maps text usage', async () => {
    let captured: Record<string, unknown> | undefined;
    const client = {
      interactions: {
        create: async (input: Record<string, unknown>) => {
          captured = input;
          return {
            output_text: 'Confirm the expected concurrent audience.',
            usage: { total_input_tokens: 30, total_output_tokens: 9 },
          };
        },
      },
    };

    const adapter = createGeminiAdapter({ apiKey: 'test-gemini', client: client as never });
    const result = await adapter.execute(request);
    expect(adapter.route).toMatchObject({ provider: 'google', model: 'gemini-3.6-flash' });
    expect(captured).toMatchObject({ model: 'gemini-3.6-flash' });
    expect(JSON.stringify(captured)).toContain('Act as a product strategist.');
    expect(JSON.stringify(captured)).toContain('Consumers and telco bundles.');
    expect(result).toEqual({
      content: 'Confirm the expected concurrent audience.',
      usage: { inputTokens: 30, outputTokens: 9 },
    });
  });

  it.each([
    ['openai', () => createOpenAIAdapter({ apiKey: 'x', client: { responses: { create: async () => ({ output_text: '   ' }) } } as never })],
    ['anthropic', () => createAnthropicAdapter({ apiKey: 'x', client: { messages: { create: async () => ({ content: [] }) } } as never })],
    ['google', () => createGeminiAdapter({ apiKey: 'x', client: { interactions: { create: async () => ({ output_text: '' }) } } as never })],
  ])('rejects blank %s output with a safe provider execution error', async (_provider, factory) => {
    await expect(factory().execute(request)).rejects.toBeInstanceOf(ProviderExecutionError);
  });
});

// Regression: exact optional fields must not be materialised as explicit undefined values.
describe('provider usage normalisation', () => {
  it('omits usage when OpenAI returns no token accounting', async () => {
    const adapter = createOpenAIAdapter({
      apiKey: 'x',
      client: {
        responses: { create: async () => ({ output_text: 'Ask about rights ownership.' }) },
      } as never,
    });

    await expect(adapter.execute(request)).resolves.toEqual({
      content: 'Ask about rights ownership.',
    });
  });
});
