import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { MembershipRepository, PlatformMembershipRepository, UserRepository } from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const capabilityPayload = {
  id: 'model.openai-api',
  kind: 'model_route',
  source: 'model_gateway',
  sourceRef: 'openai-api',
  displayName: 'OpenAI API',
  maturity: 'supported',
  governanceState: 'approved',
  executionVerification: 'verified',
};

function runtime() {
  return createRuntimeApp({
    DATABASE_URL: databaseUrl,
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_MODEL: 'gpt-test',
    ALLOW_DEV_IDENTITY_HEADERS: 'false',
  });
}
async function seedUser(userId: string, password: string, role: 'owner' | 'admin' | 'member') {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id, userId, passwordHash: await hashPassword(password), status: 'active',
    createdAt: now, updatedAt: now,
  });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: id, role, createdBy: 'test', now,
  });
  if (role === 'owner') await new PlatformMembershipRepository(pool).grantAdmin({ userId: id, createdBy: 'test', now });
  return id;
}

async function seedProject(memberId: string) {
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, 'org-001', 'Governed Routes', 'test', $2,
       'discovery', 'auto', $2)`,
    [id, now],
  );
  await new MembershipRepository(pool).grantProject({
    organisationId: 'org-001', projectId: id, userId: memberId,
    role: 'engineer', createdBy: 'test', now,
  });
  return id;
}
async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  const response = await app.inject({
    method: 'POST', url: '/auth/login', payload: { userId, password },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

async function catalogueAndRelease(
  app: ReturnType<typeof runtime>['app'],
  headers: Record<string, string>,
  projectId: string,
) {
  const created = await app.inject({
    method: 'POST', url: '/admin/capabilities', headers, payload: capabilityPayload,
  });
  expect(created.statusCode).toBe(201);
  const released = await app.inject({
    method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/releases`, headers,
    payload: { scope: 'project', projectId },
  });
  expect(released.statusCode).toBe(201);
}

describe('capability estate governance hardening', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('keeps raw model route inventory Admin-only and gives Studio a project-governed route view', async () => {    const ownerId = await seedUser('govern.owner', 'Govern-owner-2026!', 'owner');
    const memberId = await seedUser('govern.member', 'Govern-member-2026!', 'member');
    const projectId = await seedProject(memberId);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'govern.owner', 'Govern-owner-2026!');
    const memberToken = await login(instance.app, 'govern.member', 'Govern-member-2026!');
    const ownerHeaders = {
      authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001',
    };
    const memberHeaders = {
      authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001',
    };
    await catalogueAndRelease(instance.app, ownerHeaders, projectId);

    const rawMember = await instance.app.inject({
      method: 'GET', url: '/model-routes', headers: memberHeaders,
    });
    expect(rawMember.statusCode).toBe(403);

    const rawOwner = await instance.app.inject({
      method: 'GET', url: '/model-routes', headers: ownerHeaders,
    });
    expect(rawOwner.statusCode).toBe(200);
    expect((rawOwner.json() as Array<{ id: string }>).map((route) => route.id)).toEqual(['openai-api']);

    const governed = await instance.app.inject({
      method: 'GET', url: `/projects/${projectId}/model-routes`, headers: memberHeaders,
    });
    expect(governed.statusCode).toBe(200);    expect(governed.json()).toEqual([
      expect.objectContaining({ id: 'openai-api', provider: 'openai', available: true }),
    ]);
    await instance.close();
    expect(ownerId).not.toBe(memberId);
  });

  it('rolls back a release when its audit event cannot be persisted', async () => {
    const ownerId = await seedUser('audit.owner', 'Audit-owner-2026!', 'owner');
    const projectId = await seedProject(ownerId);
    const instance = runtime();
    const token = await login(instance.app, 'audit.owner', 'Audit-owner-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };
    const created = await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers, payload: capabilityPayload,
    });
    expect(created.statusCode).toBe(201);

    await pool.query(`
      CREATE FUNCTION task9_fail_release_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'capability.release.created' THEN
          RAISE EXCEPTION 'forced release audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER task9_fail_release_audit
      BEFORE INSERT ON audit_events FOR EACH ROW
      EXECUTE FUNCTION task9_fail_release_audit();
    `);    try {
      const response = await instance.app.inject({
        method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/releases`, headers,
        payload: { scope: 'project', projectId },
      });
      expect(response.statusCode).toBe(500);
      const rows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM capability_release_policies
         WHERE capability_id=$1`,
        [capabilityPayload.id],
      );
      expect(rows.rows[0]?.count).toBe('0');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS task9_fail_release_audit ON audit_events');
      await pool.query('DROP FUNCTION IF EXISTS task9_fail_release_audit()');
      await instance.close();
    }
  });
});
