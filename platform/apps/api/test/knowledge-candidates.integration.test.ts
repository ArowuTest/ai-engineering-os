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
  type ModelRequest,
} from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
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

      // Provenance row exists.
      const prov = await pool.query(
        `SELECT candidate_id, extraction_run_id, knowledge_id, revision
           FROM product_knowledge_provenance
          WHERE knowledge_id = $1`,
        [acceptBody.knowledge.id],
      );
      expect(prov.rowCount).toBe(1);
      expect(prov.rows[0].candidate_id).toBe(candidateId);
      expect(prov.rows[0].revision).toBe(1);
      expect(prov.rows[0].extraction_run_id).toBe(pending[0]!.extractionRunId);

      // Audit events include acceptance + product_knowledge.created.
      const events = await audit.listByProject('org-001', projectId);
      const types = events.map((e) => e.eventType);
      expect(types).toContain('knowledge_candidate.accepted');
      expect(types).toContain('product_knowledge.created');

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
      const canonical = await knowledgeRepo.listByProject('org-001', projectId);
      expect(canonical).toEqual([]);
      const prov = await pool.query(`SELECT 1 FROM product_knowledge_provenance`);
      expect(prov.rowCount).toBe(0);
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

      // Retry attempt row.
      const attempts = await pool.query(
        `SELECT original_run_id, retry_run_id, requested_by
           FROM knowledge_extraction_retry_attempts
          WHERE original_run_id = $1`,
        [failedRunId!],
      );
      expect(attempts.rowCount).toBe(1);
      expect(attempts.rows[0].retry_run_id).toBe(rb.retryRunId);

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

      // Audit events.
      const events = await audit.listByProject('org-001', projectId!);
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
});
