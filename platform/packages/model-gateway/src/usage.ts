import type { ModelUsage } from './types.js';

export function normaliseUsage(
  inputTokens?: number,
  outputTokens?: number,
): ModelUsage | undefined {
  const usage: ModelUsage = {};
  if (typeof inputTokens === 'number') usage.inputTokens = inputTokens;
  if (typeof outputTokens === 'number') usage.outputTokens = outputTokens;
  return usage.inputTokens === undefined && usage.outputTokens === undefined ? undefined : usage;
}
