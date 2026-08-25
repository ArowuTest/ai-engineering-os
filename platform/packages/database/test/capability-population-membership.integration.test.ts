import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as database from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

type PopulationKind = 'team' | 'cohort';
type PopulationIds = { teamIds: string[]; cohortIds: string[] };
type Repo = {
  grantPopulationMembership(input: {
    organisationId: string; kind: PopulationKind; populationId: string;
    userId: string; createdBy: string; now: Date;
  }): Promise<void>;
  revokePopulationMembership(input: {
    organisationId: string; kind: PopulationKind; populationId: string;
    userId: string; now: Date;
  }): Promise<void>;
  listActivePopulationIds(organisationId: string, userId: string): Promise<PopulationIds>;
};

function repo(): Repo {
  const Ctor = (database as unknown as { CapabilityEstateRepository?: new (db: typeof pool) => Repo })
    .CapabilityEstateRepository;
  expect(typeof Ctor).toBe('function');
  return new Ctor!(pool);
}
async function seedMembership(organisationId = 'org-001') {
  const userId = randomUUID();
  const now = new Date('2026-08-19T22:50:00.000Z');
  await pool.query(
    `INSERT INTO users (id, user_id, password_hash, status, created_at, updated_at)
     VALUES ($1, $2, 'test-hash', 'active', $3, $3)`,
    [userId, `scope.${userId.slice(0, 8)}`, now],
  );
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'member', 'active', 'test', $3, $3)`,
    [organisationId, userId, now],
  );
  return { userId, now };
}

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());

describe('capability population membership', () => {
  it('persists independent team and cohort memberships for capability policy evaluation', async () => {
    const table = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.capability_population_memberships')::text AS name`,
    );
    expect(table.rows[0]?.name).toBe('capability_population_memberships');
    const { userId, now } = await seedMembership();
    const store = repo();
    await store.grantPopulationMembership({
      organisationId: 'org-001', kind: 'team', populationId: 'team-red',
      userId, createdBy: 'admin-001', now,
    });
    await store.grantPopulationMembership({
      organisationId: 'org-001', kind: 'cohort', populationId: 'cohort-a',
      userId, createdBy: 'admin-001', now,
    });
    expect(await store.listActivePopulationIds('org-001', userId)).toEqual({
      teamIds: ['team-red'], cohortIds: ['cohort-a'],
    });
  });

  it('revokes a population membership immediately without affecting the other population kind', async () => {
    const { userId, now } = await seedMembership();
    const store = repo();
    await store.grantPopulationMembership({ organisationId: 'org-001', kind: 'team',
      populationId: 'team-red', userId, createdBy: 'admin-001', now });
    await store.grantPopulationMembership({ organisationId: 'org-001', kind: 'cohort',
      populationId: 'cohort-a', userId, createdBy: 'admin-001', now });
    await store.revokePopulationMembership({ organisationId: 'org-001', kind: 'team',
      populationId: 'team-red', userId, now: new Date(now.getTime() + 60_000) });
    expect(await store.listActivePopulationIds('org-001', userId)).toEqual({
      teamIds: [], cohortIds: ['cohort-a'],
    });
  });

  it('fails closed when capability population membership points outside the organisation', async () => {
    const { userId } = await seedMembership('org-001');
    const store = repo();
    await expect(store.grantPopulationMembership({
      organisationId: 'org-002', kind: 'team', populationId: 'team-red',
      userId, createdBy: 'admin-002', now: new Date(),
    })).rejects.toThrow();
    expect(await store.listActivePopulationIds('org-002', userId)).toEqual({
      teamIds: [], cohortIds: [],
    });
  });
});
