import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityRecord, createCapabilityReleasePolicy, createConversation,
  createKnowledgeRecord, createProject,
} from '@engineering-os/domain';
import {
  AssuranceRepository, CapabilityEstateRepository, ConversationRepository,
  DatabaseUnitOfWork, KnowledgeRepository, MembershipRepository,
  PlatformMembershipRepository, ProjectRepository, UserRepository,
} from '@engineering-os/database';
import {
  ModelGateway, type ModelAdapter, type ModelRequest, type ModelRoute,
} from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { CapabilityEstateService } from '../src/capability-estate-service.js';
import { RequirementsAssuranceService } from '../src/requirements-assurance-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const organisationId = 'org-001';
const now = new Date('2026-08-20T11:30:00.000Z');
let actorUserId = '';
function route(id: string, provider: string, priority: number): ModelRoute {
  return {
    id, provider, model: `${provider}-${id}`, executionMode: 'api', costType: 'metered_api',
    available: true, priority,
    capabilities: {
      chat: true, tools: false, vision: false, files: false, mcp: false,
      localWorkspace: false, headless: true, structuredOutput: true,
    },
  };
}

function adapter(modelRoute: ModelRoute, requests: ModelRequest[]): ModelAdapter {
  return {
    route: modelRoute,
    async execute(request) {
      requests.push(request);
      if (request.role === 'requirements_reviewer') {
        return { content: JSON.stringify({ findings: [{
          severity: 'important', kind: 'failure_mode', category: 'payments',
          summary: 'Unknown payment state after timeout is unresolved.',
          rationale: 'Retrying blindly can duplicate a charge.',
          proposedQuestion: 'How should an unknown provider payment state be reconciled before retry?',
          suggestedDirection: 'Query provider state and enforce idempotency.',
          basis: 'trained_knowledge', evidenceReferences: ['conversation:payment-timeout'],
        }] }) };
      }
      return { content: JSON.stringify({ answer: 'We should resolve the unknown payment state first.', candidates: [] }) };
    },
  };
}
async function seedProject() {
  actorUserId = randomUUID();
  await new UserRepository(pool).create({
    id: actorUserId, userId: 'assurance.http.owner', passwordHash: 'test-hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  const memberships = new MembershipRepository(pool);
  await memberships.grantOrganisation({
    organisationId, userId: actorUserId, role: 'owner', createdBy: 'test', now,
  });
  const project = createProject({
    organisationId, name: 'Assurance HTTP Project', preferredProductPartner: 'openai', createdBy: actorUserId,
  });
  await new ProjectRepository(pool).create(project);
  await memberships.grantProject({
    organisationId, projectId: project.id, userId: actorUserId,
    role: 'product_owner', createdBy: actorUserId, now,
  });
  const conversation = createConversation({ organisationId, projectId: project.id, createdBy: actorUserId });
  await new ConversationRepository(pool).create(conversation);
  await new KnowledgeRepository(pool).create(createKnowledgeRecord({
    organisationId, projectId: project.id, category: 'business_rules', title: 'Retry payments',
    content: 'Users may retry a timed-out card payment.', source: 'accepted_candidate',
    status: 'approved', createdBy: actorUserId,
  }));
  return project;
}

async function release(projectId: string, id: string, kind: 'agent' | 'harness' | 'model_route', sourceRef: string) {
  const store = new CapabilityEstateRepository(pool);
  await store.createCapability(createCapabilityRecord({
    id, kind, source: kind === 'model_route' ? 'model_gateway' : 'aios', sourceRef,
    displayName: id, maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'test', createdAt: now,
  }));
  await store.createRelease(createCapabilityReleasePolicy({
    id: `release.${id}.${projectId.slice(0, 8)}`, capabilityId: id, scope: 'project',
    organisationId, projectId, createdBy: 'test', createdAt: now,
  }));
}
function appWith(gateway: ModelGateway) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const capabilityEstateService = new CapabilityEstateService({
    unitOfWork, capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool),
    platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool), modelGateway: gateway,
  });
  const requirementsAssuranceService = new RequirementsAssuranceService({
    unitOfWork,
    projects: new ProjectRepository(pool),
    conversations: new ConversationRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    assurance: new AssuranceRepository(pool),
    capabilityEstateService,
    modelGateway: gateway,
  });
  return buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork,
    modelGateway: gateway,
    capabilityEstateService,
    requirementsAssuranceService,
  });
}

async function releaseStudioDefaults(projectId: string) {
  await release(projectId, 'agent.requirements_reviewer', 'agent', 'requirements-reviewer');
  await release(projectId, 'agent.lead', 'agent', 'agents/lead.md');
  await release(projectId, 'harness.codex', 'harness', 'harness:codex');
  await release(projectId, 'model.openai-studio', 'model_route', 'openai-studio-api');
  await release(projectId, 'model.anthropic-review', 'model_route', 'anthropic-review-api');
}

beforeEach(async () => { await resetDatabase(); });
afterAll(async () => closeDatabase());
describe('Requirements Assurance HTTP lifecycle', () => {
  it('creates and reads an independently governed Requirements Assurance review', async () => {
    const project = await seedProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 20), requests));
    await releaseStudioDefaults(project.id);
    const app = appWith(gateway);
    const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };

    const created = await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance`, headers,
      payload: { reviewerRouteId: 'anthropic-review-api' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      run: { reviewerAgentCapabilityId: 'agent.requirements_reviewer', reviewerRouteId: 'anthropic-review-api' },
      readiness: { status: 'not_ready' },
    });
    const current = await app.inject({
      method: 'GET', url: `/projects/${project.id}/requirements-assurance`, headers,
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ readiness: { status: 'not_ready' } });
    expect((current.json() as { findings: unknown[] }).findings).toHaveLength(1);
    await app.close();
  });
  it('feeds unresolved material review questions to the Product Partner without making them canonical knowledge', async () => {
    const project = await seedProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 20), requests));
    await releaseStudioDefaults(project.id);
    const app = appWith(gateway);
    const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };

    await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance`, headers,
      payload: { reviewerRouteId: 'anthropic-review-api' },
    });
    const before = await new KnowledgeRepository(pool).listByProject(organisationId, project.id);
    const turn = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Continue defining the payment flow.', modelRouteId: 'openai-studio-api' },
    });
    expect(turn.statusCode).toBe(201);
    const productRequest = requests.find((request) => request.role === 'product_partner');
    const context = productRequest?.messages.map((message) => message.content).join('\n') ?? '';
    expect(context).toContain('Unknown payment state after timeout is unresolved.');
    expect(context).toContain('How should an unknown provider payment state be reconciled before retry?');
    expect(context).toContain('review findings are non-canonical');
    expect(await new KnowledgeRepository(pool).listByProject(organisationId, project.id)).toEqual(before);
    await app.close();
  });

  it('invalidates stale readiness when governed Studio state changes', async () => {
    const project = await seedProject();
    const gateway = new ModelGateway();
    const requests: ModelRequest[] = [];
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 1), requests));
    gateway.register(adapter(route('openai-studio-api', 'openai', 5), requests));
    await releaseStudioDefaults(project.id);
    const app = appWith(gateway);
    const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };
    await app.inject({ method: 'POST', url: `/projects/${project.id}/requirements-assurance`, headers,
      payload: { reviewerRouteId: 'anthropic-review-api' } });

    await new KnowledgeRepository(pool).create(createKnowledgeRecord({
      organisationId, projectId: project.id, category: 'security', title: 'Admin MFA',
      content: 'Admin actions require MFA.', source: 'accepted_candidate', status: 'approved', createdBy: actorUserId,
    }));
    const current = await app.inject({ method: 'GET', url: `/projects/${project.id}/requirements-assurance`, headers });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      run: { status: 'invalidated' }, readiness: { status: 'insufficient_evidence' },
    });
    await app.close();
  });
});

describe('Requirements Readiness engineering-stage gate', () => {
  it('fails closed before engineering planning until the exact current requirements state is ready', async () => {
    const project = await seedProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 20), requests));
    await releaseStudioDefaults(project.id);
    const app = appWith(gateway);
    const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };

    const withoutReview = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/stage`, headers,
      payload: { stage: 'engineering_planning' },
    });
    expect(withoutReview.statusCode).toBe(409);
    expect(withoutReview.json()).toEqual({ error: 'conflict' });

    const reviewed = await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance`, headers,
      payload: { reviewerRouteId: 'anthropic-review-api' },
    });
    expect(reviewed.statusCode).toBe(201);
    expect(reviewed.json()).toMatchObject({ readiness: { status: 'not_ready' } });

    const blocked = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/stage`, headers,
      payload: { stage: 'engineering_planning' },
    });
    expect(blocked.statusCode).toBe(409);

    const findingId = (reviewed.json() as { findings: Array<{ id: string }> }).findings[0]!.id;
    const closed = await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance/findings/${findingId}/close`, headers,
      payload: { status: 'resolved', resolutionNote: 'Unknown provider state is now reconciled before retry.' },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ readiness: { status: 'ready' } });

    const advanced = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/stage`, headers,
      payload: { stage: 'engineering_planning' },
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({ id: project.id, stage: 'engineering_planning' });

    const stored = await new ProjectRepository(pool).getById(organisationId, project.id);
    expect(stored?.stage).toBe('engineering_planning');
    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE project_id=$1 AND event_type='project.stage.changed'`, [project.id],
    );
    expect(audit.rows).toEqual([{ event_type: 'project.stage.changed' }]);
    await app.close();
  }, 90_000);
});

describe('Requirements Assurance finding decisions', () => {
  it('lets Product Owner explicitly dismiss a current finding with reason and recalculates readiness', async () => {
    const project = await seedProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 20), requests));
    await releaseStudioDefaults(project.id);
    const app = appWith(gateway);
    const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };
    const reviewed = await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance`, headers,
      payload: { reviewerRouteId: 'anthropic-review-api' },
    });
    const findingId = (reviewed.json() as { findings: Array<{ id: string }> }).findings[0]!.id;
    const closed = await app.inject({
      method: 'POST', url: `/projects/${project.id}/requirements-assurance/findings/${findingId}/close`, headers,
      payload: { status: 'dismissed', resolutionNote: 'The provider lookup-before-retry rule is already accepted elsewhere.' },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      findings: [{ id: findingId, status: 'dismissed' }], readiness: { status: 'ready' },
    });
    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE event_type='assurance.finding.closed'`,
    );
    expect(audit.rows).toEqual([{ event_type: 'assurance.finding.closed' }]);
    await app.close();
  });
});
