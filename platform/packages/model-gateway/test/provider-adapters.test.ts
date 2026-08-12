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

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};

const structuredRequest: ModelRequest = {
  ...request,
  requiredCapabilities: ['chat', 'structuredOutput'],
  responseContract: {
    type: 'json_schema',
    name: 'example_v1',
    schema,
  },
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

describe('structured output translation', () => {
  it('maps the generic schema contract to OpenAI Responses text.format', async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = createOpenAIAdapter({
      apiKey: 'x',
      client: {
        responses: {
          create: async (input: Record<string, unknown>) => {
            captured = input;
            return { output_text: '{"answer":"OpenAI structured"}' };
          },
        },
      } as never,
    });

    const result = await adapter.execute(structuredRequest);
    expect(adapter.route.capabilities.structuredOutput).toBe(true);
    expect(captured).toMatchObject({
      text: {
        format: {
          type: 'json_schema',
          name: 'example_v1',
          schema,
          strict: true,
        },
      },
    });
    expect(result.content).toBe('{"answer":"OpenAI structured"}');
  });

  it('maps the generic schema contract to Anthropic output_config.format', async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = createAnthropicAdapter({
      apiKey: 'x',
      client: {
        messages: {
          create: async (input: Record<string, unknown>) => {
            captured = input;
            return { content: [{ type: 'text', text: '{"answer":"Claude structured"}' }] };
          },
        },
      } as never,
    });

    const result = await adapter.execute(structuredRequest);
    expect(adapter.route.capabilities.structuredOutput).toBe(true);
    expect(captured).toMatchObject({
      output_config: {
        format: {
          type: 'json_schema',
          schema,
        },
      },
    });
    expect(result.content).toBe('{"answer":"Claude structured"}');
  });

  it('maps the generic schema contract to Gemini Interactions response_format', async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = createGeminiAdapter({
      apiKey: 'x',
      client: {
        interactions: {
          create: async (input: Record<string, unknown>) => {
            captured = input;
            return { output_text: '{"answer":"Gemini structured"}' };
          },
        },
      } as never,
    });

    const result = await adapter.execute(structuredRequest);
    expect(adapter.route.capabilities.structuredOutput).toBe(true);
    expect(captured).toMatchObject({
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema,
      },
    });
    expect(result.content).toBe('{"answer":"Gemini structured"}');
  });

  it('does not add structured-output fields to ordinary chat requests', async () => {
    let openAI: Record<string, unknown> | undefined;
    let anthropic: Record<string, unknown> | undefined;
    let google: Record<string, unknown> | undefined;

    await createOpenAIAdapter({
      apiKey: 'x',
      client: { responses: { create: async (input: Record<string, unknown>) => {
        openAI = input;
        return { output_text: 'plain' };
      } } } as never,
    }).execute(request);
    await createAnthropicAdapter({
      apiKey: 'x',
      client: { messages: { create: async (input: Record<string, unknown>) => {
        anthropic = input;
        return { content: [{ type: 'text', text: 'plain' }] };
      } } } as never,
    }).execute(request);
    await createGeminiAdapter({
      apiKey: 'x',
      client: { interactions: { create: async (input: Record<string, unknown>) => {
        google = input;
        return { output_text: 'plain' };
      } } } as never,
    }).execute(request);

    expect(openAI).not.toHaveProperty('text');
    expect(anthropic).not.toHaveProperty('output_config');
    expect(google).not.toHaveProperty('response_format');
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
