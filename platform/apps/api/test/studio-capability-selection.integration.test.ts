import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityRecord,
  createCapabilityReleasePolicy,
} from '@engineering-os/domain';
import {
  CapabilityEstateRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  PlatformMembershipRepository,
  ProjectRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway, type ModelAdapter, type ModelRoute } from '@engineering-os/model-gateway';
import { CapabilityEstateService } from '../src/capability-estate-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const organisationId = 'org-001';
const now = new Date('2026-08-20T00:10:00.000Z');
let memberId = '';
let projectId = '';

function adapter(route: ModelRoute): ModelAdapter {
  return { route, async execute() { return { content: route.id }; } };
}
function route(id: string, provider: 'openai' | 'anthropic', priority: number): ModelRoute {
  return {
    id, provider, model: `${provider}-studio-model`, executionMode: 'api',
    costType: 'metered_api', available: true, priority,
    capabilities: {
      chat: true, tools: false, vision: false, files: false, mcp: false,
      localWorkspace: false, headless: true, structuredOutput: true,
    },
  };
}

async function seedMemberProject() {
  memberId = randomUUID();
  projectId = randomUUID();
  await new UserRepository(pool).create({
    id: memberId, userId: 'studio.selection.member', passwordHash: 'test-hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  const memberships = new MembershipRepository(pool);
  await memberships.grantOrganisation({
    organisationId, userId: memberId, role: 'member', createdBy: 'test', now,
  });
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage, preferred_product_partner, updated_at)
     VALUES ($1,$2,'Studio Selection','test',$3,'discovery','auto',$3)`,
    [projectId, organisationId, now],
  );
  await memberships.grantProject({
    organisationId, projectId, userId: memberId, role: 'engineer', createdBy: 'test', now,
  });
}

async function seedCapability(
  id: string,
  kind: 'model_route' | 'agent' | 'harness',
  sourceRef: string,
  released = true,
) {
  const store = new CapabilityEstateRepository(pool);
  await store.createCapability(createCapabilityRecord({
    id, kind, source: kind === 'model_route' ? 'model_gateway' : 'ecc', sourceRef,
    displayName: id, maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'test', createdAt: now,
  }));
  if (released) {
    await store.createRelease(createCapabilityReleasePolicy({
      id: `release.${id}`, capabilityId: id, scope: 'project',
      organisationId, projectId, createdBy: 'test', createdAt: now,
    }));
  }
}

function service(gateway: ModelGateway) {
  return new CapabilityEstateService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool),
    platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool),
    modelGateway: gateway,
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedMemberProject();
}, 30_000);
afterAll(async () => closeDatabase());

describe('Studio governed capability selection', () => {
  it('resolves agent, harness and model independently without one selector changing another', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 5)));
    gateway.register(adapter(route('anthropic-studio-api', 'anthropic', 20)));
    await seedCapability('agent.backend', 'agent', 'agents/backend.md');
    await seedCapability('agent.frontend', 'agent', 'agents/frontend.md');
    await seedCapability('harness.codex', 'harness', 'harness:codex');
    await seedCapability('model.openai-studio', 'model_route', 'openai-studio-api');
    await seedCapability('model.anthropic-studio', 'model_route', 'anthropic-studio-api');

    const store = service(gateway) as CapabilityEstateService & {
      resolveStudioSelectionForProject(input: Record<string, string>): Promise<Record<string, unknown>>;
    };
    const first = await store.resolveStudioSelectionForProject({
      organisationId, projectId, actorUserId: memberId,
      agentId: 'agent.backend', harnessId: 'harness.codex', modelRouteId: 'anthropic-studio-api',
    });
    expect(first).toMatchObject({
      agent: { mode: 'explicit', capabilityId: 'agent.backend' },
      harness: { mode: 'explicit', capabilityId: 'harness.codex' },
      modelRoute: { mode: 'explicit', routeId: 'anthropic-studio-api' },
    });

    const second = await store.resolveStudioSelectionForProject({
      organisationId, projectId, actorUserId: memberId,
      agentId: 'agent.frontend', harnessId: 'harness.codex', modelRouteId: 'anthropic-studio-api',
    });
    expect(second).toMatchObject({
      agent: { mode: 'explicit', capabilityId: 'agent.frontend' },
      harness: { mode: 'explicit', capabilityId: 'harness.codex' },
      modelRoute: { mode: 'explicit', routeId: 'anthropic-studio-api' },
    });
  });

  it('fails closed for an explicit unreleased capability instead of silently substituting Auto', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 5)));
    await seedCapability('agent.allowed', 'agent', 'agents/allowed.md');
    await seedCapability('agent.hidden', 'agent', 'agents/hidden.md', false);
    await seedCapability('harness.codex', 'harness', 'harness:codex');
    await seedCapability('model.openai-studio', 'model_route', 'openai-studio-api');
    const store = service(gateway) as CapabilityEstateService & {
      resolveStudioSelectionForProject(input: Record<string, string>): Promise<Record<string, unknown>>;
    };
    await expect(store.resolveStudioSelectionForProject({
      organisationId, projectId, actorUserId: memberId,
      agentId: 'agent.hidden', harnessId: 'harness.codex', modelRouteId: 'openai-studio-api',
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('selects a governed connection-backed route only when the project route catalogue makes it technically available', async () => {
    const gateway = new ModelGateway();
    const dynamicRoute: ModelRoute = {
      ...route('connection-route.dynamic', 'openai', 500),
      provider: 'openrouter',
      model: 'vendor/model-a',
      connection: { id: 'connection-user', ownerType: 'user', ownerId: memberId },
    };
    await seedCapability('agent.lead', 'agent', 'agents/lead.md');
    await seedCapability('harness.codex', 'harness', 'harness:codex');
    await seedCapability('model.connection-dynamic', 'model_route', dynamicRoute.id);
    const store = new CapabilityEstateService({
      unitOfWork: new DatabaseUnitOfWork(pool),
      capabilities: new CapabilityEstateRepository(pool),
      memberships: new MembershipRepository(pool),
      platformMemberships: new PlatformMembershipRepository(pool),
      projects: new ProjectRepository(pool),
      modelGateway: gateway,
      connectionModelRoutes: {
        async listAvailableForProject() { return [dynamicRoute]; },
      },
    } as any);
    const selected = await store.resolveStudioSelectionForProject({
      organisationId, projectId, actorUserId: memberId,
      agentId: 'agent.lead', harnessId: 'harness.codex', modelRouteId: dynamicRoute.id,
    });
    expect(selected.modelRoute).toEqual({ mode: 'explicit', routeId: dynamicRoute.id });
    expect(await store.listEligibleModelRoutesForProject({ organisationId, projectId, actorUserId: memberId }))
      .toEqual([dynamicRoute]);
  });

  it('resolves Auto independently from the eligible set in each dimension', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter(route('openai-studio-api', 'openai', 5)));
    gateway.register(adapter(route('anthropic-studio-api', 'anthropic', 20)));
    await seedCapability('agent.lead', 'agent', 'agents/lead.md');
    await seedCapability('harness.codex', 'harness', 'harness:codex');
    await seedCapability('model.openai-studio', 'model_route', 'openai-studio-api');
    await seedCapability('model.anthropic-studio', 'model_route', 'anthropic-studio-api');
    const store = service(gateway) as CapabilityEstateService & {
      resolveStudioSelectionForProject(input: Record<string, string>): Promise<Record<string, unknown>>;
    };
    const selected = await store.resolveStudioSelectionForProject({
      organisationId, projectId, actorUserId: memberId,
      agentId: 'auto', harnessId: 'auto', modelRouteId: 'auto',
    });
    expect(selected).toMatchObject({
      agent: { mode: 'auto', capabilityId: 'agent.lead' },
      harness: { mode: 'auto', capabilityId: 'harness.codex' },
      modelRoute: { mode: 'auto', routeId: 'openai-studio-api' },
    });
  });
});
