import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
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
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

function dependencies() {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const authService = new AuthService({
    unitOfWork,
    users: new UserRepository(pool),
    memberships: new MembershipRepository(pool),
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit: new AuditRepository(pool),
  });
  return {
    authService,
    app: buildApp({
      projects: new ProjectRepository(pool),
      knowledge: new KnowledgeRepository(pool),
      conversations: new ConversationRepository(pool),
      unitOfWork,
      modelGateway: new ModelGateway(),
      authService,
      allowDevIdentityHeaders: false,
    }),
  };
}

async function bootstrapOwner() {
  const now = new Date();
  const userId = randomUUID();
  await new UserRepository(pool).create({
    id: userId,
    userId: 'platform.owner',
    passwordHash: await hashPassword('Owner-password-2026!'),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId, role: 'owner', createdBy: 'bootstrap', now,
  });
  return userId;
}

async function insertProject(name: string) {
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, 'org-001', $2, 'bootstrap', $3, 'discovery', 'auto', $3)`,
    [id, name, now],
  );
  return id;
}

async function login(app: ReturnType<typeof buildApp>, userId: string, password: string) {
  const response = await app.inject({
    method: 'POST', url: '/auth/login', payload: { userId, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { token: string };
}

describe('authentication HTTP boundary', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('rejects protected Product Studio routes when no session is supplied', async () => {
    await bootstrapOwner();
    const { app } = dependencies();
    const response = await app.inject({ method: 'GET', url: '/projects', headers: { 'x-organisation-id': 'org-001' } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('supports User ID/password login and resolves /auth/me without exposing password/session hashes', async () => {
    await bootstrapOwner();
    const { app } = dependencies();
    const authenticated = await login(app, 'Platform.Owner', 'Owner-password-2026!');

    const me = await app.inject({
      method: 'GET', url: '/auth/me',
      headers: { authorization: `Bearer ${authenticated.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: 'platform.owner' });
    expect(JSON.stringify(me.json())).not.toMatch(/password|token_hash|password_hash/i);
    await app.close();
  });

  it('creates a one-time invitation over HTTP and redeems it into a real account', async () => {
    await bootstrapOwner();
    const projectId = await insertProject('Shared Product');
    const { app } = dependencies();
    const owner = await login(app, 'platform.owner', 'Owner-password-2026!');

    const invite = await app.inject({
      method: 'POST', url: '/auth/invitations',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'x-organisation-id': 'org-001',
      },
      payload: {
        organisationRole: 'member',
        ttlMinutes: 30,
        projectGrants: [{ projectId, role: 'contributor' }],
      },
    });
    expect(invite.statusCode).toBe(201);
    const invitation = invite.json() as { key: string; invitationId: string };
    expect(invitation.key.length).toBeGreaterThan(30);

    const redeem = await app.inject({
      method: 'POST', url: '/auth/redeem',
      payload: {
        key: invitation.key,
        userId: 'new.collaborator',
        password: 'Collaborator-password-2026!',
      },
    });
    expect(redeem.statusCode).toBe(201);
    expect(redeem.json()).toMatchObject({ userId: 'new.collaborator' });

    const second = await app.inject({
      method: 'POST', url: '/auth/redeem',
      payload: {
        key: invitation.key,
        userId: 'second.collaborator',
        password: 'Second-password-2026!',
      },
    });
    expect(second.statusCode).toBe(410);
    await app.close();
  });

  it('shows a member only projects they currently have access to', async () => {
    const ownerId = await bootstrapOwner();
    const projectOne = await insertProject('Allowed Product');
    const projectTwo = await insertProject('Hidden Product');
    const auth = dependencies();

    const invitation = await auth.authService.createInvitation({
      organisationId: 'org-001', actorUserId: ownerId,
      organisationRole: 'member',
      projectGrants: [{ projectId: projectOne, role: 'viewer' }],
    });
    await auth.authService.redeemInvitation({
      key: invitation.key,
      userId: 'scoped.member',
      password: 'Scoped-member-2026!',
    });
    const member = await login(auth.app, 'scoped.member', 'Scoped-member-2026!');

    const list = await auth.app.inject({
      method: 'GET', url: '/projects',
      headers: {
        authorization: `Bearer ${member.token}`,
        'x-organisation-id': 'org-001',
      },
    });
    expect(list.statusCode).toBe(200);
    const projects = list.json() as Array<{ id: string; name: string }>;
    expect(projects.map((project) => project.id)).toEqual([projectOne]);
    expect(projects.map((project) => project.id)).not.toContain(projectTwo);
    await auth.app.close();
  });

  it('enforces project roles: viewers are read-only and contributors cannot approve knowledge', async () => {
    await bootstrapOwner();
    const auth = dependencies();
    const owner = await login(auth.app, 'platform.owner', 'Owner-password-2026!');
    const ownerHeaders = { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' };
    const created = await auth.app.inject({ method: 'POST', url: '/projects', headers: ownerHeaders, payload: { name: 'RBAC Product' } });
    expect(created.statusCode).toBe(201);
    const projectId = (created.json() as { id: string }).id;

    const viewerInvite = await auth.authService.createInvitation({ organisationId: 'org-001', actorUserId: (await auth.authService.resolveSession(owner.token))!.accountId, organisationRole: 'member', projectGrants: [{ projectId, role: 'viewer' }] });
    await auth.authService.redeemInvitation({ key: viewerInvite.key, userId: 'read.only', password: 'Read-only-password-2026!' });
    const viewer = await login(auth.app, 'read.only', 'Read-only-password-2026!');
    const viewerHeaders = { authorization: `Bearer ${viewer.token}`, 'x-organisation-id': 'org-001' };
    expect((await auth.app.inject({ method: 'GET', url: `/projects/${projectId}`, headers: viewerHeaders })).statusCode).toBe(200);
    expect((await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/messages`, headers: viewerHeaders, payload: { content: 'Viewer must not write' } })).statusCode).toBe(403);
    expect((await auth.app.inject({ method: 'PATCH', url: `/projects/${projectId}/product-partner`, headers: viewerHeaders, payload: { preferredProductPartner: 'openai' } })).statusCode).toBe(403);

    const contributorInvite = await auth.authService.createInvitation({ organisationId: 'org-001', actorUserId: (await auth.authService.resolveSession(owner.token))!.accountId, organisationRole: 'member', projectGrants: [{ projectId, role: 'contributor' }] });
    await auth.authService.redeemInvitation({ key: contributorInvite.key, userId: 'product.contributor', password: 'Contributor-password-2026!' });
    const contributor = await login(auth.app, 'product.contributor', 'Contributor-password-2026!');
    const contributorHeaders = { authorization: `Bearer ${contributor.token}`, 'x-organisation-id': 'org-001' };
    expect((await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/knowledge`, headers: contributorHeaders, payload: { category: 'vision', title: 'Premature approval', content: 'Must not be approved by contributor', source: 'contributor', status: 'approved' } })).statusCode).toBe(403);    const knowledge = await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/knowledge`, headers: contributorHeaders, payload: { category: 'vision', title: 'Candidate vision', content: 'A proposed product vision', source: 'contributor', status: 'proposed' } });
    expect(knowledge.statusCode).toBe(201);
    const knowledgeId = (knowledge.json() as { id: string }).id;
    expect((await auth.app.inject({ method: 'PATCH', url: `/projects/${projectId}/knowledge/${knowledgeId}`, headers: contributorHeaders, payload: { status: 'approved' } })).statusCode).toBe(403);
    expect((await auth.app.inject({ method: 'PATCH', url: `/projects/${projectId}/knowledge/${knowledgeId}`, headers: ownerHeaders, payload: { status: 'approved' } })).statusCode).toBe(200);
    await auth.app.close();
  });
  it('exposes safe people, invitation policy and project access administration to owners', async () => {
    const ownerId = await bootstrapOwner();
    const projectId = await insertProject('Admin Project');
    const auth = dependencies();
    const owner = await login(auth.app, 'platform.owner', 'Owner-password-2026!');
    const baseHeaders = { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' };
    const invite = await auth.authService.createInvitation({ organisationId: 'org-001', actorUserId: ownerId, organisationRole: 'member', projectGrants: [] });
    const member = await auth.authService.redeemInvitation({ key: invite.key, userId: 'admin.target', password: 'Admin-target-2026!' });

    expect((await auth.app.inject({ method: 'PATCH', url: '/admin/invitation-policy', headers: baseHeaders, payload: { ttlMinutes: 60 } })).statusCode).toBe(200);
    const policy = await auth.app.inject({ method: 'GET', url: '/admin/invitation-policy', headers: baseHeaders });
    expect(policy.json()).toEqual({ ttlMinutes: 60 });

    expect((await auth.app.inject({ method: 'PUT', url: `/projects/${projectId}/members/${member.id}`, headers: baseHeaders, payload: { role: 'reviewer' } })).statusCode).toBe(200);
    const people = await auth.app.inject({ method: 'GET', url: '/admin/users', headers: baseHeaders });
    expect(people.statusCode).toBe(200);
    expect(JSON.stringify(people.json())).not.toMatch(/password|tokenHash|token_hash/i);
    expect((people.json() as Array<{ userId: string; projects: Array<{ role: string }> }>).find((person) => person.userId === 'admin.target')?.projects[0]?.role).toBe('reviewer');

    expect((await auth.app.inject({ method: 'DELETE', url: `/projects/${projectId}/members/${member.id}`, headers: baseHeaders })).statusCode).toBe(204);
    expect((await auth.app.inject({ method: 'PATCH', url: `/admin/users/${member.id}`, headers: baseHeaders, payload: { status: 'suspended' } })).statusCode).toBe(200);
    await auth.app.close();
  });

  it('scopes knowledge candidate review to product_owner and 403s Contributor/Engineer/Reviewer/Viewer', async () => {
    const ownerId = await bootstrapOwner();
    const auth = dependencies();
    const owner = await login(auth.app, 'platform.owner', 'Owner-password-2026!');
    const ownerHeaders = { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' };
    const created = await auth.app.inject({ method: 'POST', url: '/projects', headers: ownerHeaders, payload: { name: 'Review RBAC' } });
    expect(created.statusCode).toBe(201);
    const projectId = (created.json() as { id: string }).id;

    // Seed a pending candidate + failed extraction run directly via SQL bound to real message rows.
    const conversation = await pool.query<{ id: string }>(
      `SELECT id FROM conversations WHERE project_id = $1`, [projectId],
    );
    const conversationId = conversation.rows[0]!.id;
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO conversation_messages
        (id, organisation_id, project_id, conversation_id, role, content, created_by, created_at)
       VALUES ($1, 'org-001', $2, $3, 'user', 'seed user', 'seed', $4),
              ($5, 'org-001', $2, $3, 'assistant', 'seed assistant', 'seed', $4)`,
      [userMessageId, projectId, conversationId, now, assistantMessageId],
    );
    const runIdOk = randomUUID();
    const runIdFailed = randomUUID();
    await pool.query(
      `INSERT INTO knowledge_extraction_runs
         (id, organisation_id, project_id, conversation_id, source_user_message_id, source_assistant_message_id,
          provider, model, route_id, response_contract_version, status, created_at, completed_at, failure_code, failure_message)
       VALUES ($1, 'org-001', $2, $3, $4, $5, 'anthropic', 'test-model', 'anthropic-test-api',
               'product_partner_knowledge_v1', 'succeeded', $6, $6, NULL, NULL),
              ($7, 'org-001', $2, $3, $4, $5, 'anthropic', 'test-model', 'anthropic-test-api',
               'product_partner_knowledge_v1', 'failed', $6, $6, 'candidate_validation_failed', NULL)`,
      [runIdOk, projectId, conversationId, userMessageId, assistantMessageId, now, runIdFailed],
    );
    const candidateId = randomUUID();
    await pool.query(
      `INSERT INTO knowledge_candidates
         (id, organisation_id, project_id, extraction_run_id, category, title, original_content,
          basis, status, fingerprint, created_at)
       VALUES ($1, 'org-001', $2, $3, 'vision', 'Cand', 'Cand content.', 'user_stated', 'pending',
               'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4', $4)`,
      [candidateId, projectId, runIdOk, now],
    );

    const roles = ['contributor', 'engineer', 'reviewer', 'viewer'] as const;
    for (const role of roles) {
      const invite = await auth.authService.createInvitation({
        organisationId: 'org-001', actorUserId: ownerId,
        organisationRole: 'member',
        projectGrants: [{ projectId, role }],
      });
      const uid = `role.${role}`;
      await auth.authService.redeemInvitation({ key: invite.key, userId: uid, password: `Role-${role}-pw-2026!` });
      const session = await login(auth.app, uid, `Role-${role}-pw-2026!`);
      const headers = { authorization: `Bearer ${session.token}`, 'x-organisation-id': 'org-001' };

      // All roles may LIST.
      const list = await auth.app.inject({ method: 'GET', url: `/projects/${projectId}/knowledge-candidates?status=pending`, headers });
      expect(list.statusCode).toBe(200);

      const accept = await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`, headers, payload: {} });
      expect(accept.statusCode).toBe(403);
      const reject = await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/knowledge-candidates/${candidateId}/reject`, headers, payload: {} });
      expect(reject.statusCode).toBe(403);
      const retry = await auth.app.inject({ method: 'POST', url: `/projects/${projectId}/extraction-runs/${runIdFailed}/retry`, headers, payload: {} });
      expect(retry.statusCode).toBe(403);
    }

    await auth.app.close();
  });

  it('revokes the current bearer session on logout', async () => {
    await bootstrapOwner();
    const { app } = dependencies();
    const authenticated = await login(app, 'platform.owner', 'Owner-password-2026!');
    const headers = { authorization: `Bearer ${authenticated.token}` };

    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).statusCode).toBe(401);
    await app.close();
  });
});
