import { describe, expect, it } from 'vitest';
import {
  createOpenAICompatibleConnectionProviderAdapter,
  type OpenAICompatibleModelsClient,
} from '../src/openai-compatible-connection-provider.js';

const context = {
  connection: {
    id: 'connection-001',
    organisationId: 'org-001',
    ownership: 'organisation' as const,
    providerId: 'openrouter',
    connectionFamilyId: 'openrouter-api',
  },
  credential: { value: 'secret-api-key' },
};

function client(models: unknown[]): OpenAICompatibleModelsClient {
  return { models: { async list() { return { data: models }; } } };
}
describe('OpenAI-compatible connection provider adapter', () => {
  it('discovers model identities but grants no capabilities by protocol assumption', async () => {
    const adapter = createOpenAICompatibleConnectionProviderAdapter({
      id: 'openrouter-reference', baseURL: 'https://openrouter.ai/api/v1',
      createClient: () => client([
        { id: 'vendor/model-a', name: 'Model A' },
        { id: 'vendor/model-b' },
      ]),
    });

    const models = await adapter.discoverModels(context);
    expect(models).toEqual([
      {
        providerModelId: 'vendor/model-a', displayName: 'Model A', available: true,
        capabilities: {
          chat: false, tools: false, vision: false, files: false,
          mcp: false, localWorkspace: false, headless: false, structuredOutput: false,
        },
      },
      expect.objectContaining({ providerModelId: 'vendor/model-b', available: true }),
    ]);
  });
  it('requires an in-memory credential and never exposes it in discovery output', async () => {
    const seen: string[] = [];
    const adapter = createOpenAICompatibleConnectionProviderAdapter({
      id: 'compatible-provider', baseURL: 'https://models.example.test/v1',
      createClient: ({ apiKey }) => {
        seen.push(apiKey);
        return client([{ id: 'private/model' }]);
      },
    });

    await expect(adapter.discoverModels({ connection: context.connection }))
      .rejects.toThrow(/credential/i);
    const result = await adapter.discoverModels(context);
    expect(seen).toEqual(['secret-api-key']);
    expect(JSON.stringify(result)).not.toContain('secret-api-key');
    expect(JSON.stringify(result)).not.toMatch(/apiKey|secretRef|credential/i);
  });

  it('normalizes malformed catalogue entries fail-closed', async () => {
    const adapter = createOpenAICompatibleConnectionProviderAdapter({
      id: 'compatible-provider', baseURL: 'https://models.example.test/v1',
      createClient: () => client([{ id: '   ' }]),
    });
    await expect(adapter.discoverModels(context)).rejects.toThrow(/model/i);
  });
  it('bounds provider failures without leaking upstream detail or credentials', async () => {
    const adapter = createOpenAICompatibleConnectionProviderAdapter({
      id: 'compatible-provider', baseURL: 'https://models.example.test/v1',
      createClient: () => ({
        models: {
          async list() {
            throw new Error('upstream said secret-api-key is invalid');
          },
        },
      }),
    });

    try {
      await adapter.validateConnection(context);
      throw new Error('expected provider failure');
    } catch (error) {
      const message = String((error as Error).message);
      expect(message).toMatch(/provider connection unavailable/i);
      expect(message).not.toContain('secret-api-key');
      expect(message).not.toContain('upstream said');
    }
  });
});

describe('OpenAI-compatible connection-backed execution', () => {
  it('creates an exact chat adapter while clamping unsupported protocol capabilities', async () => {
    const calls: Record<string, unknown>[] = [];
    const provider = createOpenAICompatibleConnectionProviderAdapter({
      id: 'compatible-provider', baseURL: 'https://models.example.test/v1',
      createClient: () => ({
        models: { async list() { return { data: [] }; } },
        chat: { completions: { async create(input: Record<string, unknown>) {
          calls.push(input);
          return { choices: [{ message: { content: 'provider reply' } }] };
        } } },
      } as never),
    });
    const modelAdapter = await provider.createModelAdapter?.({
      context,
      route: {
        id: 'connection-route.exact', provider: 'openrouter', model: 'vendor/model-a',
        connection: { id: 'connection-001', ownerType: 'organisation', ownerId: 'org-001' },
        executionMode: 'api', costType: 'metered_api', available: true, priority: 50,
        capabilities: { chat: true, tools: true, vision: true, files: true,
          mcp: true, localWorkspace: true, headless: true, structuredOutput: true },
      },
    });
    expect(modelAdapter).toBeDefined();
    expect(modelAdapter?.route).toMatchObject({
      id: 'connection-route.exact', provider: 'openrouter', model: 'vendor/model-a',
      connection: { id: 'connection-001', ownerType: 'organisation', ownerId: 'org-001' },
      capabilities: {
        chat: true, headless: true, tools: false, vision: false,
        files: false, mcp: false, localWorkspace: false, structuredOutput: false,
      },
    });
    const result = await modelAdapter!.execute({
      taskId: 'task-001', role: 'engineer',
      messages: [{ role: 'user', content: 'hello' }],
      requiredCapabilities: ['chat'],
      routing: { subscriptionFirst: false, allowMeteredApi: true,
        preferredRouteId: 'connection-route.exact' },
    });
    expect(result.content).toBe('provider reply');
    expect(calls[0]).toMatchObject({ model: 'vendor/model-a' });
    expect(JSON.stringify(calls)).not.toContain('secret-api-key');
  });
});
