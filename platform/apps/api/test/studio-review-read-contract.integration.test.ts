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

  // Critical B (C2b): supersession of a failed extraction run must be scoped to the
  // *same source turn lineage* — a later unrelated succeeded turn (different source
  // user/assistant message ids) must NOT hide the still-retryable failed run. Retries
  // reuse the original source message ids, so a same-lineage success clears it.
  it('preserves the failed run when an unrelated later turn succeeds, and clears/re-exposes it based on retry lineage', async () => {
    await bootstrapOwner();

    // Turn A: extraction fails (invalid category).
    const gatewayA = new ModelGateway();
    gatewayA.register(adapter('anthropic', async () => ({
      content: envelope('Turn A answer.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: appA } = makeAuthApp(gatewayA);
    let projectId: string; let ownerToken: string; let failedRunId: string;
    try {
      const owner = await login(appA, 'platform.owner');
      ownerToken = owner.token;
      projectId = await createProjectViaOwner(appA, owner.token);
      const turnA = await appA.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Turn A user content.' },
      });
      expect(turnA.statusCode).toBe(201);
      const tab = turnA.json() as { extraction: { status: string; runId: string } };
      expect(tab.extraction.status).toBe('failed');
      failedRunId = tab.extraction.runId;
    } finally {
      await appA.close();
    }

    // Turn B: unrelated later turn — succeeds with a different pair of source message ids.
    const gatewayB = new ModelGateway();
    gatewayB.register(adapter('anthropic', async () => ({
      content: envelope('Turn B answer.', [
        { category: 'objectives', title: 'Adoption', content: 'Reach 10k MAU.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: appB } = makeAuthApp(gatewayB);
    try {
      const owner = await login(appB, 'platform.owner');
      const turnB = await appB.inject({
        method: 'POST', url: `/projects/${projectId!}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Turn B user content — completely different.' },
      });
      expect(turnB.statusCode).toBe(201);
      expect((turnB.json() as { extraction: { status: string } }).extraction.status).toBe('succeeded');

      // (1) Turn A's failed run must STILL be exposed — a later unrelated success does not hide it.
      const studio1 = await appB.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body1 = studio1.json() as { latestFailedExtractionRun: { id: string } | null };
      expect(body1.latestFailedExtractionRun).not.toBeNull();
      expect(body1.latestFailedExtractionRun!.id).toBe(failedRunId!);
    } finally {
      await appB.close();
    }

    // Successful retry of Turn A: same source message ids → must clear the banner.
    const retryOkGateway = new ModelGateway();
    retryOkGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'objectives', title: 'Retry ok', content: 'Same source succeeded.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: retryOkApp } = makeAuthApp(retryOkGateway);
    try {
      const owner = await login(retryOkApp, 'platform.owner');
      const retry = await retryOkApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      expect((retry.json() as { status: string }).status).toBe('succeeded');

      const studio2 = await retryOkApp.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body2 = studio2.json() as { latestFailedExtractionRun: unknown };
      expect(body2.latestFailedExtractionRun).toBeNull();
    } finally {
      await retryOkApp.close();
    }

    // Now trigger a Turn C that FAILS for the same source lineage? We can't easily replay Turn A.
    // Instead: fire a fresh Turn C that fails. Then a subsequent successful retry of Turn C.
    // That doesn't cover the same lineage. To cover "failed retry of Turn A → exposed", we need to
    // make a retry of Turn A fail even though Turn A was already cleared by the ok retry above.
    // The retry service rejects if the ORIGINAL run status !== 'failed'. Since Turn A is still
    // marked failed (retries create new rows, they never mutate the original), we can retry again.
    ownerToken; // silence unused warning

    const retryFailGateway = new ModelGateway();
    retryFailGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'not_a_real_category', title: 'Bad', content: 'z', basis: 'user_stated' },
      ]),
    })));
    const { app: retryFailApp } = makeAuthApp(retryFailGateway);
    let failedRetryRunId: string;
    try {
      const owner = await login(retryFailApp, 'platform.owner');
      const retry = await retryFailApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const rb = retry.json() as { retryRunId: string; status: string };
      expect(rb.status).toBe('failed');
      failedRetryRunId = rb.retryRunId;

      // (2) A later failed retry of the same lineage must become the newly exposed banner run.
      const studio3 = await retryFailApp.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body3 = studio3.json() as { latestFailedExtractionRun: { id: string } | null };
      expect(body3.latestFailedExtractionRun).not.toBeNull();
      expect(body3.latestFailedExtractionRun!.id).toBe(failedRetryRunId);
    } finally {
      await retryFailApp.close();
    }

    // (3) A subsequent successful retry of the same source lineage must clear again.
    const retryOk2Gateway = new ModelGateway();
    retryOk2Gateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'vision', title: 'Second retry ok', content: 'Same source succeeded.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: retryOk2App } = makeAuthApp(retryOk2Gateway);
    try {
      const owner = await login(retryOk2App, 'platform.owner');
      const retry = await retryOk2App.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      expect((retry.json() as { status: string }).status).toBe('succeeded');

      const studio4 = await retryOk2App.inject({
        method: 'GET', url: `/projects/${projectId!}/studio`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
      });
      const body4 = studio4.json() as { latestFailedExtractionRun: unknown };
      expect(body4.latestFailedExtractionRun).toBeNull();
    } finally {
      await retryOk2App.close();
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
