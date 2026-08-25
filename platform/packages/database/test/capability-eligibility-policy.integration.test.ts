import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CapabilityEstateRepository,
} from '../src/index.js';
import {
  createCapabilityEligibilityPolicy,
  createCapabilityRecord,
  createCapabilityReleasePolicy,
} from '@engineering-os/domain';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const now = new Date('2026-08-19T20:44:00.000Z');
function store() {
  return new CapabilityEstateRepository(pool) as CapabilityEstateRepository & {
    createEligibilityPolicy(record: ReturnType<typeof createCapabilityEligibilityPolicy>): Promise<void>;
    listEligibilityPolicies(capabilityId: string): Promise<Array<ReturnType<typeof createCapabilityEligibilityPolicy>>>;
    revokeEligibilityPolicy(id: string, when: Date): Promise<void>;
  };
}
function modelCapability() {
  return createCapabilityRecord({
    id: 'model.openai-api', kind: 'model_route', source: 'model_gateway', sourceRef: 'openai-api',
    displayName: 'OpenAI API', maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'bootstrap', createdAt: now,
  });
}

describe('CapabilityEstateRepository eligibility persistence', () => {
  beforeEach(async () => {
    await resetDatabase();
    await pool.query(
      `INSERT INTO users (id, user_id, password_hash, status, created_at, updated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'elig.target', 'test-hash', 'active', $1, $1)`,
      [now],
    );
    await pool.query(
      `INSERT INTO organisation_memberships
       (organisation_id, user_id, role, status, created_by, created_at, updated_at)
       VALUES ('org-001', '11111111-1111-4111-8111-111111111111', 'member', 'active', 'test', $1, $1)`,
      [now],
    );
    await pool.query(
      `INSERT INTO projects
       (id, organisation_id, name, created_by, created_at, stage, preferred_product_partner, updated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'org-001', 'Eligibility Target', 'test', $1,
         'discovery', 'auto', $1)`,
      [now],
    );
  });
  afterAll(async () => closeDatabase());

  it('creates a separate durable eligibility policy table', async () => {
    const result = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.capability_eligibility_policies')::text AS name`,
    );
    expect(result.rows[0]?.name).toBe('capability_eligibility_policies');
  });

  it('round-trips project eligibility without creating or changing release state', async () => {
    const repo = store();
    const capability = modelCapability();
    await repo.createCapability(capability);
    const release = createCapabilityReleasePolicy({
      id: 'release.model.org', capabilityId: capability.id, scope: 'organisation',
      organisationId: 'org-001', createdBy: 'admin-001', createdAt: now,
    });
    await repo.createRelease(release);
    const policy = createCapabilityEligibilityPolicy({
      id: 'elig.model.project', capabilityId: capability.id, scope: 'project',
      organisationId: 'org-001', projectId: '11111111-1111-4111-8111-111111111111',
      decision: 'deny', createdBy: 'admin-001', createdAt: now,
    });
    await repo.createEligibilityPolicy(policy);
    expect(await repo.listEligibilityPolicies(capability.id)).toEqual([policy]);
    expect((await repo.listReleases(capability.id)).map((item) => item.status)).toEqual(['active']);
  });

  it('revokes eligibility independently of catalogue and release rows', async () => {
    const repo = store();
    const capability = modelCapability();
    await repo.createCapability(capability);
    const policy = createCapabilityEligibilityPolicy({
      id: 'elig.model.user', capabilityId: capability.id, scope: 'user',
      organisationId: 'org-001', userId: '11111111-1111-4111-8111-111111111111',
      decision: 'allow', createdBy: 'admin-001', createdAt: now,
    });
    await repo.createEligibilityPolicy(policy);
    const revokedAt = new Date('2026-08-19T20:45:00.000Z');
    await repo.revokeEligibilityPolicy(policy.id, revokedAt);
    expect(await repo.listEligibilityPolicies(capability.id)).toEqual([
      expect.objectContaining({ id: policy.id, status: 'revoked', revokedAt }),
    ]);
    expect(await repo.getCapability(capability.id)).toEqual(capability);
  });
});