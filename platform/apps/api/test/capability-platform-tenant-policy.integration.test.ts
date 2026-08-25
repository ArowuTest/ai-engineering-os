import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { MembershipRepository, PlatformMembershipRepository, UserRepository } from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import { closeDatabase, databaseUrl, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const capability = {
  id: 'model.platform-tenant-policy',
  kind: 'model_route',
  source: 'model_gateway',
  sourceRef: 'openai-api',
  displayName: 'Platform tenant policy model',
  maturity: 'supported',
  governanceState: 'approved',
  executionVerification: 'verified',
};

function runtime() {
  return createRuntimeApp({
    DATABASE_URL: databaseUrl,
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-test',
    ALLOW_DEV_IDENTITY_HEADERS: 'false',
  });
}

async function createUser(login: string, password: string) {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id,
    userId: login,
    passwordHash: await hashPassword(password),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { userId, password } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

describe('Platform Admin tenant-scoped capability policy authority', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('allows a platform-only admin to create and revoke organisation eligibility while denying an ordinary member', async () => {
    const platformAdminId = await createUser('platform.policy.admin', 'Platform-policy-2026!');
    const memberId = await createUser('tenant.policy.member', 'Tenant-policy-2026!');
    const now = new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({
      userId: platformAdminId,
      createdBy: 'bootstrap',
      now,
    });
    await new MembershipRepository(pool).grantOrganisation({
      organisationId: 'org-001',
      userId: memberId,
      role: 'member',
      createdBy: 'test',
      now,
    });

    const instance = runtime();
    const platformToken = await login(instance.app, 'platform.policy.admin', 'Platform-policy-2026!');
    const memberToken = await login(instance.app, 'tenant.policy.member', 'Tenant-policy-2026!');
    const platformHeaders = {
      authorization: `Bearer ${platformToken}`,
      'x-organisation-id': 'org-001',
    };
    const memberHeaders = {
      authorization: `Bearer ${memberToken}`,
      'x-organisation-id': 'org-001',
    };

    expect((await instance.app.inject({
      method: 'POST',
      url: '/admin/capabilities',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: capability,
    })).statusCode).toBe(201);

    const denied = await instance.app.inject({
      method: 'POST',
      url: `/admin/capabilities/${capability.id}/eligibility`,
      headers: memberHeaders,
      payload: { scope: 'organisation', decision: 'allow' },
    });
    expect(denied.statusCode).toBe(403);

    const created = await instance.app.inject({
      method: 'POST',
      url: `/admin/capabilities/${capability.id}/eligibility`,
      headers: platformHeaders,
      payload: { scope: 'organisation', decision: 'allow' },
    });
    expect(created.statusCode).toBe(201);
    const policyId = (created.json() as { id: string }).id;

    const revoked = await instance.app.inject({
      method: 'DELETE',
      url: `/admin/capabilities/${capability.id}/eligibility/${policyId}`,
      headers: platformHeaders,
    });
    expect(revoked.statusCode).toBe(204);

    await instance.close();
  }, 90_000);

  it('allows a platform-only admin to manage tenant capability populations while denying an ordinary member', async () => {
    const platformAdminId = await createUser('platform.population.admin', 'Platform-population-2026!');
    const memberId = await createUser('tenant.population.member', 'Tenant-population-2026!');
    const targetUserId = await createUser('tenant.population.target', 'Tenant-population-target-2026!');
    const now = new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({
      userId: platformAdminId,
      createdBy: 'bootstrap',
      now,
    });
    for (const userId of [memberId, targetUserId]) {
      await new MembershipRepository(pool).grantOrganisation({
        organisationId: 'org-001', userId, role: 'member', createdBy: 'test', now,
      });
    }

    const instance = runtime();
    const platformToken = await login(instance.app, 'platform.population.admin', 'Platform-population-2026!');
    const memberToken = await login(instance.app, 'tenant.population.member', 'Tenant-population-2026!');
    const platformHeaders = { authorization: `Bearer ${platformToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };
    const url = `/admin/capability-populations/team/team-alpha/members/${targetUserId}`;

    expect((await instance.app.inject({ method: 'PUT', url, headers: memberHeaders })).statusCode).toBe(403);
    expect((await instance.app.inject({ method: 'PUT', url, headers: platformHeaders })).statusCode).toBe(204);

    const active = await pool.query<{ population_id: string; status: string }>(
      `SELECT population_id, status FROM capability_population_memberships
       WHERE organisation_id=$1 AND user_id=$2`,
      ['org-001', targetUserId],
    );
    expect(active.rows).toEqual([{ population_id: 'team-alpha', status: 'active' }]);

    expect((await instance.app.inject({ method: 'DELETE', url, headers: platformHeaders })).statusCode).toBe(204);
    const revoked = await pool.query<{ status: string }>(
      `SELECT status FROM capability_population_memberships
       WHERE organisation_id=$1 AND user_id=$2 AND population_id=$3`,
      ['org-001', targetUserId, 'team-alpha'],
    );
    expect(revoked.rows).toEqual([{ status: 'revoked' }]);
    await instance.close();
  }, 90_000);
});
