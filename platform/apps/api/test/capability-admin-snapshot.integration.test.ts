import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  MembershipRepository,
  PlatformMembershipRepository,
  UserRepository,
} from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const capability = {
  id: 'agent.admin-snapshot', kind: 'agent', source: 'ecc', sourceRef: 'agents/admin.md',
  displayName: 'Admin Snapshot Agent', maturity: 'supported',
  governanceState: 'approved', executionVerification: 'verified',
};

function runtime() {
  return createRuntimeApp({ DATABASE_URL: databaseUrl, ALLOW_DEV_IDENTITY_HEADERS: 'false' });
}
async function createUser(userId: string, password: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id, userId, passwordHash: await hashPassword(password), status: 'active',
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { userId, password } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

describe('Capability Estate admin snapshot', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('lets a platform-only admin read a safe aggregated capability and policy snapshot', async () => {
    const adminId = await createUser('snapshot.admin', 'Snapshot-admin-2026!');
    await new PlatformMembershipRepository(pool).grantAdmin({
      userId: adminId, createdBy: 'bootstrap', now: new Date(),
    });
    const instance = runtime();
    const token = await login(instance.app, 'snapshot.admin', 'Snapshot-admin-2026!');
    const headers = { authorization: `Bearer ${token}` };
    expect((await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers, payload: capability,
    })).statusCode).toBe(201);
    expect((await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capability.id}/releases`,
      headers, payload: { scope: 'platform' },
    })).statusCode).toBe(201);

    const response = await instance.app.inject({
      method: 'GET', url: '/admin/capability-estate', headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capabilities: [expect.objectContaining(capability)],
      releases: [expect.objectContaining({ capabilityId: capability.id, scope: 'platform', status: 'active' })],
      eligibilityPolicies: [],
    });
    expect(response.body).not.toMatch(/api[_-]?key|credential|secret/i);
    await instance.close();
  });

  it('does not expose the global capability estate snapshot to a tenant owner', async () => {
    const ownerId = await createUser('snapshot.owner', 'Snapshot-owner-2026!');
    await new MembershipRepository(pool).grantOrganisation({
      organisationId: 'org-001', userId: ownerId, role: 'owner', createdBy: 'test', now: new Date(),
    });
    const instance = runtime();
    const token = await login(instance.app, 'snapshot.owner', 'Snapshot-owner-2026!');
    const response = await instance.app.inject({
      method: 'GET', url: '/admin/capability-estate',
      headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
    });
    expect(response.statusCode).toBe(403);
    await instance.close();
  });
});
