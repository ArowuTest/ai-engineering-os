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

  it('accepts direct observed availability separately from health and retryability', () => {
    const manifest = createRuntimeCapabilityManifest({
      runnerId: 'runner-001', environmentId: 'env-local', harnessId: 'codex', observedAt,
      capabilities: [
        { id: 'git', state: 'available', health: 'healthy', supported: true, retryability: 'retryable', source: 'runtime_probe' },
        {
          id: 'browser', state: 'available', health: 'temporarily_unhealthy', supported: true,
          retryability: 'retryable', source: 'runtime_probe', reasonCode: 'browser_transport_502',
          reason: 'browser transport temporarily unavailable', evidenceRef: 'evidence:browser-health-001',
        },
        {
          id: 'database.write.production', state: 'unavailable', health: 'unavailable', supported: true,
          retryability: 'approval_required', source: 'policy', reasonCode: 'production_read_only',
          reason: 'production is read-only',
        },
      ],
    });
    expect(manifest.capabilities.find((item) => item.id === 'git')).toMatchObject({
      state: 'available', health: 'healthy', supported: true, retryability: 'retryable',
    });
    expect(manifest.capabilities.find((item) => item.id === 'browser')).toMatchObject({
      state: 'available', health: 'temporarily_unhealthy', supported: true, retryability: 'retryable',
      reasonCode: 'browser_transport_502', evidenceRef: 'evidence:browser-health-001',
    });
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
