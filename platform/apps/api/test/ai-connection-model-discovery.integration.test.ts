import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AIConnectionRepository, CapabilityEstateRepository, DatabaseUnitOfWork,
  MembershipRepository, ProjectRepository, SessionRepository, UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { AIConnectionService, AIConnectionServiceError } from '../src/ai-connection-service.js';
import {
  createConnectionFamilyPolicyRegistry, type TrustedConnectionFamilyPolicy,
} from '../src/ai-connection-policy.js';
import {
  createAIConnectionProviderAdapterRegistry, type AIConnectionProviderAdapter,
} from '../src/ai-connection-provider-adapter.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

afterAll(async () => closeDatabase());

const policy: TrustedConnectionFamilyPolicy = {
  id: 'test-discover-api', providerId: 'test-provider', providerAdapterId: 'test-provider-adapter',
  displayName: 'Test Discovery API', executionMode: 'api', allowedOwnership: ['organisation'],
  credentialStrategies: ['external_secret_ref'], delegatable: false,
  requiresRunner: false, persistentSupported: false,
};
async function seedAdmin() {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id, userId: `discover-${id.slice(0, 8)}`, passwordHash: 'scrypt$test$hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id,user_id,role,status,created_by,created_at,updated_at)
     VALUES ('org-001',$1,'admin','active','test',$2,$2)`,
    [id, now],
  );
  return id;
}

function makeAdapter(models: () => readonly unknown[], credentialSink: string[]): AIConnectionProviderAdapter {
  return {
    id: 'test-provider-adapter',
    async validateConnection(input) {
      credentialSink.push(input.credential?.value ?? '');
      return { status: 'available' };
    },
    async discoverModels() { return models(); },
    createModelAdapter({ route }) {
      return {
        route,
        async execute() { return { content: 'connection-backed reply' }; },
      };
    },
  };
}
function makeService(adapter: AIConnectionProviderAdapter) {
  return new AIConnectionService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool),
    projects: new ProjectRepository(pool),
    sessions: new SessionRepository(pool),
    policy: createConnectionFamilyPolicyRegistry([policy]),
    modelGateway: new ModelGateway(),
    providerAdapters: createAIConnectionProviderAdapterRegistry([adapter]),
    credentialResolver: {
      async resolve(input) {
        expect(input.secretRefId).toBe('vault:test-provider/org-001');
        return { value: 'resolved-secret-value' };
      },
    },
  });
}

describe('AIConnectionService connection-scoped model discovery', () => {
  beforeEach(async () => resetDatabase());
  it('reconciles discovered models into unverified, unreleased capability records', async () => {
    const actorUserId = await seedAdmin();
    const credentialSink: string[] = [];
    const adapter = makeAdapter(() => [
      { providerModelId: 'vendor/model-a', displayName: 'Model A', available: true,
        capabilities: { chat: true, structuredOutput: true } },
      { providerModelId: 'vendor/model-b', displayName: 'Model B', available: true,
        capabilities: { chat: true, tools: true } },
    ], credentialSink);
    const service = makeService(adapter);
    const connection = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId, connectionFamilyId: policy.id,
      secretRefId: 'vault:test-provider/org-001',
    });

    const result = await service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
      now: new Date('2026-08-20T18:30:00.000Z'),
    });
    expect(credentialSink).toEqual(['resolved-secret-value']);
    expect(result.models).toHaveLength(2);
    expect(result.models.map((model) => model.routeId)).toEqual(
      [...result.models.map((model) => model.routeId)].sort(),
    );
    const capabilities = new CapabilityEstateRepository(pool);
    for (const model of result.models) {
      const capability = await capabilities.getCapability(model.capabilityId);
      expect(capability).toMatchObject({
        id: model.capabilityId, kind: 'model_route', source: 'ai_connection',
        maturity: 'discovered', governanceState: 'discovered', executionVerification: 'unverified',
        sourceRef: model.routeId,
      });
      expect(await capabilities.listReleases(model.capabilityId)).toEqual([]);
      expect(await capabilities.listEligibilityPolicies(model.capabilityId)).toEqual([]);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('resolved-secret-value');
    expect(serialized).not.toContain('vault:test-provider/org-001');
  });

  it('keeps stable route identity and marks provider-omitted models unavailable', async () => {
    const actorUserId = await seedAdmin();
    const credentialSink: string[] = [];
    let catalogue: readonly unknown[] = [
      { providerModelId: 'vendor/model-a', displayName: 'Model A', available: true,
        capabilities: { chat: true } },
      { providerModelId: 'vendor/model-b', displayName: 'Model B', available: true,
        capabilities: { chat: true } },
    ];
    const service = makeService(makeAdapter(() => catalogue, credentialSink));
    const connection = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId, connectionFamilyId: policy.id,
      secretRefId: 'vault:test-provider/org-001',
    });
    const first = await service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
      now: new Date('2026-08-20T18:31:00.000Z'),
    });
    catalogue = [
      { providerModelId: 'vendor/model-a', displayName: 'Model A v2', available: true,
        capabilities: { chat: true, tools: true } },
    ];
    const second = await service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
      now: new Date('2026-08-20T18:32:00.000Z'),
    });
    const firstModelA = first.models.find((model) => model.providerModelId === 'vendor/model-a');
    const secondModelA = second.models.find((model) => model.providerModelId === 'vendor/model-a');
    expect(secondModelA?.routeId).toBe(firstModelA?.routeId);
    const stored = await new AIConnectionRepository(pool).listModelRoutes('org-001', connection.id);
    expect(stored.find((route) => route.providerModelId === 'vendor/model-a')).toMatchObject({
      displayName: 'Model A v2', availability: 'available',
      capabilities: expect.objectContaining({ chat: true, tools: true }),
    });
    expect(stored.find((route) => route.providerModelId === 'vendor/model-b')?.availability)
      .toBe('unavailable');
  });

  it('rejects organisation model discovery for an ordinary member before adapter execution', async () => {
    const adminUserId = await seedAdmin();
    const credentialSink: string[] = [];
    const service = makeService(makeAdapter(() => [], credentialSink));
    const connection = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: adminUserId, connectionFamilyId: policy.id,
      secretRefId: 'vault:test-provider/org-001',
    });
    const memberId = randomUUID();
    const now = new Date();
    await new UserRepository(pool).create({
      id: memberId, userId: `member-${memberId.slice(0, 8)}`, passwordHash: 'scrypt$test$hash',
      status: 'active', createdAt: now, updatedAt: now,
    });
    await pool.query(
      `INSERT INTO organisation_memberships
       (organisation_id,user_id,role,status,created_by,created_at,updated_at)
       VALUES ('org-001',$1,'member','active','test',$2,$2)`, [memberId, now],
    );
    await expect(service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId: memberId, connectionId: connection.id,
    })).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<AIConnectionServiceError>);
    expect(credentialSink).toEqual([]);
  });

  it('fails closed when the connection family has no provider adapter binding', async () => {
    const actorUserId = await seedAdmin();
    const { providerAdapterId: _providerAdapterId, ...unboundBase } = policy;
    const unbound = { ...unboundBase, id: 'unbound-api' };
    const service = new AIConnectionService({
      unitOfWork: new DatabaseUnitOfWork(pool), aiConnections: new AIConnectionRepository(pool),
      memberships: new MembershipRepository(pool), projects: new ProjectRepository(pool),
      sessions: new SessionRepository(pool), policy: createConnectionFamilyPolicyRegistry([unbound]),
      modelGateway: new ModelGateway(),
    });
    const connection = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId, connectionFamilyId: unbound.id,
      secretRefId: 'vault:test-provider/org-001',
    });
    await expect(service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
    })).rejects.toMatchObject({ code: 'policy_blocked' } satisfies Partial<AIConnectionServiceError>);
  });
});

describe('AIConnectionService just-in-time model adapter resolution', () => {
  beforeEach(async () => resetDatabase());
  it('resolves exact connection provenance and stops resolving after connection revocation', async () => {
    const actorUserId = await seedAdmin();
    const credentialSink: string[] = [];
    const gateway = new ModelGateway();
    const adapter = makeAdapter(() => [
      { providerModelId: 'vendor/model-a', displayName: 'Model A', available: true,
        capabilities: { chat: true, headless: true } },
    ], credentialSink);
    const service = new AIConnectionService({
      unitOfWork: new DatabaseUnitOfWork(pool), aiConnections: new AIConnectionRepository(pool),
      memberships: new MembershipRepository(pool), projects: new ProjectRepository(pool),
      sessions: new SessionRepository(pool), policy: createConnectionFamilyPolicyRegistry([policy]),
      modelGateway: gateway, providerAdapters: createAIConnectionProviderAdapterRegistry([adapter]),
      credentialResolver: { async resolve() { return { value: 'resolved-secret-value' }; } },
    });
    const connection = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId, connectionFamilyId: policy.id,
      secretRefId: 'vault:test-provider/org-001',
    });
    const discovered = await service.discoverConnectionModels({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
    });
    const routeId = discovered.models[0]!.routeId;
    const resolved = await service.resolveConnectionModelAdapter(routeId);
    expect(resolved?.route).toMatchObject({
      id: routeId, provider: 'test-provider', model: 'vendor/model-a',
      connection: { id: connection.id, ownerType: 'organisation', ownerId: 'org-001' },
      executionMode: 'api', costType: 'metered_api', available: true,
    });
    const response = await gateway.execute({
      taskId: 'task-dynamic', role: 'engineer', messages: [{ role: 'user', content: 'hello' }],
      requiredCapabilities: ['chat'],
      routing: { subscriptionFirst: false, allowMeteredApi: true, preferredRouteId: routeId },
    }, { dynamicAdapterResolver: (requestedRouteId) =>
      service.resolveConnectionModelAdapter(requestedRouteId) });
    expect(response.content).toBe('connection-backed reply');
    expect(response.connection).toEqual({
      id: connection.id, ownerType: 'organisation', ownerId: 'org-001',
    });

    await service.revokeConnection({
      organisationId: 'org-001', actorUserId, connectionId: connection.id,
    });
    expect(await service.resolveConnectionModelAdapter(routeId)).toBeNull();
  });
});
