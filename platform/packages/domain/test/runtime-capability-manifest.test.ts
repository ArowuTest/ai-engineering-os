import { describe, expect, it } from 'vitest';
import {
  createRuntimeCapabilityManifest,
  runtimeCapabilityManifestFromRunner,
  type AIRunnerRecord,
} from '../src/index.js';

const observedAt = new Date('2026-08-26T11:00:00Z');

describe('runtime capability manifest', () => {
  it('distinguishes runner declarations from observed availability', () => {
    const runner: AIRunnerRecord = {
      id: 'runner-001', organisationId: 'org-001', ownership: 'organisation', harnessId: 'codex',
      status: 'online', trustState: 'trusted', persistentSupported: true,
      capabilities: ['workspace', 'git', 'browser'], createdBy: 'admin',
      createdAt: observedAt, updatedAt: observedAt,
    };
    const manifest = runtimeCapabilityManifestFromRunner(runner, observedAt);
    expect(manifest.runnerId).toBe('runner-001');
    expect(manifest.capabilities.map((item) => [item.id, item.state])).toEqual([
      ['browser', 'declared'], ['git', 'declared'], ['workspace', 'declared'],
    ]);
  });

  it('accepts direct observed availability separately from declarations', () => {
    const manifest = createRuntimeCapabilityManifest({
      runnerId: 'runner-001', environmentId: 'env-local', harnessId: 'codex', observedAt,
      capabilities: [
        { id: 'git', state: 'available', source: 'runtime_probe' },
        { id: 'browser', state: 'unavailable', source: 'runtime_probe', reason: 'browser binary missing' },
        { id: 'database.write.production', state: 'unavailable', source: 'policy', reason: 'production is read-only' },
      ],
    });
    expect(manifest.capabilities.find((item) => item.id === 'git')?.state).toBe('available');
    expect(manifest.capabilities.find((item) => item.id === 'browser')?.reason).toMatch(/missing/);
  });

  it('rejects duplicate capabilities and secret-shaped metadata', () => {
    expect(() => createRuntimeCapabilityManifest({
      runnerId: 'runner-001', observedAt,
      capabilities: [
        { id: 'git', state: 'available', source: 'runtime_probe' },
        { id: 'git', state: 'declared', source: 'runner' },
      ],
    })).toThrow(/duplicate/i);
    expect(() => createRuntimeCapabilityManifest({
      runnerId: 'runner-001', observedAt,
      capabilities: [{ id: 'git', state: 'available', source: 'runtime_probe', reason: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }],
    })).toThrow(/secret|credential/i);
  });
});
