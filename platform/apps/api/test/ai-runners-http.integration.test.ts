import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  AIRunnerRepository,
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  InvitationRepository,
  KnowledgeRepository,
  MembershipRepository,
  ProjectRepository,
  SessionRepository,
  UserRepository
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth-service.js';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { createRuntimeApp } from '../src/server.js';
import { closeDatabase, databaseUrl, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';
function makeDependencies() {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const memberships = new MembershipRepository(pool);
  const audit = new AuditRepository(pool);
  const authService = new AuthService({
    unitOfWork,
    users: new UserRepository(pool),
    memberships,
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit
  });
  const aiRunnerService = new AIRunnerService({
    unitOfWork,
    aiRunners: new AIRunnerRepository(pool),
    memberships,
    audit
  });
  const app = buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork,
    modelGateway: new ModelGateway(),
    authService,
    aiRunnerService,
    allowDevIdentityHeaders: false
  } as Parameters<typeof buildApp>[0]);
  return { app, authService, aiRunnerService };
}
async function seedUser(userId: string, password: string): Promise<string> {
  const now = new Date();
  const accountId = randomUUID();
  await new UserRepository(pool).create({
    id: accountId,
    userId,
    passwordHash: await hashPassword(password),
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
  return accountId;
}

async function seedMembership(organisationId: string, accountId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  await new MembershipRepository(pool).grantOrganisation({
    organisationId,
    userId: accountId,
    role,
    createdBy: 'test',
    now: new Date()
  });
}

async function login(app: ReturnType<typeof buildApp>, userId: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { userId, password }
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

function userHeaders(token: string, organisationId = 'org-001') {
  return {
    authorization: `Bearer ${token}`,
    'x-organisation-id': organisationId
  };
}

function personalRegistration() {
  return {
    ownership: 'personal',
    harnessId: 'codex',
    persistentSupported: true,
    capabilities: ['chat', 'tools']
  };
}

describe('AI runners HTTP boundary', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());
  it('registers a personal runner with one-time credential and redacted listing', async () => {
    const memberId = await seedUser('runner.http.member', 'Runner-http-member-2026!');
    await seedMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.http.member', 'Runner-http-member-2026!');

    const registered = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token),
      payload: personalRegistration()
    });
    expect(registered.statusCode).toBe(201);
    const created = registered.json() as { runnerId: string; credential: string };
    expect(created.credential.length).toBeGreaterThan(30);

    const listed = await app.inject({
      method: 'GET',
      url: '/ai-runners',
      headers: userHeaders(token)
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ id: string }>).map(value => value.id)).toContain(created.runnerId);
    expect(JSON.stringify(listed.json())).not.toContain(created.credential);
    expect(JSON.stringify(listed.json())).not.toMatch(/credentialHash|password|cookie|refreshToken/i);
    await app.close();
  });
  it('keeps user sessions and runner bearer credentials on separate auth paths', async () => {
    const memberId = await seedUser('runner.auth.separate', 'Runner-auth-separate-2026!');
    await seedMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.auth.separate', 'Runner-auth-separate-2026!');
    const registered = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token),
      payload: personalRegistration()
    });
    const created = registered.json() as { credential: string };

    const userAsRunner = await app.inject({
      method: 'GET',
      url: '/runner/status',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(userAsRunner.statusCode).toBe(401);

    const runnerAsUser = await app.inject({
      method: 'GET',
      url: '/ai-runners',
      headers: userHeaders(created.credential)
    });
    expect(runnerAsUser.statusCode).toBe(401);

    const runnerStatus = await app.inject({
      method: 'GET',
      url: '/runner/status',
      headers: { authorization: `Bearer ${created.credential}`, 'x-organisation-id': 'forged-org' }
    });
    expect(runnerStatus.statusCode).toBe(200);
    expect(runnerStatus.json()).toMatchObject({ organisationId: 'org-001' });
    await app.close();
  });
  it('rejects provider secrets and caller-controlled identity fields at the runner HTTP boundary', async () => {
    const memberId = await seedUser('runner.fields.member', 'Runner-fields-member-2026!');
    await seedMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.fields.member', 'Runner-fields-member-2026!');
    const headers = userHeaders(token);

    for (const field of ['providerToken', 'password', 'cookie', 'refreshToken', 'apiKey', 'ownerUserId', 'actorUserId', 'organisationId', 'credentialHash', 'now']) {
      const response = await app.inject({
        method: 'POST',
        url: '/ai-runners',
        headers,
        payload: { ...personalRegistration(), [field]: 'forbidden' }
      });
      expect(response.statusCode, `field ${field}`).toBe(400);
    }

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/runner/heartbeat',
      headers: { authorization: 'Bearer invalid' },
      payload: { seenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), runnerId: 'spoof' }
    });
    expect(heartbeat.statusCode).toBe(400);
    await app.close();
  });
  it('accepts runner heartbeat then rejects it immediately after disable and revoke', async () => {
    const memberId = await seedUser('runner.heartbeat.http', 'Runner-heartbeat-http-2026!');
    await seedMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.heartbeat.http', 'Runner-heartbeat-http-2026!');
    const registered = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token),
      payload: personalRegistration()
    });
    const created = registered.json() as { runnerId: string; credential: string };
    const seenAt = new Date();
    const heartbeat = () =>
      app.inject({
        method: 'POST',
        url: '/runner/heartbeat',
        headers: { authorization: `Bearer ${created.credential}` },
        payload: { seenAt: seenAt.toISOString(), expiresAt: new Date(seenAt.getTime() + 60_000).toISOString() }
      });
    expect((await heartbeat()).statusCode).toBe(204);

    const disabled = await app.inject({
      method: 'POST',
      url: `/ai-runners/${created.runnerId}/disable`,
      headers: userHeaders(token),
      payload: {}
    });
    expect(disabled.statusCode).toBe(204);
    expect((await heartbeat()).statusCode).toBe(401);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/ai-runners/${created.runnerId}`,
      headers: userHeaders(token)
    });
    expect(revoked.statusCode).toBe(204);
    expect((await heartbeat()).statusCode).toBe(401);
    await app.close();
  });
  it('enforces organisation runner RBAC and admin-only trust governance', async () => {
    const memberId = await seedUser('runner.org.member', 'Runner-org-member-2026!');
    const adminId = await seedUser('runner.org.admin', 'Runner-org-admin-2026!');
    await seedMembership('org-001', memberId, 'member');
    await seedMembership('org-001', adminId, 'admin');
    const { app } = makeDependencies();
    const memberToken = await login(app, 'runner.org.member', 'Runner-org-member-2026!');
    const adminToken = await login(app, 'runner.org.admin', 'Runner-org-admin-2026!');
    const orgPayload = { ...personalRegistration(), ownership: 'organisation' };

    const denied = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(memberToken),
      payload: orgPayload
    });
    expect(denied.statusCode).toBe(403);
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(adminToken),
      payload: orgPayload
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json() as { runnerId: string };

    const trustDenied = await app.inject({
      method: 'PATCH',
      url: `/ai-runners/${created.runnerId}/trust`,
      headers: userHeaders(memberToken),
      payload: { trustState: 'trusted' }
    });
    expect(trustDenied.statusCode).toBe(403);
    const trusted = await app.inject({
      method: 'PATCH',
      url: `/ai-runners/${created.runnerId}/trust`,
      headers: userHeaders(adminToken),
      payload: { trustState: 'trusted' }
    });
    expect(trusted.statusCode).toBe(204);
    await app.close();
  });
  it('rotates the runner platform credential and invalidates the old bearer immediately', async () => {
    const memberId = await seedUser('runner.rotate.http', 'Runner-rotate-http-2026!');
    await seedMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.rotate.http', 'Runner-rotate-http-2026!');
    const registered = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token),
      payload: personalRegistration()
    });
    const created = registered.json() as { runnerId: string; credential: string };

    const rotated = await app.inject({
      method: 'POST',
      url: `/ai-runners/${created.runnerId}/rotate`,
      headers: userHeaders(token),
      payload: {}
    });
    expect(rotated.statusCode).toBe(200);
    const replacement = rotated.json() as { credential: string };
    expect(replacement.credential).not.toBe(created.credential);
    expect(JSON.stringify(replacement)).not.toMatch(/credentialHash|providerToken|cookie|refreshToken/i);

    const oldStatus = await app.inject({
      method: 'GET',
      url: '/runner/status',
      headers: { authorization: `Bearer ${created.credential}` }
    });
    const newStatus = await app.inject({
      method: 'GET',
      url: '/runner/status',
      headers: { authorization: `Bearer ${replacement.credential}` }
    });
    expect(oldStatus.statusCode).toBe(401);
    expect(newStatus.statusCode).toBe(200);
    await app.close();
  });
  it('keeps runner administration tenant-scoped and ignores forged tenant headers on runner auth', async () => {
    await pool.query(`INSERT INTO organisations (id, name) VALUES ('org-002', 'Organisation Two') ON CONFLICT (id) DO NOTHING`);
    const memberId = await seedUser('runner.multi.org', 'Runner-multi-org-2026!');
    await seedMembership('org-001', memberId, 'member');
    await seedMembership('org-002', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'runner.multi.org', 'Runner-multi-org-2026!');
    const first = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token, 'org-001'),
      payload: personalRegistration()
    });
    const second = await app.inject({
      method: 'POST',
      url: '/ai-runners',
      headers: userHeaders(token, 'org-002'),
      payload: personalRegistration()
    });
    const firstRunner = first.json() as { runnerId: string; credential: string };
    const secondRunner = second.json() as { runnerId: string };

    const orgOne = await app.inject({
      method: 'GET',
      url: '/ai-runners',
      headers: userHeaders(token, 'org-001')
    });
    expect(orgOne.statusCode).toBe(200);
    expect((orgOne.json() as Array<{ id: string }>).map(value => value.id)).toEqual([firstRunner.runnerId]);
    expect(JSON.stringify(orgOne.json())).not.toContain(secondRunner.runnerId);

    const status = await app.inject({
      method: 'GET',
      url: '/runner/status',
      headers: { authorization: `Bearer ${firstRunner.credential}`, 'x-organisation-id': 'org-002' }
    });
    expect(status.json()).toMatchObject({ organisationId: 'org-001', runnerId: firstRunner.runnerId });
    await app.close();
  });
  it('wires the runner service into runtime composition and survives an app restart', async () => {
    const ownerId = await seedUser('runner.runtime.owner', 'Runner-runtime-owner-2026!');
    await seedMembership('org-001', ownerId, 'owner');
    const runtime1 = createRuntimeApp({
      DATABASE_URL: databaseUrl,
      ALLOW_DEV_IDENTITY_HEADERS: 'false'
    });
    let runnerId = '';
    let credential = '';
    try {
      const token = await login(runtime1.app, 'runner.runtime.owner', 'Runner-runtime-owner-2026!');
      const registered = await runtime1.app.inject({
        method: 'POST',
        url: '/ai-runners',
        headers: userHeaders(token),
        payload: personalRegistration()
      });
      expect(registered.statusCode).toBe(201);
      const created = registered.json() as { runnerId: string; credential: string };
      runnerId = created.runnerId;
      credential = created.credential;
    } finally {
      await runtime1.close();
    }

    const runtime2 = createRuntimeApp({ DATABASE_URL: databaseUrl, ALLOW_DEV_IDENTITY_HEADERS: 'false' });
    try {
      const token = await login(runtime2.app, 'runner.runtime.owner', 'Runner-runtime-owner-2026!');
      const listed = await runtime2.app.inject({ method: 'GET', url: '/ai-runners', headers: userHeaders(token) });
      expect((listed.json() as Array<{ id: string }>).map(value => value.id)).toContain(runnerId);
      const status = await runtime2.app.inject({
        method: 'GET',
        url: '/runner/status',
        headers: { authorization: `Bearer ${credential}` }
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ organisationId: 'org-001', runnerId });
    } finally {
      await runtime2.close();
    }
  });
});
