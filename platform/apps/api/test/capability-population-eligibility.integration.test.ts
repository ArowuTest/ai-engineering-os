import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  CapabilityEstateRepository,
  MembershipRepository,
  PlatformMembershipRepository,
  UserRepository,
} from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase, databaseUrl, pool, resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const teamCapability = {
  id: 'skill.team-red', kind: 'skill', source: 'ecc', sourceRef: 'skills/team-red',
  displayName: 'Team Red Skill', maturity: 'supported', governanceState: 'approved',
  executionVerification: 'verified',
};
const cohortCapability = {
  id: 'skill.cohort-a', kind: 'skill', source: 'ecc', sourceRef: 'skills/cohort-a',
  displayName: 'Cohort A Skill', maturity: 'supported', governanceState: 'approved',
  executionVerification: 'verified',
};
function runtime() {
  return createRuntimeApp({ DATABASE_URL: databaseUrl, ALLOW_DEV_IDENTITY_HEADERS: 'false' });
}
async function seedUser(login: string, password: string) {
  const id = randomUUID(), now = new Date();
  await new UserRepository(pool).create({
    id, userId: login, passwordHash: await hashPassword(password), status: 'active',
    createdAt: now, updatedAt: now,
  });
  return id;
}
async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { userId, password } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}
async function seedProject(memberId: string) {
  const projectId = randomUUID(), now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id,organisation_id,name,created_by,created_at,stage,preferred_product_partner,updated_at)
     VALUES ($1,'org-001','Population Project','test',$2,'discovery','auto',$2)`,
    [projectId, now],
  );
  await new MembershipRepository(pool).grantProject({
    organisationId: 'org-001', projectId, userId: memberId, role: 'engineer',
    createdBy: 'test', now,
  });
  return projectId;
}

beforeEach(async () => resetDatabase(), 30_000);
afterAll(async () => closeDatabase());

describe('capability population eligibility', () => {
  it('injects persisted team/cohort memberships into project capability evaluation', async () => {
    const platformId = await seedUser('population.platform', 'Population-platform-2026!');
    const ownerId = await seedUser('population.owner', 'Population-owner-2026!');
    const memberId = await seedUser('population.member', 'Population-member-2026!');
    const now = new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({
      userId: platformId, createdBy: 'bootstrap', now,
    });
    const memberships = new MembershipRepository(pool);
    await memberships.grantOrganisation({
      organisationId: 'org-001', userId: ownerId, role: 'owner', createdBy: 'test', now,
    });
    await memberships.grantOrganisation({
      organisationId: 'org-001', userId: memberId, role: 'member', createdBy: 'test', now,
    });
    const projectId = await seedProject(memberId);
    const instance = runtime();
    const platformToken = await login(instance.app, 'population.platform', 'Population-platform-2026!');
    const ownerToken = await login(instance.app, 'population.owner', 'Population-owner-2026!');
    const memberToken = await login(instance.app, 'population.member', 'Population-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };
    for (const capability of [teamCapability, cohortCapability]) {
      const created = await instance.app.inject({
        method: 'POST', url: '/admin/capabilities',
        headers: { authorization: `Bearer ${platformToken}` }, payload: capability,
      });
      expect(created.statusCode).toBe(201);
    }
    expect((await instance.app.inject({ method: 'POST',
      url: `/admin/capabilities/${teamCapability.id}/releases`, headers: ownerHeaders,
      payload: { scope: 'team', teamId: 'team-red' } })).statusCode).toBe(201);
    expect((await instance.app.inject({ method: 'POST',
      url: `/admin/capabilities/${cohortCapability.id}/releases`, headers: ownerHeaders,
      payload: { scope: 'cohort', cohortId: 'cohort-a' } })).statusCode).toBe(201);

    const eligibleUrl = `/projects/${projectId}/capabilities?kind=skill`;
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([]);

    const populations = new CapabilityEstateRepository(pool);
    await populations.grantPopulationMembership({
      organisationId: 'org-001', kind: 'team', populationId: 'team-red',
      userId: memberId, createdBy: ownerId, now,
    });
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: teamCapability.id })]);

    await populations.grantPopulationMembership({
      organisationId: 'org-001', kind: 'cohort', populationId: 'cohort-a',
      userId: memberId, createdBy: ownerId, now,
    });
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([
        expect.objectContaining({ id: cohortCapability.id }),
        expect.objectContaining({ id: teamCapability.id }),
      ]);

    await populations.revokePopulationMembership({
      organisationId: 'org-001', kind: 'team', populationId: 'team-red',
      userId: memberId, now: new Date(now.getTime() + 60_000),
    });
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: cohortCapability.id })]);
    await instance.close();
  });
  it('lets organisation Admin manage team/cohort audience membership with audit while members cannot self-assign', async () => {
    const ownerId = await seedUser('population.admin', 'Population-admin-2026!');
    const targetId = await seedUser('population.target', 'Population-target-2026!');
    const ordinaryId = await seedUser('population.ordinary', 'Population-ordinary-2026!');
    const now = new Date();
    const memberships = new MembershipRepository(pool);
    await memberships.grantOrganisation({ organisationId: 'org-001', userId: ownerId,
      role: 'owner', createdBy: 'test', now });
    await memberships.grantOrganisation({ organisationId: 'org-001', userId: targetId,
      role: 'member', createdBy: 'test', now });
    await memberships.grantOrganisation({ organisationId: 'org-001', userId: ordinaryId,
      role: 'member', createdBy: 'test', now });
    const instance = runtime();
    const ownerToken = await login(instance.app, 'population.admin', 'Population-admin-2026!');
    const ordinaryToken = await login(instance.app, 'population.ordinary', 'Population-ordinary-2026!');
    const url = `/admin/capability-populations/team/team-red/members/${targetId}`;
    const denied = await instance.app.inject({ method: 'PUT', url,
      headers: { authorization: `Bearer ${ordinaryToken}`, 'x-organisation-id': 'org-001' } });
    expect(denied.statusCode).toBe(403);
    const granted = await instance.app.inject({ method: 'PUT', url,
      headers: { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' } });
    expect(granted.statusCode).toBe(204);
    const populations = new CapabilityEstateRepository(pool);
    expect(await populations.listActivePopulationIds('org-001', targetId))
      .toEqual({ teamIds: ['team-red'], cohortIds: [] });
    const revoked = await instance.app.inject({ method: 'DELETE', url,
      headers: { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' } });
    expect(revoked.statusCode).toBe(204);
    expect(await populations.listActivePopulationIds('org-001', targetId))
      .toEqual({ teamIds: [], cohortIds: [] });
    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE organisation_id='org-001'
       AND event_type LIKE 'capability.population_membership.%' ORDER BY sequence`,
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'capability.population_membership.granted', 'capability.population_membership.revoked',
    ]);
    await instance.close();
  });});
