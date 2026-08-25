import { describe, expect, it } from 'vitest';
import {
  createConfiguredAIConnectionProviderAdapters,
  createConfiguredAIConnectionSecretProtector,
} from '../src/ai-connection-runtime.js';

describe('AI connection runtime composition', () => {
  it('keeps managed credential storage disabled when no master-key settings exist', () => {
    expect(createConfiguredAIConnectionSecretProtector({})).toBeUndefined();
  });

  it('fails fast when only one managed credential key setting is supplied', () => {
    expect(() => createConfiguredAIConnectionSecretProtector({
      AIOS_CONNECTION_SECRET_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
    })).toThrow(/KEY_VERSION/);
    expect(() => createConfiguredAIConnectionSecretProtector({
      AIOS_CONNECTION_SECRET_KEY_VERSION: 'v1',
    })).toThrow(/MASTER_KEY/);
  });
  it('creates a strict AES protector without exposing the deployment master key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const protector = createConfiguredAIConnectionSecretProtector({
      AIOS_CONNECTION_SECRET_MASTER_KEY: key,
      AIOS_CONNECTION_SECRET_KEY_VERSION: 'runtime-v1',
    });
    expect(protector).toBeDefined();
    expect(JSON.stringify(protector)).not.toContain(key);
  });

  it('registers OpenRouter as a real reference adapter without paper native integrations', () => {
    const adapters = createConfiguredAIConnectionProviderAdapters({});
    expect(adapters.get('openrouter-compatible')).not.toBeNull();
    expect(adapters.get('openai-native')).toBeNull();
    expect(adapters.get('anthropic-native')).toBeNull();
    expect(adapters.get('google-native')).toBeNull();
  });
});
