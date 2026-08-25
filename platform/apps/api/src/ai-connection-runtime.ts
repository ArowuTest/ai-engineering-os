import {
  createAesGcmAIConnectionSecretProtector,
  type AesGcmAIConnectionSecretProtector,
} from './ai-connection-secret-protector.js';
import { createAIConnectionProviderAdapterRegistry } from './ai-connection-provider-adapter.js';
import { createOpenAICompatibleConnectionProviderAdapter } from './openai-compatible-connection-provider.js';

export interface AIConnectionRuntimeEnvironment {
  AIOS_CONNECTION_SECRET_MASTER_KEY?: string;
  AIOS_CONNECTION_SECRET_KEY_VERSION?: string;
}

function configuredValue(
  environment: AIConnectionRuntimeEnvironment,
  key: keyof AIConnectionRuntimeEnvironment,
): string | undefined {
  const raw = environment[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function createConfiguredAIConnectionSecretProtector(
  environment: AIConnectionRuntimeEnvironment,
): AesGcmAIConnectionSecretProtector | undefined {
  const masterKeyBase64 = configuredValue(environment, 'AIOS_CONNECTION_SECRET_MASTER_KEY');
  const keyVersion = configuredValue(environment, 'AIOS_CONNECTION_SECRET_KEY_VERSION');
  if (!masterKeyBase64 && !keyVersion) return undefined;
  if (!masterKeyBase64) {
    throw new Error('AIOS_CONNECTION_SECRET_MASTER_KEY is required when managed credentials are enabled');
  }
  if (!keyVersion) {
    throw new Error('AIOS_CONNECTION_SECRET_KEY_VERSION is required when managed credentials are enabled');
  }
  return createAesGcmAIConnectionSecretProtector({ masterKeyBase64, keyVersion });
}

export function createConfiguredAIConnectionProviderAdapters(
  _environment: AIConnectionRuntimeEnvironment,
) {
  return createAIConnectionProviderAdapterRegistry([
    createOpenAICompatibleConnectionProviderAdapter({
      id: 'openrouter-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
    }),
  ]);
}
