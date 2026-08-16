import type {
  ExecutionEnvironmentProvider,
  PreparedExecutionEnvironment,
} from '@engineering-os/execution-environment';
import type { HarnessExecutionAdapter } from '@engineering-os/model-gateway';
import { createAntigravityHarnessAdapter } from './antigravity.js';
import { createClaudeCodeHarnessAdapter } from './claude-code.js';
import { createCodexHarnessAdapter } from './codex.js';

export type LocalHarnessId = 'codex' | 'antigravity' | 'claude-code';

export interface LocalHarnessRegistryOptions {
  provider: ExecutionEnvironmentProvider;
  environment: PreparedExecutionEnvironment;
  availableHarnesses: readonly LocalHarnessId[];
  commands?: Partial<Record<LocalHarnessId, string>>;
}

export interface LocalHarnessRegistry {
  list(): readonly HarnessExecutionAdapter[];
  get(harnessId: string): HarnessExecutionAdapter | null;
}

const KNOWN_HARNESSES = new Set<LocalHarnessId>([
  'codex', 'antigravity', 'claude-code',
]);
function buildAdapter(
  harnessId: LocalHarnessId,
  options: LocalHarnessRegistryOptions,
): HarnessExecutionAdapter {
  const common = { provider: options.provider, environment: options.environment };
  switch (harnessId) {
    case 'codex':
      return createCodexHarnessAdapter({
        ...common,
        ...(options.commands?.codex ? { command: options.commands.codex } : {}),
      });
    case 'antigravity':
      return createAntigravityHarnessAdapter({
        ...common,
        ...(options.commands?.antigravity ? { command: options.commands.antigravity } : {}),
      });
    case 'claude-code':
      return createClaudeCodeHarnessAdapter({
        ...common,
        ...(options.commands?.['claude-code'] ? { command: options.commands['claude-code'] } : {}),
      });
  }
}

export function createLocalHarnessRegistry(
  options: LocalHarnessRegistryOptions,
): LocalHarnessRegistry {  const seen = new Set<LocalHarnessId>();
  const adapters: HarnessExecutionAdapter[] = [];
  const byHarness = new Map<string, HarnessExecutionAdapter>();

  for (const rawHarnessId of options.availableHarnesses as readonly string[]) {
    if (!KNOWN_HARNESSES.has(rawHarnessId as LocalHarnessId)) {
      throw new Error(`unknown local harness: ${rawHarnessId}`);
    }
    const harnessId = rawHarnessId as LocalHarnessId;
    if (seen.has(harnessId)) {
      throw new Error(`duplicate local harness: ${harnessId}`);
    }
    seen.add(harnessId);
    const adapter = buildAdapter(harnessId, options);
    adapters.push(adapter);
    byHarness.set(harnessId, adapter);
  }

  const frozenAdapters = Object.freeze([...adapters]) as readonly HarnessExecutionAdapter[];
  return Object.freeze({
    list(): readonly HarnessExecutionAdapter[] {
      return frozenAdapters;
    },
    get(harnessId: string): HarnessExecutionAdapter | null {
      return byHarness.get(harnessId) ?? null;
    },
  });
}