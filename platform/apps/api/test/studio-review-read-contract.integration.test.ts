import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  InvitationRepository,
  KnowledgeCandidateRepository,
  KnowledgeRepository,
  MembershipRepository,
  ProjectRepository,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import {
  ModelGateway,
  type ModelAdapter,
  type ModelProvider,
} from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth-service.js';
import {
  closeDatabase,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

function adapter(
  provider: ModelProvider,
  execute: ModelAdapter['execute'],
  priority = 10,
): ModelAdapter {
  return {
    route: {
      id: `${provider}-test-api`, provider, model: `${provider}-test-model`,
      executionMode: 'api', costType: 'metered_api', available: true, priority,
      capabilities: {
        chat: true, tools: false, vision: false, files: false, mcp: false,
        localWorkspace: false, headless: true, structuredOutput: true,
      },
    },
    execute,
  };
}

function envelope(answer: string, candidates: unknown[] = []): string {
  return JSON.stringify({ answer, candidates });
}

function candidateOnly(candidates: unknown[]): string {
  return JSON.stringify({ candidates });
}

function makeAuthApp(gateway: ModelGateway) {
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
      knowledgeCandidates: new KnowledgeCandidateRepository(pool),
      unitOfWork,
      modelGateway: gateway,
      authService,
      allowDevIdentityHeaders: false,
    }),
  };
}

async function bootstrapOwner(userId = 'platform.owner') {
  const now = new Date();
  const id = randomUUID();
  await new UserRepository(pool).create({
    id,
    userId,
    passwordHash: await hashPassword('Owner-password-2026!'),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: id, role: 'owner', createdBy: 'bootstrap', now,
  });
  return id;
}

async function bootstrapMember(userId: string) {
  const now = new Date();
  const id = randomUUID();
  await new UserRepository(pool).create({
    id,
    userId,
    passwordHash: await hashPassword('Member-password-2026!'),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: id, role: 'member', createdBy: 'bootstrap', now,
  });
  return id;
}

async function login(app: ReturnType<typeof buildApp>, userId: string, password = 'Owner-password-2026!') {
  const response = await app.inject({
    method: 'POST', url: '/auth/login', payload: { userId, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { token: string };
}

async function createProjectViaOwner(app: ReturnType<typeof buildApp>, token: string, name = 'Review Product') {
  const created = await app.inject({
    method: 'POST', url: '/projects',
    headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
    payload: { name, preferredProductPartner: 'anthropic' },
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('GET /projects/:id/studio exposes durable review context', () => {
  it('returns viewerProjectRole equal to the exact project role resolved by resolveIdentity', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({ content: envelope('.', []) })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, owner.token);

      const ownerStudio = await app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      expect(ownerStudio.statusCode).toBe(200);
      // Project creator gets an explicit product_owner grant; the studio response must
      // reflect the exact role from resolveIdentity, never derived from org role.
      expect((ownerStudio.json() as { viewerProjectRole: string }).viewerProjectRole)
        .toBe('product_owner');

      // A plain org member with an explicit product_owner grant on this project must see
      // viewerProjectRole === 'product_owner' too.
      const memberAccountId = await bootstrapMember('project.member');
      await new MembershipRepository(pool).grantProject({
        organisationId: 'org-001', projectId, userId: memberAccountId,
        role: 'product_owner', createdBy: 'bootstrap', now: new Date(),
      });
      const member = await login(app, 'project.member', 'Member-password-2026!');
      const memberStudio = await app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${member.token}`, 'x-organisation-id': 'org-001' },
      });
      expect(memberStudio.statusCode).toBe(200);
      expect((memberStudio.json() as { viewerProjectRole: string }).viewerProjectRole)
        .toBe('product_owner');
    } finally {
      await app.close();
    }
  });

  it('returns viewerProjectRole=null for org owners without an explicit project grant', async () => {
    // A second org-owner (no project grant) should NOT be reported as product_owner just because they are org-owner.
    await bootstrapOwner('platform.owner');
    const otherOwnerId = randomUUID();
    const now = new Date();
    await new UserRepository(pool).create({
      id: otherOwnerId, userId: 'other.owner',
      passwordHash: await hashPassword('Owner-password-2026!'), status: 'active',
      createdAt: now, updatedAt: now,
    });
    await new MembershipRepository(pool).grantOrganisation({
      organisationId: 'org-001', userId: otherOwnerId, role: 'owner', createdBy: 'bootstrap', now,
    });

    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({ content: envelope('.', []) })));
    const { app } = makeAuthApp(gateway);
    try {
      const first = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, first.token);

      const second = await login(app, 'other.owner');
      const studio = await app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${second.token}`, 'x-organisation-id': 'org-001' },
      });
      expect(studio.statusCode).toBe(200);
      const body = studio.json() as { viewerProjectRole: string | null };
      expect(body.viewerProjectRole).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('scopes studio reads by tenant: cross-organisation viewer gets 403/404, never leaked state', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({ content: envelope('.', []) })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, owner.token);
      const cross = await app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-002' },
      });
      expect([403, 404]).toContain(cross.statusCode);
    } finally {
      await app.close();
    }
  });

  it('exposes durable latestFailedExtractionRun derived from persisted extraction runs', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer stays visible.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, owner.token);
      const turn = await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      expect(turn.statusCode).toBe(201);
      const tb = turn.json() as { extraction: { status: string; runId: string } };
      expect(tb.extraction.status).toBe('failed');

      const studio = await app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      expect(studio.statusCode).toBe(200);
      const body = studio.json() as {
        latestFailedExtractionRun: null | {
          id: string; status: string; provider: string; model: string; routeId: string;
          sourceUserMessageId: string; sourceAssistantMessageId: string;
          failureCode: string; createdAt: string;
        };
      };
      expect(body.latestFailedExtractionRun).not.toBeNull();
      const run = body.latestFailedExtractionRun!;
      expect(run.id).toBe(tb.extraction.runId);
      expect(run.status).toBe('failed');
      expect(run.provider).toBe('anthropic');
      expect(run.model).toBe('anthropic-test-model');
      expect(run.routeId).toBe('anthropic-test-api');
      expect(typeof run.sourceUserMessageId).toBe('string');
      expect(typeof run.sourceAssistantMessageId).toBe('string');
      expect(run.failureCode.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('drops latestFailedExtractionRun after a successful retry (no stale retry banner source)', async () => {
    await bootstrapOwner();
    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string; let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      failedRunId = (turn.json() as { extraction: { runId: string } }).extraction.runId;
    } finally {
      await primaryApp.close();
    }

    // Successful retry: banner must disappear.
    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'objectives', title: 'Adoption target', content: 'Reach 10k monthly active users.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);

      const studio = await retryApp.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body = studio.json() as { latestFailedExtractionRun: unknown };
      expect(body.latestFailedExtractionRun).toBeNull();
    } finally {
      await retryApp.close();
    }
  });

  it('surfaces a later failed retry as the new latestFailedExtractionRun (later failed run is itself retryable)', async () => {
    await bootstrapOwner();
    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string; let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      failedRunId = (turn.json() as { extraction: { runId: string } }).extraction.runId;
    } finally {
      await primaryApp.close();
    }

    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'not_a_real_category', title: 'Broken retry', content: 'x', basis: 'user_stated' },
      ]),
    })));
    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const rb = retry.json() as { retryRunId: string; status: string };
      expect(rb.status).toBe('failed');

      const studio = await retryApp.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body = studio.json() as { latestFailedExtractionRun: { id: string } | null };
      expect(body.latestFailedExtractionRun).not.toBeNull();
      expect(body.latestFailedExtractionRun!.id).toBe(rb.retryRunId);
    } finally {
      await retryApp.close();
    }
  });
});

describe('GET /projects/:id/knowledge-candidates exposes exact per-candidate sourceRun metadata', () => {
  it('enriches each candidate with sourceRun {id,status,provider,model,routeId,source message ids}', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'Vision', content: 'A visionary product.', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, owner.token);
      const turn = await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      expect(turn.statusCode).toBe(201);
      const runId = (turn.json() as { extraction: { runId: string } }).extraction.runId;

      const list = await app.inject({
        method: 'GET', url: `/projects/${projectId}/knowledge-candidates?status=pending`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      expect(list.statusCode).toBe(200);
      const rows = list.json() as Array<{
        id: string; extractionRunId: string;
        sourceRun: {
          id: string; status: string; provider: string; model: string; routeId: string;
          sourceUserMessageId: string; sourceAssistantMessageId: string;
        };
      }>;
      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.sourceRun).toBeDefined();
      expect(row.sourceRun.id).toBe(runId);
      expect(row.sourceRun.id).toBe(row.extractionRunId);
      expect(row.sourceRun.status).toBe('succeeded');
      expect(row.sourceRun.provider).toBe('anthropic');
      expect(row.sourceRun.model).toBe('anthropic-test-model');
      expect(row.sourceRun.routeId).toBe('anthropic-test-api');
      expect(typeof row.sourceRun.sourceUserMessageId).toBe('string');
      expect(typeof row.sourceRun.sourceAssistantMessageId).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('scopes candidate sourceRun reads by tenant: cross-organisation viewer sees nothing', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('.', [
        { category: 'vision', title: 'Vision', content: 'A visionary product.', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner');
      const projectId = await createProjectViaOwner(app, owner.token);
      await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: '.' },
      });

      const cross = await app.inject({
        method: 'GET', url: `/projects/${projectId}/knowledge-candidates?status=pending`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-002' },
      });
      expect([403, 404]).toContain(cross.statusCode);
    } finally {
      await app.close();
    }
  });
});
