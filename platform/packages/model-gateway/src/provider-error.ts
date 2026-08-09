import type { ModelProvider } from './types.js';

export class ProviderExecutionError extends Error {
  readonly provider: ModelProvider;

  constructor(provider: ModelProvider, cause?: unknown) {
    super(`Model provider execution failed: ${provider}`, cause === undefined ? undefined : { cause });
    this.name = 'ProviderExecutionError';
    this.provider = provider;
  }
}
