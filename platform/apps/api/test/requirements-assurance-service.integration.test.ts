import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityRecord, createCapabilityReleasePolicy, createConversation,
  createConversationMessage, createKnowledgeRecord, createProject,
} from '@engineering-os/domain';
import {
  AssuranceRepository, CapabilityEstateRepository, ConversationRepository,
  DatabaseUnitOfWork, KnowledgeRepository, MembershipRepository,
  PlatformMembershipRepository, ProjectRepository, UserRepository,
} from '@engineering-os/database';
import {
  ModelGateway, ProviderExecutionError,
  type ModelAdapter, type ModelRequest, type ModelRoute,
} from '@engineering-os/model-gateway';
import { CapabilityEstateService } from '../src/capability-estate-service.js';
import { RequirementsAssuranceService } from '../src/requirements-assurance-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const organisationId = 'org-001';
const now = new Date('2026-08-20T11:00:00.000Z');
let actorUserId = '';
function route(id: string, provider: string, priority: number): ModelRoute {
  return {
    id, provider, model: `${provider}-review-model`, executionMode: 'api',
    costType: 'metered_api', available: true, priority,
    capabilities: {
      chat: true, tools: false, vision: false, files: false, mcp: false,
      localWorkspace: false, headless: true, structuredOutput: true,
    },
  };
}

function adapter(
  modelRoute: ModelRoute,
  requests: ModelRequest[],
  execute: (request: ModelRequest) => Promise<{ content: string }> = async () => ({
    content: JSON.stringify({ findings: [] }),
  }),
): ModelAdapter {
  return {
    route: modelRoute,
    async execute(request) {
      requests.push(request);
      return execute(request);
    },
  };
}
async function seedActorAndProject() {
  actorUserId = randomUUID();
  await new UserRepository(pool).create({
    id: actorUserId, userId: 'requirements.reviewer.owner', passwordHash: 'test-hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  const memberships = new MembershipRepository(pool);
  await memberships.grantOrganisation({
    organisationId, userId: actorUserId, role: 'owner', createdBy: 'test', now,
  });
  const project = createProject({
    organisationId, name: 'Assured Checkout', preferredProductPartner: 'openai',
    createdBy: actorUserId,
  });
  await new ProjectRepository(pool).create(project);
  await memberships.grantProject({
    organisationId, projectId: project.id, userId: actorUserId,
    role: 'product_owner', createdBy: actorUserId, now,
  });
  const conversation = createConversation({ organisationId, projectId: project.id, createdBy: actorUserId });
  await new ConversationRepository(pool).create(conversation);
  await new ConversationRepository(pool).appendMessage(createConversationMessage({
    organisationId, projectId: project.id, conversationId: conversation.id,
    role: 'user', content: 'Customers pay by card and retry after a timeout.', createdBy: actorUserId,
  }));
  await new KnowledgeRepository(pool).create(createKnowledgeRecord({
    organisationId, projectId: project.id, category: 'business_rules',
    title: 'Payment retry', content: 'A customer may retry a timed-out payment.',
    source: 'accepted_candidate', status: 'approved', createdBy: actorUserId,
  }));
  return project;
}
async function releaseCapability(
  projectId: string, id: string, kind: 'agent' | 'model_route', sourceRef: string,
) {
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

function buildService(gateway: ModelGateway, reviewExecutionTimeoutMs = 2_000) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const capabilityEstateService = new CapabilityEstateService({
    unitOfWork, capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool),
    platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool), modelGateway: gateway,
  });
  return new RequirementsAssuranceService({
    unitOfWork,
    projects: new ProjectRepository(pool),
    conversations: new ConversationRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    assurance: new AssuranceRepository(pool),
    capabilityEstateService,
    modelGateway: gateway,
    reviewExecutionTimeoutMs,
  });
}

beforeEach(async () => { await resetDatabase(); });
afterAll(async () => closeDatabase());
describe('RequirementsAssuranceService', () => {
  it('uses an independently governed reviewer agent and exact reviewer route against governed Studio state', async () => {
    const project = await seedActorAndProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 20), requests, async () => ({
      content: JSON.stringify({ findings: [{
        severity: 'important', kind: 'edge_case', category: 'payments',
        summary: 'Duplicate payment completion is unresolved.',
        rationale: 'A timeout may hide a successful provider charge before the retry.',
        proposedQuestion: 'How should retries reconcile an unknown prior payment state?',
        suggestedDirection: 'Use idempotency and provider-state reconciliation.',
        basis: 'trained_knowledge', evidenceReferences: ['knowledge:business_rules'],
      }] }),
    })));
    await releaseCapability(project.id, 'agent.requirements_reviewer', 'agent', 'requirements-reviewer');
    await releaseCapability(project.id, 'model.openai-studio', 'model_route', 'openai-studio-api');
    await releaseCapability(project.id, 'model.anthropic-review', 'model_route', 'anthropic-review-api');

    const before = await new KnowledgeRepository(pool).listByProject(organisationId, project.id);
    const result = await buildService(gateway).runProductRequirementsReview({
      organisationId, projectId: project.id, actorUserId, reviewerRouteId: 'anthropic-review-api',
    });
    expect(result.run).toMatchObject({
      profileId: 'product_requirements_v1', reviewerAgentCapabilityId: 'agent.requirements_reviewer',
      reviewerRouteId: 'anthropic-review-api', status: 'completed',
    });
    expect(result.readiness.status).toBe('not_ready');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      role: 'requirements_reviewer', routing: { preferredRouteId: 'anthropic-review-api' },
    });
    const requestText = requests[0]!.messages.map((message) => message.content).join('\n');
    expect(requestText).toContain('Customers pay by card and retry after a timeout.');
    expect(requestText).toContain('A customer may retry a timed-out payment.');
    expect(await new KnowledgeRepository(pool).listByProject(organisationId, project.id)).toEqual(before);
  });
  it('fails closed before model execution when the requirements reviewer agent is not released', async () => {
    const project = await seedActorAndProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 1), requests));
    await releaseCapability(project.id, 'model.anthropic-review', 'model_route', 'anthropic-review-api');

    await expect(buildService(gateway).runProductRequirementsReview({
      organisationId, projectId: project.id, actorUserId,
    })).rejects.toThrow(/requirements reviewer|not found|eligible/i);
    expect(requests).toEqual([]);
    expect(await new AssuranceRepository(pool).getLatestRun(
      organisationId, project.id, 'product_requirements_v1',
    )).toBeNull();
  });

  it('records malformed reviewer output as insufficient evidence rather than a pass', async () => {
    const project = await seedActorAndProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 1), requests, async () => ({
      content: 'not-json',
    })));
    await releaseCapability(project.id, 'agent.requirements_reviewer', 'agent', 'requirements-reviewer');
    await releaseCapability(project.id, 'model.anthropic-review', 'model_route', 'anthropic-review-api');

    const result = await buildService(gateway).runProductRequirementsReview({
      organisationId, projectId: project.id, actorUserId,
    });
    expect(result.run).toMatchObject({
      status: 'availability_failure', availabilityReason: 'malformed_output',
    });
    expect(result.readiness).toEqual({ status: 'insufficient_evidence', blockingFindingIds: [] });
    expect(result.findings).toEqual([]);
  });
  it('records provider failure and timeout as durable insufficient evidence', async () => {
    for (const mode of ['provider_failure', 'timeout'] as const) {
      await resetDatabase();
      const project = await seedActorAndProject();
      const requests: ModelRequest[] = [];
      const gateway = new ModelGateway();
      gateway.register(adapter(route('anthropic-review-api', 'anthropic', 1), requests, async () => {
        if (mode === 'provider_failure') throw new ProviderExecutionError('anthropic');
        return new Promise(() => {});
      }));
      await releaseCapability(project.id, 'agent.requirements_reviewer', 'agent', 'requirements-reviewer');
      await releaseCapability(project.id, 'model.anthropic-review', 'model_route', 'anthropic-review-api');

      const result = await buildService(gateway, mode === 'timeout' ? 20 : 2_000)
        .runProductRequirementsReview({ organisationId, projectId: project.id, actorUserId });
      expect(result.run).toMatchObject({ status: 'availability_failure', availabilityReason: mode });
      expect(result.readiness.status).toBe('insufficient_evidence');
    }
  });

  it('invalidates the prior exact-target review when governed Studio state changes', async () => {
    const project = await seedActorAndProject();
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('anthropic-review-api', 'anthropic', 1), requests));
    await releaseCapability(project.id, 'agent.requirements_reviewer', 'agent', 'requirements-reviewer');
    await releaseCapability(project.id, 'model.anthropic-review', 'model_route', 'anthropic-review-api');
    const service = buildService(gateway);
    const first = await service.runProductRequirementsReview({ organisationId, projectId: project.id, actorUserId });
    expect(first.readiness.status).toBe('ready');

    await new KnowledgeRepository(pool).create(createKnowledgeRecord({
      organisationId, projectId: project.id, category: 'security', title: 'MFA',
      content: 'Administrative actions require MFA.', source: 'accepted_candidate',
      status: 'approved', createdBy: actorUserId,
    }));
    const second = await service.runProductRequirementsReview({ organisationId, projectId: project.id, actorUserId });
    expect(second.run.targetDigest).not.toBe(first.run.targetDigest);
    expect((await new AssuranceRepository(pool).getRun(
      organisationId, project.id, first.run.id,
    ))?.status).toBe('invalidated');
  });
});
