import { describe, expect, it } from 'vitest';
import {
  createAIConnectionProviderAdapterRegistry,
  type AIConnectionProviderAdapter,
  type AIConnectionProviderContext,
} from '../src/ai-connection-provider-adapter.js';

const context: AIConnectionProviderContext = {
  connection: {
    id: 'connection-001', organisationId: 'org-001', ownership: 'personal',
    ownerUserId: 'user-001', providerId: 'provider-a', connectionFamilyId: 'provider-a-api',
  },
  credential: { value: 'super-secret-provider-key' },
};

function adapter(id: string, modelId: string): AIConnectionProviderAdapter {
  return {
    id,
    async validateConnection() { return { status: 'available' }; },
    async discoverModels() {
      return [{
        providerModelId: modelId, displayName: `Model ${modelId}`, available: true,
        capabilities: { chat: true, structuredOutput: true },
      }];
    },
  };
}
describe('AI connection provider adapter registry', () => {
  it('supports multiple provider families behind one provider-neutral contract', async () => {
    const registry = createAIConnectionProviderAdapterRegistry([
      adapter('native-provider-a', 'model-a'),
      adapter('openai-compatible', 'model-b'),
    ]);
    expect(registry.get('native-provider-a')?.id).toBe('native-provider-a');
    expect(registry.get('openai-compatible')?.id).toBe('openai-compatible');
    expect((await registry.discoverModels('native-provider-a', context))[0]).toMatchObject({
      providerModelId: 'model-a',
      capabilities: { chat: true, structuredOutput: true, tools: false, vision: false },
    });
  });

  it('rejects duplicate adapter IDs and fails closed for unknown adapters', async () => {
    const first = adapter('same-provider', 'model-a');
    expect(() => createAIConnectionProviderAdapterRegistry([first, first])).toThrow(/duplicate/i);
    const registry = createAIConnectionProviderAdapterRegistry([first]);
    expect(registry.get('unknown-provider')).toBeNull();
    await expect(registry.discoverModels('unknown-provider', context)).rejects.toThrow(/unknown/i);
  });
  it('normalises discovery output and never returns credential or secret fields', async () => {
    const leaky: AIConnectionProviderAdapter = {
      id: 'leaky-provider',
      async validateConnection() { return { status: 'available', apiKey: 'should-not-return' } as never; },
      async discoverModels() {
        return [{
          providerModelId: 'vendor/model-1', displayName: 'Vendor Model 1', available: true,
          capabilities: { chat: true }, apiKey: 'leaked-key', secretRefId: 'vault/ref',
        } as never];
      },
    };
    const registry = createAIConnectionProviderAdapterRegistry([leaky]);
    const validation = await registry.validateConnection('leaky-provider', context);
    const models = await registry.discoverModels('leaky-provider', context);
    const serialized = JSON.stringify({ validation, models });
    expect(validation).toEqual({ status: 'available' });
    expect(serialized).not.toContain('super-secret-provider-key');
    expect(serialized).not.toContain('leaked-key');
    expect(serialized).not.toContain('vault/ref');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('secretRefId');
  });

  it('rejects malformed and duplicate provider model identifiers', async () => {
    const bad: AIConnectionProviderAdapter = {
      id: 'bad-provider', async validateConnection() { return { status: 'available' }; },
      async discoverModels() { return [
        { providerModelId: 'same', displayName: 'One', available: true, capabilities: { chat: true } },
        { providerModelId: 'same', displayName: 'Two', available: true, capabilities: { chat: true } },
      ]; },
    };
    const registry = createAIConnectionProviderAdapterRegistry([bad]);
    await expect(registry.discoverModels('bad-provider', context)).rejects.toThrow(/duplicate/i);
  });
});