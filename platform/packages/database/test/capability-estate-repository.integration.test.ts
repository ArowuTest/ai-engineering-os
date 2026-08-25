import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as database from '../src/index.js';
import {
  createAgentRecord,
  createCapabilityRecord,
  createCapabilityReleasePolicy,
} from '@engineering-os/domain';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const now = new Date('2026-08-19T19:02:00.000Z');
type Repo = {
  createCapability(record: ReturnType<typeof createCapabilityRecord>): Promise<void>;
  getCapability(id: string): Promise<ReturnType<typeof createCapabilityRecord> | null>;
  listCapabilities(kind?: string): Promise<Array<ReturnType<typeof createCapabilityRecord>>>;
  createRelease(record: ReturnType<typeof createCapabilityReleasePolicy>): Promise<void>;
  listReleases(capabilityId: string): Promise<Array<ReturnType<typeof createCapabilityReleasePolicy>>>;
  revokeRelease(id: string, when: Date): Promise<void>;
  createAgent(record: ReturnType<typeof createAgentRecord>): Promise<void>;
  getAgent(id: string): Promise<ReturnType<typeof createAgentRecord> | null>;
};
function repo(): Repo {
  const Ctor = (database as unknown as { CapabilityEstateRepository?: new (db: typeof pool) => Repo })
    .CapabilityEstateRepository;
  expect(typeof Ctor).toBe('function');
  return new Ctor!(pool);
}

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());
function harnessCapability() {
  return createCapabilityRecord({
    id: 'harness.codex', kind: 'harness', source: 'ecc', sourceRef: 'harnesses/codex',
    displayName: 'Codex', maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'bootstrap', createdAt: now,
  });
}

describe('CapabilityEstateRepository', () => {
  it('round-trips catalogue records without creating release state', async () => {
    const store = repo();
    const capability = harnessCapability();
    await store.createCapability(capability);
    expect(await store.getCapability(capability.id)).toEqual(capability);
    expect(await store.listCapabilities('harness')).toEqual([capability]);
    expect(await store.listReleases(capability.id)).toEqual([]);
  });

  it('revokes a release without mutating catalogue approval or verification', async () => {
    const store = repo();
    const capability = harnessCapability();
    await store.createCapability(capability);
    const release = createCapabilityReleasePolicy({
      id: 'release.codex.org', capabilityId: capability.id,
      scope: 'organisation', organisationId: 'org-001',
      createdBy: 'admin-001', createdAt: now,
    });
    await store.createRelease(release);    expect((await store.listReleases(capability.id)).map((item) => item.status)).toEqual(['active']);
    const revokedAt = new Date('2026-08-19T19:03:00.000Z');
    await store.revokeRelease(release.id, revokedAt);
    const releases = await store.listReleases(capability.id);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ status: 'revoked', revokedAt });
    expect(await store.getCapability(capability.id)).toEqual(capability);
  });

  it('round-trips agent metadata without model or harness bindings', async () => {
    const store = repo();
    const capability = createCapabilityRecord({
      id: 'agent.backend', kind: 'agent', source: 'platform', sourceRef: 'agents/backend',
      displayName: 'Backend Engineer', maturity: 'supported', governanceState: 'approved',
      executionVerification: 'verified', createdBy: 'bootstrap', createdAt: now,
    });
    await store.createCapability(capability);
    const agent = createAgentRecord({
      id: 'agent.backend.profile', capabilityId: capability.id,
      displayName: 'Backend Engineer', specialistRole: 'backend',
      description: 'Backend implementation specialist', createdBy: 'bootstrap', createdAt: now,
    });
    await store.createAgent(agent);
    expect(await store.getAgent(agent.id)).toEqual(agent);
  });

  it('fails closed when an agent points at a non-agent capability', async () => {
    const store = repo();
    const capability = harnessCapability();
    await store.createCapability(capability);
    const agent = createAgentRecord({
      id: 'agent.invalid.profile', capabilityId: capability.id,
      displayName: 'Invalid Agent', specialistRole: 'backend',
      description: 'Must not bind to a harness capability', createdBy: 'bootstrap', createdAt: now,
    });
    await expect(store.createAgent(agent)).rejects.toThrow();
  });

  it('is exposed through DatabaseUnitOfWork without weakening transaction boundaries', async () => {
    const Uow = (database as unknown as {
      DatabaseUnitOfWork?: new (db: typeof pool) => {
        run<T>(work: (repos: { capabilityEstate?: Repo }) => Promise<T>): Promise<T>;
      };
    }).DatabaseUnitOfWork;
    expect(typeof Uow).toBe('function');
    const result = await new Uow!(pool).run(async ({ capabilityEstate }) => {
      expect(capabilityEstate).toBeDefined();
      return capabilityEstate!.listCapabilities();
    });
    expect(result).toEqual([]);
  });
});
