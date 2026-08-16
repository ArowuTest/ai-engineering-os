import { describe, expect, it } from 'vitest';
import type {
  ExecutionEnvironmentProvider,
  PreparedExecutionEnvironment,
} from '@engineering-os/execution-environment';
import { createLocalHarnessRegistry } from '../../src/harnesses/registry.js';

const ENVIRONMENT: PreparedExecutionEnvironment = {
  workspacePath: 'C:/approved/project-worktree',
};

function fakeProvider(): ExecutionEnvironmentProvider {
  return {
    async prepare() { return ENVIRONMENT; },
    async execute() { throw new Error('not executed by registry tests'); },
    async cancel() { return true; },
    async destroy() { return true; },
    async readFile() { return new Uint8Array(); },
    async writeFile() {},
    async collectArtifact(_environment, relativePath) {
      return { relativePath, data: new Uint8Array() };
    },
  };
}
describe('local runner harness registry', () => {
  it('exposes only harnesses explicitly declared available by this runner', () => {
    const registry = createLocalHarnessRegistry({
      provider: fakeProvider(), environment: ENVIRONMENT,
      availableHarnesses: ['claude-code'],
    });

    expect(registry.list().map(adapter => adapter.harnessId)).toEqual(['claude-code']);
    expect(registry.get('claude-code')?.id).toBe('claude-code-local');
    expect(registry.get('codex')).toBeNull();
    expect(registry.get('antigravity')).toBeNull();
  });

  it('builds all three sibling adapters with runner-local command overrides', () => {
    const registry = createLocalHarnessRegistry({
      provider: fakeProvider(), environment: ENVIRONMENT,
      availableHarnesses: ['codex', 'antigravity', 'claude-code'],
      commands: { codex: 'C:/tools/codex.exe', antigravity: 'C:/tools/agy.exe', 'claude-code': 'C:/tools/claude.exe' },
    });
    expect(registry.list().map(adapter => adapter.id)).toEqual([
      'codex-local', 'antigravity-local', 'claude-code-local',
    ]);
  });
  it('rejects duplicate or unknown local harness declarations', () => {
    expect(() => createLocalHarnessRegistry({
      provider: fakeProvider(), environment: ENVIRONMENT,
      availableHarnesses: ['claude-code', 'claude-code'],
    })).toThrow(/duplicate/i);

    expect(() => createLocalHarnessRegistry({
      provider: fakeProvider(), environment: ENVIRONMENT,
      availableHarnesses: ['unknown'] as never,
    })).toThrow(/unknown/i);
  });

  it('returns a frozen adapter list that callers cannot mutate into extra availability', () => {
    const registry = createLocalHarnessRegistry({
      provider: fakeProvider(), environment: ENVIRONMENT,
      availableHarnesses: ['claude-code'],
    });
    const listed = registry.list();
    expect(Object.isFrozen(listed)).toBe(true);
    expect(() => (listed as unknown[]).push({})).toThrow();
    expect(registry.list().map(adapter => adapter.harnessId)).toEqual(['claude-code']);
  });
});