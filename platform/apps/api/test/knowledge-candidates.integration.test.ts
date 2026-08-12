import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPendingKnowledgeCandidate,
  fingerprintKnowledgeCandidate,
  hashPassword,
} from '@engineering-os/domain';
import { ProviderExecutionError } from '@engineering-os/model-gateway';
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
  type ModelRequest,
} from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import {
  KnowledgeCandidateServiceError,
  retryExtractionRun,
} from '../src/knowledge-candidate-service.js';
import { AuthService } from '../src/auth-service.js';
import {
  closeDatabase,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const conversations = new ConversationRepository(pool);
const candidatesRepo = new KnowledgeCandidateRepository(pool);
const knowledgeRepo = new KnowledgeRepository(pool);
const audit = new AuditRepository(pool);

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
      unitOfWork,
      modelGateway: gateway,
      authService,
      allowDevIdentityHeaders: false,
    }),
  };
}

function makeDevApp(gateway: ModelGateway) {
  return buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork: new DatabaseUnitOfWork(pool),
    modelGateway: gateway,
  });
}

const devHeaders = { 'x-organisation-id': 'org-001', 'x-user-id': 'user-001' };

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

async function login(app: ReturnType<typeof buildApp>, userId: string, password: string) {
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

async function seedTwoPendingCandidates(app: ReturnType<typeof buildApp>, projectId: string) {
  // Use dev-mode turn to create pending candidates via the accepted product-partner path.
  // But that requires the dev app + gateway. Instead we insert via direct SQL below where needed.
  return projectId;
}

async function turnWithCandidates(devApp: ReturnType<typeof buildApp>, projectId: string, cands: unknown[]) {
  const response = await devApp.inject({
    method: 'POST', url: `/projects/${projectId}/product-partner-turn`, headers: devHeaders,
    payload: { content: `Discovery: ${randomUUID()}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function insertViaDevPartner(projectId: string, cands: unknown[]) {
  const gateway = new ModelGateway();
  gateway.register(adapter('anthropic', async () => ({ content: envelope('Answer.', cands) })));
  const app = makeDevApp(gateway);
  try {
    await turnWithCandidates(app, projectId, cands);
  } finally {
    await app.close();
  }
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('knowledge candidate review API', () => {
  it('lists pending candidates for a project reader and scopes by organisation', async () => {
    // Create project via dev headers (org-001, user-001) so no membership needed.
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'Vision A', content: 'A visionary product.', basis: 'user_stated' },
        { category: 'risks', title: 'Risk B', content: 'A material risk.', basis: 'assistant_inferred' },
      ]),
    })));
    const app = makeDevApp(gateway);
    try {
      const project = await app.inject({
        method: 'POST', url: '/projects', headers: devHeaders,
        payload: { name: 'Listable Product', preferredProductPartner: 'anthropic' },
      });
      expect(project.statusCode).toBe(201);
      const projectId = (project.json() as { id: string }).id;
      await turnWithCandidates(app, projectId, []);

      const list = await app.inject({
        method: 'GET', url: `/projects/${projectId}/knowledge-candidates?status=pending`,
        headers: devHeaders,
      });
      expect(list.statusCode).toBe(200);
      const body = list.json() as Array<{ status: string; category: string }>;
      expect(body).toHaveLength(2);
      expect(body.every((c) => c.status === 'pending')).toBe(true);

      // Cross-tenant list must not see them.
      const cross = await app.inject({
        method: 'GET', url: `/projects/${projectId}/knowledge-candidates?status=pending`,
        headers: { ...devHeaders, 'x-organisation-id': 'org-002' },
      });
      expect(cross.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('accepts a pending candidate atomically: creates canonical revision 1, provenance, audit; and returns 409 on repeat', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'Original title', content: 'Original content.', basis: 'user_stated' },
      ]),
    })));
    const { app, authService } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner', 'Owner-password-2026!');
      const projectId = await createProjectViaOwner(app, owner.token);

      const turn = await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      expect(turn.statusCode).toBe(201);
      const pending = await candidatesRepo.listByProject('org-001', projectId, 'pending');
      expect(pending).toHaveLength(1);
      const candidateId = pending[0]!.id;

      const accept = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { category: 'vision', title: 'Edited title', content: 'Edited canonical content.' },
      });
      expect(accept.statusCode).toBe(201);
      const acceptBody = accept.json() as {
        candidate: { id: string; status: string; acceptedKnowledgeId: string };
        knowledge: { id: string; revision: number; status: string; source: string; title: string; content: string };
      };
      expect(acceptBody.candidate.status).toBe('accepted');
      expect(acceptBody.knowledge.revision).toBe(1);
      expect(acceptBody.knowledge.status).toBe('confirmed');
      expect(acceptBody.knowledge.source).toBe('extraction_candidate');
      expect(acceptBody.knowledge.title).toBe('Edited title');
      expect(acceptBody.knowledge.content).toBe('Edited canonical content.');
      expect(acceptBody.candidate.acceptedKnowledgeId).toBe(acceptBody.knowledge.id);

      // Original candidate row must remain immutable.
      const storedCand = await pool.query(
        `SELECT title, original_content, category, basis FROM knowledge_candidates WHERE id = $1`,
        [candidateId],
      );
      expect(storedCand.rows[0]).toEqual({
        title: 'Original title',
        original_content: 'Original content.',
        category: 'vision',
        basis: 'user_stated',
      });

      // Explicit provenance is preserved via existing tables + append-only audit:
      //   - candidate.accepted_knowledge_id → canonical knowledge id
      //   - candidate.extraction_run_id     → source extraction run id
      //   - product_knowledge.created audit metadata carries {candidateId, extractionRunId}
      //   - knowledge_candidate.accepted audit metadata carries {acceptedKnowledgeId, extractionRunId}
      // All rows are tenant-scoped by (organisation_id, project_id) constraints in migration 005.
      const candRow = await pool.query(
        `SELECT accepted_knowledge_id, extraction_run_id
           FROM knowledge_candidates
          WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
        ['org-001', projectId, candidateId],
      );
      expect(candRow.rows[0].accepted_knowledge_id).toBe(acceptBody.knowledge.id);
      expect(candRow.rows[0].extraction_run_id).toBe(pending[0]!.extractionRunId);

      // Audit events include acceptance + product_knowledge.created with full provenance metadata.
      const events = await audit.listByProject('org-001', projectId);
      const types = events.map((e) => e.eventType);
      expect(types).toContain('knowledge_candidate.accepted');
      expect(types).toContain('product_knowledge.created');
      const acceptedEvent = events.find((e) => e.eventType === 'knowledge_candidate.accepted')!;
      const acceptedMeta = acceptedEvent.metadata as {
        acceptedKnowledgeId?: string;
        extractionRunId?: string;
      };
      expect(acceptedMeta.acceptedKnowledgeId).toBe(acceptBody.knowledge.id);
      expect(acceptedMeta.extractionRunId).toBe(pending[0]!.extractionRunId);
      const createdEvent = events.find((e) => e.eventType === 'product_knowledge.created')!;
      const createdMeta = createdEvent.metadata as {
        candidateId?: string;
        extractionRunId?: string;
        revision?: number;
      };
      expect(createdMeta.candidateId).toBe(candidateId);
      expect(createdMeta.extractionRunId).toBe(pending[0]!.extractionRunId);
      expect(createdMeta.revision).toBe(1);

      // Repeat accept -> 409.
      const repeat = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(repeat.statusCode).toBe(409);

      // Session cleanup.
      await authService.logout(owner.token);
    } finally {
      await app.close();
    }
  });

  it('rolls back accept when audit persistence fails and leaves candidate pending', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'Rollback candidate', content: 'To roll back.', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner', 'Owner-password-2026!');
      const projectId = await createProjectViaOwner(app, owner.token);
      await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Trigger.' },
      });
      const pending = await candidatesRepo.listByProject('org-001', projectId, 'pending');
      const candidateId = pending[0]!.id;

      await pool.query(`
        CREATE FUNCTION reject_accept_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type = 'product_knowledge.created' THEN
            RAISE EXCEPTION 'forced accept audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER reject_accept_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION reject_accept_audit();
      `);

      try {
        const accept = await app.inject({
          method: 'POST',
          url: `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`,
          headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
          payload: {},
        });
        expect(accept.statusCode).toBe(500);
      } finally {
        await pool.query(`
          DROP TRIGGER IF EXISTS reject_accept_audit_trigger ON audit_events;
          DROP FUNCTION IF EXISTS reject_accept_audit();
        `);
      }

      const stillPending = await candidatesRepo.listByProject('org-001', projectId, 'pending');
      expect(stillPending).toHaveLength(1);
      expect(stillPending[0]!.id).toBe(candidateId);
      expect(stillPending[0]!.acceptedKnowledgeId).toBeUndefined();
      const canonical = await knowledgeRepo.listByProject('org-001', projectId);
      expect(canonical).toEqual([]);
      // No acceptance-side audit rows persisted (transaction fully rolled back).
      const events = await audit.listByProject('org-001', projectId);
      const types = events.map((e) => e.eventType);
      expect(types).not.toContain('knowledge_candidate.accepted');
      expect(types).not.toContain('product_knowledge.created');
    } finally {
      await app.close();
    }
  });

  it('rejects a pending candidate with reason + audit and returns 409 on repeat; no canonical mutation', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'To reject', content: 'Reject me.', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner', 'Owner-password-2026!');
      const projectId = await createProjectViaOwner(app, owner.token);
      await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Trigger.' },
      });
      const pending = await candidatesRepo.listByProject('org-001', projectId, 'pending');
      const candidateId = pending[0]!.id;

      const reject = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/knowledge-candidates/${candidateId}/reject`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { reason: 'not relevant to product' },
      });
      expect(reject.statusCode).toBe(200);
      const body = reject.json() as { candidate: { status: string; rejectionReason: string } };
      expect(body.candidate.status).toBe('rejected');
      expect(body.candidate.rejectionReason).toBe('not relevant to product');

      expect(await knowledgeRepo.listByProject('org-001', projectId)).toEqual([]);

      const events = await audit.listByProject('org-001', projectId);
      expect(events.map((e) => e.eventType)).toContain('knowledge_candidate.rejected');

      const repeat = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/knowledge-candidates/${candidateId}/reject`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(repeat.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('retries a failed extraction run: candidate-only request, no new conversation message, dedup applied, retry audits', async () => {
    await bootstrapOwner();

    // Turn 1: invalid candidate -> run failed.
    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('First answer.', [
        { category: 'not_a_real_category', title: 'Broken', content: 'x', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    let originalMessageCount: number;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover onboarding.' },
      });
      expect(turn.statusCode).toBe(201);
      const tb = turn.json();
      expect(tb.extraction.status).toBe('failed');
      failedRunId = tb.extraction.runId;

      const conv = await conversations.getByProject('org-001', projectId);
      const msgs = await conversations.listMessages('org-001', projectId, conv!.id);
      originalMessageCount = msgs.length;
      expect(originalMessageCount).toBe(2);
    } finally {
      await primaryApp.close();
    }

    // Also seed one canonical knowledge entry so we can prove the retry uses current canonical context.
    // Insert via UoW using a dev app.
    const seedGateway = new ModelGateway();
    seedGateway.register(adapter('anthropic', async () => ({ content: envelope('unused.', []) })));
    const seedApp = makeDevApp(seedGateway);
    try {
      const create = await seedApp.inject({
        method: 'POST', url: `/projects/${projectId!}/knowledge`, headers: devHeaders,
        payload: {
          category: 'stakeholders', title: 'Onboarding owner',
          content: 'The onboarding team owns onboarding UX.',
          source: 'user', status: 'confirmed',
        },
      });
      expect(create.statusCode).toBe(201);
    } finally {
      await seedApp.close();
    }

    // Turn retry: register a gateway that captures the retry request and returns candidate-only structured content
    // that includes one duplicate (of canonical) and one new candidate.
    const retryRequests: ModelRequest[] = [];
    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async (request) => {
      retryRequests.push(request);
      return {
        content: candidateOnly([
          // Duplicate of the canonical entry we just seeded (must be suppressed).
          { category: 'stakeholders', title: 'Onboarding owner', content: 'The onboarding team owns onboarding UX.', basis: 'user_stated' },
          // Fresh candidate.
          { category: 'objectives', title: 'Adoption target', content: 'Reach 10k monthly active users.', basis: 'assistant_recommended' },
        ]),
      };
    }));

    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner', 'Owner-password-2026!');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const rb = retry.json() as {
        retryRunId: string;
        originalRunId: string;
        status: string;
        candidateCount: number;
      };
      expect(rb.originalRunId).toBe(failedRunId!);
      expect(rb.status).toBe('succeeded');
      // duplicate suppressed -> only one new candidate.
      expect(rb.candidateCount).toBe(1);

      // No new conversation messages appended.
      const conv = await conversations.getByProject('org-001', projectId!);
      const msgs = await conversations.listMessages('org-001', projectId!, conv!.id);
      expect(msgs.length).toBe(originalMessageCount!);

      // Retry request used candidate-only response contract (no answer).
      expect(retryRequests).toHaveLength(1);
      const contract = retryRequests[0]!.responseContract;
      expect(contract).toBeDefined();
      expect(contract!.name).toBe('candidate_only_v1');
      const schema = contract!.schema as { properties?: Record<string, unknown>; required?: string[] };
      expect(schema.required).toEqual(['candidates']);
      expect(Object.keys(schema.properties ?? {})).toEqual(['candidates']);

      // Retry provenance is preserved via the retry_completed audit metadata linking
      // originalRunId → retryRunId, plus the retry run row itself (existing migration-005 schema).
      const events = await audit.listByProject('org-001', projectId!);
      const completedEvent = events.find(
        (e) => e.eventType === 'knowledge_extraction_run.retry_completed'
          && (e.metadata as { originalRunId?: string }).originalRunId === failedRunId!,
      );
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.subjectId).toBe(rb.retryRunId);
      const completedMeta = completedEvent!.metadata as {
        originalRunId?: string;
        retryRunId?: string;
        requestedBy?: string;
      };
      expect(completedMeta.originalRunId).toBe(failedRunId!);
      expect(completedMeta.retryRunId).toBe(rb.retryRunId);

      // New extraction run has response_contract_version candidate_only_v1.
      const runRow = await pool.query(
        `SELECT response_contract_version, status, source_user_message_id, source_assistant_message_id
           FROM knowledge_extraction_runs WHERE id = $1`,
        [rb.retryRunId],
      );
      expect(runRow.rows[0].response_contract_version).toBe('candidate_only_v1');
      expect(runRow.rows[0].status).toBe('succeeded');

      // Source messages reused from failed run.
      const originalRow = await pool.query(
        `SELECT source_user_message_id, source_assistant_message_id
           FROM knowledge_extraction_runs WHERE id = $1`,
        [failedRunId!],
      );
      expect(runRow.rows[0].source_user_message_id).toBe(originalRow.rows[0].source_user_message_id);
      expect(runRow.rows[0].source_assistant_message_id).toBe(originalRow.rows[0].source_assistant_message_id);

      // Audit events include both retry_requested (preflight+attempt phases) and retry_completed.
      const types = events.map((e) => e.eventType);
      expect(types).toContain('knowledge_extraction_run.retry_requested');
      expect(types).toContain('knowledge_extraction_run.retry_completed');

      // Retry a succeeded run -> 409.
      const bad = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${rb.retryRunId}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(bad.statusCode).toBe(409);
    } finally {
      await retryApp.close();
    }
  });

  it('ignores a client-supplied status on accept: canonical is always confirmed', async () => {
    await bootstrapOwner();
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', async () => ({
      content: envelope('Answer.', [
        { category: 'vision', title: 'Governance', content: 'Governed content.', basis: 'user_stated' },
      ]),
    })));
    const { app } = makeAuthApp(gateway);
    try {
      const owner = await login(app, 'platform.owner', 'Owner-password-2026!');
      const projectId = await createProjectViaOwner(app, owner.token);
      const turn = await app.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'Discover.' },
      });
      expect(turn.statusCode).toBe(201);
      const pending = await candidatesRepo.listByProject('org-001', projectId, 'pending');
      const candidateId = pending[0]!.id;

      const accept = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/knowledge-candidates/${candidateId}/accept`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { status: 'proposed' },
      });
      expect(accept.statusCode).toBe(201);
      const body = accept.json() as { knowledge: { id: string; status: string; revision: number } };
      expect(body.knowledge.status).toBe('confirmed');
      expect(body.knowledge.revision).toBe(1);

      const canonical = await knowledgeRepo.getById('org-001', projectId, body.knowledge.id);
      expect(canonical?.status).toBe('confirmed');
      expect(canonical?.revision).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('retry with invalid candidate schema emits durable retry_failed audit (no silent swallow)', async () => {
    await bootstrapOwner();

    // Turn 1 fails (invalid category).
    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'discover.' },
      });
      const tb = turn.json();
      failedRunId = tb.extraction.runId;
    } finally {
      await primaryApp.close();
    }

    // Retry gateway returns candidate-only with an invalid category (parse fails).
    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'not_a_real_category', title: 'Broken retry', content: 'x', basis: 'user_stated' },
      ]),
    })));
    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner', 'Owner-password-2026!');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const rb = retry.json() as { status: string; candidateCount: number; retryRunId: string };
      expect(rb.status).toBe('failed');
      expect(rb.candidateCount).toBe(0);

      const events = await audit.listByProject('org-001', projectId!);
      const types = events.map((e) => e.eventType);
      expect(types).toContain('knowledge_extraction_run.retry_requested');
      expect(types).toContain('knowledge_extraction_run.retry_failed');
      const failedEvent = events.find((e) => e.eventType === 'knowledge_extraction_run.retry_failed');
      expect(failedEvent).toBeDefined();
      expect((failedEvent!.metadata as { failureCode?: string }).failureCode)
        .toBe('candidate_validation_failed');

      // Retry run must be persisted with status='failed' (durable failure record).
      const row = await pool.query(
        `SELECT status, failure_code FROM knowledge_extraction_runs WHERE id = $1`,
        [rb.retryRunId],
      );
      expect(row.rows[0].status).toBe('failed');
      expect(row.rows[0].failure_code).toBe('candidate_validation_failed');
    } finally {
      await retryApp.close();
    }
  });

  it('retry surfaces an error (does not silently swallow) if retry_failed audit itself fails', async () => {
    await bootstrapOwner();

    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'audit swallow probe.' },
      });
      failedRunId = turn.json().extraction.runId;
    } finally {
      await primaryApp.close();
    }

    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'not_a_real_category', title: 'B', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner', 'Owner-password-2026!');
      await pool.query(`
        CREATE FUNCTION reject_retry_failed_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type = 'knowledge_extraction_run.retry_failed' THEN
            RAISE EXCEPTION 'forced retry_failed audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER reject_retry_failed_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION reject_retry_failed_audit();
      `);
      try {
        const retry = await retryApp.inject({
          method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
          headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
          payload: {},
        });
        expect(retry.statusCode).toBe(500);
      } finally {
        await pool.query(`
          DROP TRIGGER IF EXISTS reject_retry_failed_audit_trigger ON audit_events;
          DROP FUNCTION IF EXISTS reject_retry_failed_audit();
        `);
      }
    } finally {
      await retryApp.close();
    }
  });

  it('retry with provider execution error still audits retry_requested + retry_failed', async () => {
    await bootstrapOwner();

    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'discover.' },
      });
      failedRunId = turn.json().extraction.runId;
    } finally {
      await primaryApp.close();
    }

    const providerErrorGateway = new ModelGateway();
    providerErrorGateway.register(adapter('anthropic', async () => {
      throw new ProviderExecutionError('anthropic', 'raw-provider-detail-should-not-leak');
    }));
    const { app: retryApp } = makeAuthApp(providerErrorGateway);
    try {
      const owner = await login(retryApp, 'platform.owner', 'Owner-password-2026!');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(502);
      const errBody = retry.json() as { error: string };
      expect(errBody.error).toBe('Live Product Partner execution failed');
      expect(JSON.stringify(errBody)).not.toContain('raw-provider-detail-should-not-leak');

      const events = await audit.listByProject('org-001', projectId!);
      const types = events.map((e) => e.eventType);
      expect(types).toContain('knowledge_extraction_run.retry_requested');
      expect(types).toContain('knowledge_extraction_run.retry_failed');
      const failed = events.find((e) => e.eventType === 'knowledge_extraction_run.retry_failed')!;
      const meta = failed.metadata as { failureCode?: string; originalRunId?: string };
      expect(meta.failureCode).toBe('provider_execution_error');
      expect(meta.originalRunId).toBe(failedRunId!);
    } finally {
      await retryApp.close();
    }
  });

  it('concurrent retries of the same failed run: only one attempt succeeds, the other is 409', async () => {
    await bootstrapOwner();

    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'concurrent discover.' },
      });
      failedRunId = turn.json().extraction.runId;
    } finally {
      await primaryApp.close();
    }

    // Slow-adapter gateway forces both concurrent retries to reach the write UoW at the same time.
    let started = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const slowGateway = new ModelGateway();
    slowGateway.register(adapter('anthropic', async () => {
      started += 1;
      if (started >= 2) release();
      await barrier;
      return {
        content: candidateOnly([
          { category: 'objectives', title: 'Concurrent target', content: 'A concurrent target.', basis: 'assistant_recommended' },
        ]),
      };
    }));

    // Call the service directly so both attempts really overlap on the DB.
    const projectsRepo = new ProjectRepository(pool);
    const project = (await projectsRepo.getById('org-001', projectId!))!;
    const canonical = await knowledgeRepo.listByProject('org-001', projectId!);
    const unitOfWork = new DatabaseUnitOfWork(pool);
    const conversationsRepo = new ConversationRepository(pool);

    async function runOne() {
      try {
        return await retryExtractionRun(unitOfWork, {
          organisationId: 'org-001',
          projectId: projectId!,
          runId: failedRunId!,
          requestedBy: 'race.actor',
          project,
          knowledge: canonical,
          modelGateway: slowGateway,
          conversations: conversationsRepo,
          candidates: candidatesRepo,
        });
      } catch (e) {
        return e;
      }
    }

    const [a, b] = await Promise.all([runOne(), runOne()]);
    expect(started).toBeGreaterThanOrEqual(2);

    const outcomes = [a, b];
    const successes = outcomes.filter((o) => !(o instanceof Error) && (o as { status?: string }).status === 'succeeded');
    const conflicts = outcomes.filter((o) => o instanceof KnowledgeCandidateServiceError && (o as KnowledgeCandidateServiceError).statusCode === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    // Exactly one retry run row must have been persisted (existing migration-005 schema),
    // and exactly one retry_completed audit event whose metadata links to the original run.
    const retryRuns = await pool.query(
      `SELECT id, status FROM knowledge_extraction_runs
        WHERE organisation_id = $1 AND project_id = $2
          AND response_contract_version = 'candidate_only_v1'`,
      ['org-001', projectId!],
    );
    expect(retryRuns.rowCount).toBe(1);
    expect(retryRuns.rows[0].status).toBe('succeeded');
    const events = await audit.listByProject('org-001', projectId!);
    const completed = events.filter(
      (e) => e.eventType === 'knowledge_extraction_run.retry_completed'
        && (e.metadata as { originalRunId?: string }).originalRunId === failedRunId!,
    );
    expect(completed).toHaveLength(1);
  });

  it('allows a genuinely later sequential retry of the same failed original run', async () => {
    await bootstrapOwner();

    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'sequential retry probe.' },
      });
      failedRunId = turn.json().extraction.runId;
    } finally {
      await primaryApp.close();
    }

    // First retry: succeeded and fully complete before the second one is submitted.
    const gwFirst = new ModelGateway();
    gwFirst.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'objectives', title: 'Seq target A', content: 'First sequential retry candidate.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: firstApp } = makeAuthApp(gwFirst);
    let firstRetryRunId: string;
    try {
      const owner = await login(firstApp, 'platform.owner', 'Owner-password-2026!');
      const r1 = await firstApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(r1.statusCode).toBe(201);
      const rb1 = r1.json() as { status: string; retryRunId: string };
      expect(rb1.status).toBe('succeeded');
      firstRetryRunId = rb1.retryRunId;
    } finally {
      await firstApp.close();
    }

    // Second retry begins strictly after the first has completed.
    const gwSecond = new ModelGateway();
    gwSecond.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'risks', title: 'Seq risk B', content: 'Second sequential retry candidate.', basis: 'assistant_inferred' },
      ]),
    })));
    const { app: secondApp } = makeAuthApp(gwSecond);
    try {
      const owner = await login(secondApp, 'platform.owner', 'Owner-password-2026!');
      const r2 = await secondApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(r2.statusCode).toBe(201);
      const rb2 = r2.json() as { status: string; retryRunId: string };
      expect(rb2.status).toBe('succeeded');
      expect(rb2.retryRunId).not.toBe(firstRetryRunId!);
    } finally {
      await secondApp.close();
    }

    // Two retry runs must be persisted (existing schema), and two retry_completed audits linked to the original.
    const retryRuns = await pool.query(
      `SELECT id, status FROM knowledge_extraction_runs
        WHERE organisation_id = $1 AND project_id = $2
          AND response_contract_version = 'candidate_only_v1'
        ORDER BY created_at ASC`,
      ['org-001', projectId!],
    );
    expect(retryRuns.rowCount).toBe(2);
    expect(retryRuns.rows.every((r) => r.status === 'succeeded')).toBe(true);
    const events = await audit.listByProject('org-001', projectId!);
    const completed = events.filter(
      (e) => e.eventType === 'knowledge_extraction_run.retry_completed'
        && (e.metadata as { originalRunId?: string }).originalRunId === failedRunId!,
    );
    expect(completed).toHaveLength(2);
  });

  it('retry suppresses a candidate that matches an existing pending candidate by shared fingerprint', async () => {
    await bootstrapOwner();

    const primary = new ModelGateway();
    primary.register(adapter('anthropic', async () => ({
      content: envelope('Ans.', [
        { category: 'not_a_real_category', title: 'X', content: 'y', basis: 'user_stated' },
      ]),
    })));
    const { app: primaryApp } = makeAuthApp(primary);
    let projectId: string;
    let failedRunId: string;
    try {
      const owner = await login(primaryApp, 'platform.owner', 'Owner-password-2026!');
      projectId = await createProjectViaOwner(primaryApp, owner.token);
      const turn = await primaryApp.inject({
        method: 'POST', url: `/projects/${projectId}/product-partner-turn`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: { content: 'discover pending dedup.' },
      });
      failedRunId = turn.json().extraction.runId;
    } finally {
      await primaryApp.close();
    }

    // Seed an existing pending candidate on some prior run tied to the same conversation/messages.
    // Create a "prior" received-then-succeeded run to hang the pending candidate off of.
    const conv = await conversations.getByProject('org-001', projectId!);
    const msgs = await conversations.listMessages('org-001', projectId!, conv!.id);
    const userMsg = msgs.find((m) => m.role === 'user')!;
    const assistantMsg = msgs.find((m) => m.role === 'assistant')!;

    const priorRunId = randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO knowledge_extraction_runs
         (id, organisation_id, project_id, conversation_id, source_user_message_id, source_assistant_message_id,
          provider, model, route_id, response_contract_version, status, created_at, completed_at)
       VALUES ($1, 'org-001', $2, $3, $4, $5, 'anthropic', 'test-model', 'anthropic-test-api',
               'product_partner_knowledge_v1', 'succeeded', $6, $6)`,
      [priorRunId, projectId, conv!.id, userMsg.id, assistantMsg.id, now],
    );
    const pendingCandidate = createPendingKnowledgeCandidate({
      organisationId: 'org-001',
      projectId: projectId!,
      extractionRunId: priorRunId,
      category: 'objectives',
      title: 'Adoption target',
      content: 'Reach 10k monthly active users.',
      basis: 'assistant_recommended',
    });
    await candidatesRepo.insertCandidate(pendingCandidate);

    // Confirm shared fingerprint fn matches what the service will compute for the retry proposal.
    const proposalFingerprint = fingerprintKnowledgeCandidate({
      category: 'objectives',
      title: 'Adoption target',
      content: 'Reach 10k monthly active users.',
    });
    expect(proposalFingerprint).toBe(pendingCandidate.fingerprint);

    const retryGateway = new ModelGateway();
    retryGateway.register(adapter('anthropic', async () => ({
      content: candidateOnly([
        { category: 'objectives', title: 'Adoption target', content: 'Reach 10k monthly active users.', basis: 'assistant_recommended' },
      ]),
    })));
    const { app: retryApp } = makeAuthApp(retryGateway);
    try {
      const owner = await login(retryApp, 'platform.owner', 'Owner-password-2026!');
      const retry = await retryApp.inject({
        method: 'POST', url: `/projects/${projectId!}/extraction-runs/${failedRunId!}/retry`,
        headers: { authorization: `Bearer ${owner.token}`, 'x-organisation-id': 'org-001' },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const rb = retry.json() as { status: string; candidateCount: number };
      expect(rb.status).toBe('succeeded');
      // Existing pending candidate suppressed the equivalent proposal.
      expect(rb.candidateCount).toBe(0);

      // Only the seeded pending candidate remains; no duplicate was inserted.
      const remaining = await candidatesRepo.listByProject('org-001', projectId!, 'pending');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(pendingCandidate.id);
    } finally {
      await retryApp.close();
    }
  });
});
