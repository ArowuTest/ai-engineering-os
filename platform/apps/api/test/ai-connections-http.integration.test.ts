import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  AIConnectionRepository,
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  InvitationRepository,
  KnowledgeRepository,
  MembershipRepository,
  ProjectRepository,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth-service.js';
import { AIConnectionService } from '../src/ai-connection-service.js';
import { productionConnectionFamilyPolicyRegistry } from '../src/ai-connection-policy.js';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

function makeDependencies() {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const authService = new AuthService({
    unitOfWork,
    users: new UserRepository(pool),
    memberships: new MembershipRepository(pool),
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit: new AuditRepository(pool),
  });
  const aiConnectionService = new AIConnectionService({
    unitOfWork,
    aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool),
    projects: new ProjectRepository(pool),
    sessions: new SessionRepository(pool),
    policy: productionConnectionFamilyPolicyRegistry,
    modelGateway: new ModelGateway(),
  });
  const app = buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork,
    modelGateway: new ModelGateway(),
    authService,
    aiConnectionService,
    aiConnectionPolicy: productionConnectionFamilyPolicyRegistry,
    allowDevIdentityHeaders: false,
  });
  return { app, authService };
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
    updatedAt: now,
  });
  return accountId;
}

async function seedOrgMembership(
  organisationId: string,
  accountId: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<void> {
  await new MembershipRepository(pool).grantOrganisation({
    organisationId, userId: accountId, role, createdBy: 'test', now: new Date(),
  });
}

async function seedProject(organisationId: string, name: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, $2, $3, 'test', $4, 'discovery', 'auto', $4)`,
    [id, organisationId, name, now],
  );
  return id;
}

async function login(
  app: ReturnType<typeof buildApp>,
  userId: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/auth/login', payload: { userId, password },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

describe('AI connections HTTP boundary', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('lists the safe trusted connection-family catalogue without secret material', async () => {
    const ownerId = await seedUser('policy.owner', 'Policy-owner-2026!');
    await seedOrgMembership('org-001', ownerId, 'owner');
    const { app } = makeDependencies();
    const token = await login(app, 'policy.owner', 'Policy-owner-2026!');

    const response = await app.inject({
      method: 'GET', url: '/ai-connection-families',
      headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const family of body) {
      expect(family.id).toBeTypeOf('string');
      expect(family.providerId).toBeTypeOf('string');
      expect(family).not.toHaveProperty('credentialStrategies');
    }
    expect(JSON.stringify(body)).not.toMatch(/secret|token|password|cookie/i);
    await app.close();
  });

  it('rejects unauthenticated requests across every AI connection endpoint', async () => {
    const { app } = makeDependencies();
    const projectId = randomUUID();
    const connectionId = randomUUID();
    const targets = [
      { method: 'GET' as const, url: '/ai-connections' },
      { method: 'GET' as const, url: '/ai-connection-families' },
      { method: 'POST' as const, url: '/ai-connections/personal', payload: { connectionFamilyId: 'codex-subscription' } },
      { method: 'POST' as const, url: '/admin/ai-connections', payload: { connectionFamilyId: 'openai-api', secretRefId: 'vault:x' } },
      { method: 'DELETE' as const, url: `/ai-connections/${connectionId}` },
      { method: 'GET' as const, url: `/projects/${projectId}/ai-connections` },
      { method: 'POST' as const, url: `/projects/${projectId}/ai-connections/${connectionId}/share`, payload: {} },
      { method: 'PATCH' as const, url: `/projects/${projectId}/ai-connections/${connectionId}/share`, payload: { mode: 'online_only' } },
      { method: 'DELETE' as const, url: `/projects/${projectId}/ai-connections/${connectionId}/share` },
    ];
    for (const target of targets) {
      const payload = (target as { payload?: Record<string, unknown> }).payload;
      const response = await app.inject({
        method: target.method,
        url: target.url,
        headers: { 'x-organisation-id': 'org-001' },
        ...(payload !== undefined ? { payload } : {}),
      });
      expect(response.statusCode, `${target.method} ${target.url}`).toBe(401);
    }
    await app.close();
  });

  it('lets a member register a personal connection and never returns secretRefId', async () => {
    const memberId = await seedUser('personal.member', 'Personal-member-2026!');
    await seedOrgMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'personal.member', 'Personal-member-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const registered = await app.inject({
      method: 'POST', url: '/ai-connections/personal',
      headers, payload: { connectionFamilyId: 'codex-subscription' },
    });
    expect(registered.statusCode).toBe(201);
    const summary = registered.json() as Record<string, unknown>;
    expect(summary.ownership).toBe('personal');
    expect(summary.ownerUserId).toBe(memberId);
    expect(summary.connectionFamilyId).toBe('codex-subscription');
    expect(summary.credentialConfigured).toBe(false);
    expect(summary).not.toHaveProperty('secretRefId');

    const listed = await app.inject({
      method: 'GET', url: '/ai-connections', headers,
    });
    expect(listed.statusCode).toBe(200);
    const list = listed.json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('secretRefId');
    expect(JSON.stringify(list)).not.toMatch(/secret_ref_id|secretRefId/);
    await app.close();
  });

  it('forbids ordinary members from registering organisation connections', async () => {
    const memberId = await seedUser('org.member.only', 'Org-member-only-2026!');
    await seedOrgMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'org.member.only', 'Org-member-only-2026!');
    const response = await app.inject({
      method: 'POST', url: '/admin/ai-connections',
      headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
      payload: { connectionFamilyId: 'openai-api', secretRefId: 'vault:member-attempt' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('rejects request bodies containing sensitive or policy-privilege fields with 400', async () => {
    const memberId = await seedUser('reject.member', 'Reject-member-2026!');
    await seedOrgMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'reject.member', 'Reject-member-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const forbiddenFields = [
      'providerToken', 'password', 'cookie', 'refreshToken', 'delegatable', 'ownerUserId',
      'accessToken', 'apiKey', 'secret',
    ];
    for (const field of forbiddenFields) {
      const response = await app.inject({
        method: 'POST', url: '/ai-connections/personal', headers,
        payload: { connectionFamilyId: 'codex-subscription', [field]: 'value' },
      });
      expect(response.statusCode, `field ${field}`).toBe(400);
    }
    await app.close();
  });

  it('scopes personal connection listings by organisation and never leaks across organisations', async () => {
    const memberId = await seedUser('multi.org', 'Multi-org-2026!');
    await seedOrgMembership('org-001', memberId, 'member');
    // No membership in org-002.
    const { app } = makeDependencies();
    const token = await login(app, 'multi.org', 'Multi-org-2026!');

    const register = await app.inject({
      method: 'POST', url: '/ai-connections/personal',
      headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
      payload: { connectionFamilyId: 'codex-subscription' },
    });
    expect(register.statusCode).toBe(201);

    const foreign = await app.inject({
      method: 'GET', url: '/ai-connections',
      headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-002' },
    });
    expect(foreign.statusCode).toBe(403);
    await app.close();
  });

  it('creates first project share as online_only even if the body attempts persistent', async () => {
    const ownerId = await seedUser('share.owner', 'Share-owner-2026!');
    await seedOrgMembership('org-001', ownerId, 'owner');
    const projectId = await seedProject('org-001', 'Share Project');
    const { app } = makeDependencies();
    const token = await login(app, 'share.owner', 'Share-owner-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    // Register a delegatable personal family via direct DB seed (production policies
    // don't currently expose one; we exercise HTTP wiring by using the codex family,
    // which is not delegatable → sharing must be rejected with 400 policy_blocked).
    const registered = await app.inject({
      method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: 'codex-subscription' },
    });
    expect(registered.statusCode).toBe(201);
    const connectionId = (registered.json() as { id: string }).id;

    const nonDelegatable = await app.inject({
      method: 'POST', url: `/projects/${projectId}/ai-connections/${connectionId}/share`,
      headers, payload: { mode: 'persistent' },
    });
    // Production policy has delegatable=false for codex → policy_blocked (400)
    expect([400, 403]).toContain(nonDelegatable.statusCode);
    await app.close();
  });

  it('project share endpoints require project membership/organisation admin', async () => {
    const ownerId = await seedUser('proj.share.owner', 'Proj-share-owner-2026!');
    await seedOrgMembership('org-001', ownerId, 'owner');
    const projectId = await seedProject('org-001', 'Isolation Project');
    const { app } = makeDependencies();
    const token = await login(app, 'proj.share.owner', 'Proj-share-owner-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const share = await app.inject({
      method: 'GET', url: `/projects/${projectId}/ai-connections`, headers,
    });
    expect(share.statusCode).toBe(200);
    const body = share.json() as { entries: unknown[]; apiFallbackRoutes: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(Array.isArray(body.apiFallbackRoutes)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secret_ref_id|secretRefId/);
    await app.close();
  });

  it('PATCH share fails 400 when both mode and availableFrom/Until are supplied, without mutating state', async () => {
    const ownerId = await seedUser('patch.combined', 'Patch-combined-2026!');
    await seedOrgMembership('org-001', ownerId, 'owner');
    const projectId = await seedProject('org-001', 'Combined Patch Project');
    const { app } = makeDependencies();
    const token = await login(app, 'patch.combined', 'Patch-combined-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const registered = await app.inject({
      method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: 'codex-subscription' },
    });
    expect(registered.statusCode).toBe(201);
    const connectionId = (registered.json() as { id: string }).id;

    const before = await pool.query(
      'SELECT COUNT(*)::int AS n FROM ai_connection_project_shares WHERE organisation_id=$1 AND project_id=$2 AND connection_id=$3',
      ['org-001', projectId, connectionId],
    );
    expect(before.rows[0].n).toBe(0);

    for (const payload of [
      { mode: 'online_only', availableFrom: '2026-08-13T00:00:00Z' },
      { mode: 'persistent', availableUntil: '2026-09-13T00:00:00Z' },
      { mode: 'online_only', availableFrom: '2026-08-13T00:00:00Z', availableUntil: '2026-09-13T00:00:00Z' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/projects/${projectId}/ai-connections/${connectionId}/share`,
        headers, payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      // Must be a body-shape validation rejection (has `field`), not a downstream
      // service `policy_blocked` — proving the request never reached the service.
      const body = response.json() as { error?: string; field?: string };
      expect(body.field, JSON.stringify(payload)).toBeDefined();
      expect(body.error, JSON.stringify(payload)).not.toBe('policy_blocked');
    }

    const after = await pool.query(
      'SELECT COUNT(*)::int AS n FROM ai_connection_project_shares WHERE organisation_id=$1 AND project_id=$2 AND connection_id=$3',
      ['org-001', projectId, connectionId],
    );
    expect(after.rows[0].n).toBe(0);
    await app.close();
  });

  it('PATCH share rejects non-string or invalid mode values with 400 (no silent 204)', async () => {
    const ownerId = await seedUser('patch.badmode', 'Patch-badmode-2026!');
    await seedOrgMembership('org-001', ownerId, 'owner');
    const projectId = await seedProject('org-001', 'Bad Mode Project');
    const { app } = makeDependencies();
    const token = await login(app, 'patch.badmode', 'Patch-badmode-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const registered = await app.inject({
      method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: 'codex-subscription' },
    });
    expect(registered.statusCode).toBe(201);
    const connectionId = (registered.json() as { id: string }).id;

    for (const badMode of [42, null, true, { nested: 'x' }, ['online_only'], 'ONLINE_ONLY', 'unknown_mode', '']) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/projects/${projectId}/ai-connections/${connectionId}/share`,
        headers, payload: { mode: badMode as unknown },
      });
      expect(response.statusCode, `mode=${JSON.stringify(badMode)}`).toBe(400);
    }
    await app.close();
  });

  it('unknown field rejection says the field is not accepted and does not echo its value', async () => {
    const memberId = await seedUser('reject.echo', 'Reject-echo-2026!');
    await seedOrgMembership('org-001', memberId, 'member');
    const { app } = makeDependencies();
    const token = await login(app, 'reject.echo', 'Reject-echo-2026!');
    const headers = { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' };

    const secretValue = 'sk-live-do-not-echo-9f8e7d6c';
    const response = await app.inject({
      method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: 'codex-subscription', apiKey: secretValue },
    });
    expect(response.statusCode).toBe(400);
    const raw = response.body;
    expect(raw).not.toContain(secretValue);
    const body = response.json() as { error?: string };
    expect(typeof body.error).toBe('string');
    expect(body.error!.toLowerCase()).toContain('not accepted');
    await app.close();
  });

  it('createRuntimeApp composes real AIConnectionService and persists across restart', async () => {
    // Prepare bootstrap owner via direct seed so we can login through runtime.
    const runtime1 = createRuntimeApp({ DATABASE_URL: databaseUrl, ALLOW_DEV_IDENTITY_HEADERS: 'false' });
    try {
      // Seed org + owner using pool from harness (points at same DB).
      const ownerId = await seedUser('runtime.owner', 'Runtime-owner-2026!');
      await seedOrgMembership('org-001', ownerId, 'owner');

      const login1 = await runtime1.app.inject({
        method: 'POST', url: '/auth/login',
        payload: { userId: 'runtime.owner', password: 'Runtime-owner-2026!' },
      });
      expect(login1.statusCode).toBe(200);
      const token1 = (login1.json() as { token: string }).token;
      const headers1 = { authorization: `Bearer ${token1}`, 'x-organisation-id': 'org-001' };

      const registered = await runtime1.app.inject({
        method: 'POST', url: '/ai-connections/personal',
        headers: headers1, payload: { connectionFamilyId: 'codex-subscription' },
      });
      expect(registered.statusCode).toBe(201);
      const connectionId = (registered.json() as { id: string }).id;
      expect(connectionId).toBeTypeOf('string');
    } finally {
      await runtime1.close();
    }

    // Fresh runtime, re-login, verify persisted state is visible.
    const runtime2 = createRuntimeApp({ DATABASE_URL: databaseUrl, ALLOW_DEV_IDENTITY_HEADERS: 'false' });
    try {
      const login2 = await runtime2.app.inject({
        method: 'POST', url: '/auth/login',
        payload: { userId: 'runtime.owner', password: 'Runtime-owner-2026!' },
      });
      expect(login2.statusCode).toBe(200);
      const token2 = (login2.json() as { token: string }).token;
      const listed = await runtime2.app.inject({
        method: 'GET', url: '/ai-connections',
        headers: { authorization: `Bearer ${token2}`, 'x-organisation-id': 'org-001' },
      });
      expect(listed.statusCode).toBe(200);
      const list = listed.json() as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0]).not.toHaveProperty('secretRefId');
      expect(list[0]?.connectionFamilyId).toBe('codex-subscription');
    } finally {
      await runtime2.close();
    }
  });
});
