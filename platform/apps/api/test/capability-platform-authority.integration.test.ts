import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { MembershipRepository, PlatformMembershipRepository, UserRepository } from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import { closeDatabase, databaseUrl, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const capability = {
  id: 'model.platform-owned', kind: 'model_route', source: 'model_gateway', sourceRef: 'openai-api',
  displayName: 'Platform Owned', maturity: 'supported', governanceState: 'approved', executionVerification: 'verified',
};

function runtime() {
  return createRuntimeApp({ DATABASE_URL: databaseUrl, OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test', ALLOW_DEV_IDENTITY_HEADERS: 'false' });
}

async function user(login: string, password: string) {
  const id = randomUUID(); const now = new Date();
  await new UserRepository(pool).create({ id, userId: login, passwordHash: await hashPassword(password), status: 'active', createdAt: now, updatedAt: now });
  return id;
}

async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { userId, password } });
}

describe('platform capability authority', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('does not let an organisation owner mutate the global capability catalogue', async () => {
    const id = await user('tenant.owner', 'Tenant-owner-2026!'); const now = new Date();
    await new MembershipRepository(pool).grantOrganisation({ organisationId: 'org-001', userId: id, role: 'owner', createdBy: 'test', now });
    const instance = runtime();
    const auth = await login(instance.app, 'tenant.owner', 'Tenant-owner-2026!');
    expect(auth.statusCode).toBe(200);
    const response = await instance.app.inject({ method: 'POST', url: '/admin/capabilities', headers: {
      authorization: `Bearer ${(auth.json() as { token: string }).token}`, 'x-organisation-id': 'org-001',
    }, payload: capability });
    expect(response.statusCode).toBe(403);
    await instance.close();
  });

  it('lets an active Platform Admin with no tenant membership login and curate the global catalogue', async () => {
    const id = await user('platform.admin', 'Platform-admin-2026!'); const now = new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({ userId: id, createdBy: 'bootstrap', now });
    const instance = runtime();
    const auth = await login(instance.app, 'platform.admin', 'Platform-admin-2026!');
    expect(auth.statusCode).toBe(200);
    const response = await instance.app.inject({ method: 'POST', url: '/admin/capabilities', headers: {
      authorization: `Bearer ${(auth.json() as { token: string }).token}`,
    }, payload: capability });
    expect(response.statusCode).toBe(201);
    const platformAudit = await pool.query<{ organisation_id: string | null }>(
      `SELECT organisation_id FROM audit_events WHERE event_type='capability.catalogued'`,
    );
    expect(platformAudit.rows).toEqual([{ organisation_id: null }]);
    await instance.close();
  });

  it('reserves platform-wide release authority for Platform Admin while tenant owners remain tenant-scoped', async () => {
    const platformId = await user('release.platform', 'Release-platform-2026!');
    const ownerId = await user('release.owner', 'Release-owner-2026!');
    const now = new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({ userId: platformId, createdBy: 'bootstrap', now });
    await new MembershipRepository(pool).grantOrganisation({
      organisationId: 'org-001', userId: ownerId, role: 'owner', createdBy: 'test', now,
    });
    const instance = runtime();
    const platformAuth = await login(instance.app, 'release.platform', 'Release-platform-2026!');
    const ownerAuth = await login(instance.app, 'release.owner', 'Release-owner-2026!');
    expect(platformAuth.statusCode).toBe(200);
    expect(ownerAuth.statusCode).toBe(200);
    const platformHeaders = { authorization: `Bearer ${(platformAuth.json() as { token: string }).token}` };
    const ownerHeaders = {
      authorization: `Bearer ${(ownerAuth.json() as { token: string }).token}`,
      'x-organisation-id': 'org-001',
    };
    expect((await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: platformHeaders, payload: capability,
    })).statusCode).toBe(201);
    const denied = await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capability.id}/releases`,
      headers: ownerHeaders, payload: { scope: 'platform' },
    });
    expect(denied.statusCode).toBe(403);
    const released = await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capability.id}/releases`,
      headers: platformHeaders, payload: { scope: 'platform' },
    });
    expect(released.statusCode).toBe(201);
    const releaseId = (released.json() as { id: string }).id;
    const audit = await pool.query<{ organisation_id: string | null }>(
      `SELECT organisation_id FROM audit_events
       WHERE event_type='capability.release.created' AND subject_id=$1`, [releaseId],
    );
    expect(audit.rows).toEqual([{ organisation_id: null }]);
    await instance.close();
  });});
