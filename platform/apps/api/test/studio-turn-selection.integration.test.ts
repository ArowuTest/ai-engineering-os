import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityRecord, createCapabilityReleasePolicy } from '@engineering-os/domain';
import {
  CapabilityEstateRepository, ConversationRepository, DatabaseUnitOfWork,
  KnowledgeRepository, MembershipRepository, PlatformMembershipRepository,
  ProjectRepository, UserRepository,
} from '@engineering-os/database';
import { ModelGateway, type ModelAdapter, type ModelRequest, type ModelRoute } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { CapabilityEstateService } from '../src/capability-estate-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const organisationId = 'org-001';
let actorUserId = '';
const now = new Date('2026-08-20T01:30:00.000Z');

function route(id: string, provider: 'openai' | 'anthropic', priority: number): ModelRoute {
  return { id, provider, model: `${provider}-studio`, executionMode: 'api', costType: 'metered_api',
    available: true, priority, capabilities: { chat: true, tools: false, vision: false, files: false,
      mcp: false, localWorkspace: false, headless: true, structuredOutput: true } };
}
function adapter(modelRoute: ModelRoute, requests: ModelRequest[]): ModelAdapter {
  return { route: modelRoute, async execute(request) { requests.push(request); return { content: JSON.stringify({ answer: modelRoute.id, candidates: [] }) }; } };
}
async function seedActor() {
  actorUserId = randomUUID();
  await new UserRepository(pool).create({ id: actorUserId, userId: 'studio.turn.actor', passwordHash: 'test-hash',
    status: 'active', createdAt: now, updatedAt: now });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId, userId: actorUserId, role: 'owner', createdBy: 'test', now,
  });
}

function appWith(gateway: ModelGateway) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const capabilityEstateService = new CapabilityEstateService({
    unitOfWork, capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool), platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool), modelGateway: gateway,
  });
  return buildApp({
    projects: new ProjectRepository(pool), knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool), unitOfWork, modelGateway: gateway,
    capabilityEstateService,
  });
}

async function createProject(app: ReturnType<typeof appWith>) {
  const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };
  const response = await app.inject({ method: 'POST', url: '/projects', headers,
    payload: { name: 'Governed Studio Turn', preferredProductPartner: 'auto' } });
  expect(response.statusCode).toBe(201);
  return { id: (response.json() as { id: string }).id, headers };
}
async function release(projectId: string, input: {
  id: string; kind: 'agent' | 'harness' | 'model_route'; sourceRef: string; released?: boolean;
}) {
  const store = new CapabilityEstateRepository(pool);
  await store.createCapability(createCapabilityRecord({
    id: input.id, kind: input.kind, source: input.kind === 'model_route' ? 'model_gateway' : 'ecc',
    sourceRef: input.sourceRef, displayName: input.id, maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'test', createdAt: now,
  }));
  if (input.released !== false) {
    await store.createRelease(createCapabilityReleasePolicy({
      id: `release.${input.id}`, capabilityId: input.id, scope: 'project', organisationId,
      projectId, createdBy: 'test', createdAt: now,
    }));
  }
}

beforeEach(async () => { await resetDatabase(); await seedActor(); }, 30_000);
afterAll(async () => closeDatabase());

describe('Studio turn governed selection', () => {
  it('honours explicit model route while agent and harness remain independent metadata', async () => {
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    gateway.register(adapter(route('anthropic-studio-api', 'anthropic', 20), requests));
    const app = appWith(gateway);
    const project = await createProject(app);
    await release(project.id, { id: 'agent.backend', kind: 'agent', sourceRef: 'agents/backend.md' });
    await release(project.id, { id: 'harness.codex', kind: 'harness', sourceRef: 'harness:codex' });
    await release(project.id, { id: 'model.openai-studio', kind: 'model_route', sourceRef: 'openai-studio-api' });
    await release(project.id, { id: 'model.anthropic-studio', kind: 'model_route', sourceRef: 'anthropic-studio-api' });

    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers: project.headers,
      payload: {
        content: 'Use my exact governed Studio selection.',
        agentId: 'agent.backend', harnessId: 'harness.codex', modelRouteId: 'anthropic-studio-api',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.routing.preferredRouteId).toBe('anthropic-studio-api');
    expect(response.json()).toMatchObject({
      execution: { provider: 'anthropic', routeId: 'anthropic-studio-api' },
      selection: {
        agent: { mode: 'explicit', capabilityId: 'agent.backend' },
        harness: { mode: 'explicit', capabilityId: 'harness.codex' },
        modelRoute: { mode: 'explicit', routeId: 'anthropic-studio-api' },
      },
    });
    expect(response.json().execution).not.toHaveProperty('harnessExecuted');
    const auditRows = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events
       WHERE organisation_id = $1 AND project_id = $2
         AND event_type = 'product_partner.assistant_message.created'
       ORDER BY sequence DESC LIMIT 1`,
      [organisationId, project.id],
    );
    expect(auditRows.rows[0]?.metadata).toMatchObject({
      selection: {
        agent: { mode: 'explicit', capabilityId: 'agent.backend' },
        harness: { mode: 'explicit', capabilityId: 'harness.codex' },
        modelRoute: { mode: 'explicit', routeId: 'anthropic-studio-api' },
      },
    });
    await app.close();
  });

  it('fails closed before provider execution for an explicit capability that is no longer released', async () => {
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 1), requests));
    const app = appWith(gateway);
    const project = await createProject(app);
    await release(project.id, { id: 'agent.allowed', kind: 'agent', sourceRef: 'agents/allowed.md' });
    await release(project.id, {
      id: 'agent.unreleased', kind: 'agent', sourceRef: 'agents/unreleased.md', released: false,
    });
    await release(project.id, { id: 'harness.codex', kind: 'harness', sourceRef: 'harness:codex' });
    await release(project.id, { id: 'model.openai-studio', kind: 'model_route', sourceRef: 'openai-studio-api' });

    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers: project.headers,
      payload: {
        content: 'Do not substitute another selection.',
        agentId: 'agent.unreleased', harnessId: 'harness.codex', modelRouteId: 'openai-studio-api',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
    expect(requests).toEqual([]);

    const conversations = new ConversationRepository(pool);
    const conversation = await conversations.getByProject(organisationId, project.id);
    expect(conversation).not.toBeNull();
    expect(await conversations.listMessages(organisationId, project.id, conversation!.id)).toEqual([]);
    await app.close();
  });
});