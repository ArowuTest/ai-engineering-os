import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AIConnectionRepository, AIConnectionSecretRepository, ConversationRepository, DatabaseUnitOfWork,
  KnowledgeRepository, MembershipRepository, ProjectRepository, SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { AIConnectionService } from '../src/ai-connection-service.js';
import { createAesGcmAIConnectionSecretProtector, createRepositoryAIConnectionCredentialResolver } from '../src/ai-connection-secret-protector.js';
import { createConnectionFamilyPolicyRegistry, type TrustedConnectionFamilyPolicy } from '../src/ai-connection-policy.js';
import { createAIConnectionProviderAdapterRegistry } from '../src/ai-connection-provider-adapter.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const family: TrustedConnectionFamilyPolicy = {
  id: 'test-personal-api', providerId: 'test-provider', providerAdapterId: 'test-compatible',
  displayName: 'Test Personal API', executionMode: 'api', allowedOwnership: ['personal', 'organisation'],
  credentialStrategies: ['external_secret_ref'], delegatable: false,
  requiresRunner: false, persistentSupported: false,
};
const policy = createConnectionFamilyPolicyRegistry([family]);

async function seedMember(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id, userId: `byoc-${id.slice(0, 8)}`, passwordHash: 'scrypt$test$hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: id, role: 'member', createdBy: 'test', now,
  });
  return id;
}

function makeBoundary(managed = false) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const protector = managed ? createAesGcmAIConnectionSecretProtector({
    masterKeyBase64: Buffer.alloc(32, 9).toString('base64'), keyVersion: 'test-v1',
  }) : undefined;
  const providerAdapters = createAIConnectionProviderAdapterRegistry([{
    id: 'test-compatible',
    async validateConnection(input) {
      expect(input.credential?.value).toBe(managed ? 'sk-managed-do-not-persist-plaintext' : 'resolved-user-secret');
      return { status: 'available' as const };
    },
    async discoverModels() {
      return [{ providerModelId: 'vendor/model-a', displayName: 'Model A', available: true,
        capabilities: { chat: true, headless: true } }];
    },
    createModelAdapter({ route }) {
      return { route, async execute() { return { content: 'ok' }; } };
    },
  }]);
  const service = new AIConnectionService({
    unitOfWork, aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool), projects: new ProjectRepository(pool),
    sessions: new SessionRepository(pool), policy, modelGateway: new ModelGateway(),
    providerAdapters,
    ...(protector ? { credentialProtector: protector,
      credentialResolver: createRepositoryAIConnectionCredentialResolver({
        secrets: new AIConnectionSecretRepository(pool), protector,
      }) } : { credentialResolver: { async resolve({ secretRefId }) {
        expect(secretRefId).toBe('vault:user/model');
        return { value: 'resolved-user-secret' };
      } } }),
  });
  const app = buildApp({
    projects: new ProjectRepository(pool), knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool), unitOfWork, modelGateway: new ModelGateway(),
    aiConnectionService: service, aiConnectionPolicy: policy, allowDevIdentityHeaders: true,
  });
  return { app, service };
}

describe('connection-backed model HTTP boundary', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('registers a personal API connection by secret reference and never accepts or echoes a raw key', async () => {
    const userId = await seedMember();
    const { app } = makeBoundary();
    const headers = { 'x-organisation-id': 'org-001', 'x-user-id': userId };
    const response = await app.inject({ method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: family.id, secretRefId: 'vault:user/model' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ ownership: 'personal', credentialConfigured: true });
    expect(response.body).not.toContain('vault:user/model');

    const rejected = await app.inject({ method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: family.id, apiKey: 'sk-do-not-store' } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).not.toContain('sk-do-not-store');
    await app.close();
  });

  it('discovers safe connection-scoped model summaries through the authenticated connection route', async () => {
    const userId = await seedMember();
    const { app, service } = makeBoundary();
    const connection = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: userId, connectionFamilyId: family.id,
      secretRefId: 'vault:user/model',
    });
    const response = await app.inject({ method: 'POST',
      url: `/ai-connections/${connection.id}/models/discover`,
      headers: { 'x-organisation-id': 'org-001', 'x-user-id': userId }, payload: {} });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { connectionId: string; providerId: string; models: Array<Record<string, unknown>> };
    expect(body.connectionId).toBe(connection.id);
    expect(body.providerId).toBe('test-provider');
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({ providerModelId: 'vendor/model-a', displayName: 'Model A', available: true });
    expect(response.body).not.toContain('vault:user/model');
    expect(response.body).not.toContain('resolved-user-secret');
    await app.close();
  });
  it('stores a pasted personal API key only through managed encrypted secret storage', async () => {
    const userId = await seedMember();
    const { app } = makeBoundary(true);
    const headers = { 'x-organisation-id': 'org-001', 'x-user-id': userId };
    const apiKey = 'sk-managed-do-not-persist-plaintext';
    const response = await app.inject({ method: 'POST', url: '/ai-connections/personal', headers,
      payload: { connectionFamilyId: family.id, apiKey } });
    expect(response.statusCode).toBe(201);
    const summary = response.json() as { id: string; credentialConfigured: boolean };
    expect(summary.credentialConfigured).toBe(true);
    expect(response.body).not.toContain(apiKey);
    expect(response.body).not.toContain('dbsecret:');

    const connection = await new AIConnectionRepository(pool).getConnection('org-001', summary.id);
    expect(connection?.secretRefId).toMatch(/^dbsecret:/);
    expect(JSON.stringify(connection)).not.toContain(apiKey);
    const secretId = connection!.secretRefId!.slice('dbsecret:'.length);
    const secret = await new AIConnectionSecretRepository(pool).getActive('org-001', summary.id, secretId);
    expect(secret).not.toBeNull();
    expect(secret!.ciphertext.toString('utf8')).not.toContain(apiKey);

    const discovered = await app.inject({ method: 'POST',
      url: `/ai-connections/${summary.id}/models/discover`, headers, payload: {} });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.body).not.toContain(apiKey);

    const revoked = await app.inject({ method: 'DELETE',
      url: `/ai-connections/${summary.id}`, headers });
    expect(revoked.statusCode).toBe(204);
    expect(await new AIConnectionSecretRepository(pool).getActive('org-001', summary.id, secretId)).toBeNull();
    expect(await new AIConnectionSecretRepository(pool).get('org-001', summary.id, secretId)).not.toBeNull();
    const audit = await pool.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_events WHERE subject_id=$1 ORDER BY occurred_at DESC LIMIT 1`, [summary.id],
    );
    expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toContain(apiKey);
    expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toContain('dbsecret:');
    await app.close();
  });

  it('stores an organisation API key through the same managed encrypted boundary', async () => {
    const userId = randomUUID();
    const now = new Date();
    await new UserRepository(pool).create({ id: userId, userId: `owner-${userId.slice(0, 8)}`,
      passwordHash: 'scrypt$test$hash', status: 'active', createdAt: now, updatedAt: now });
    await new MembershipRepository(pool).grantOrganisation({
      organisationId: 'org-001', userId, role: 'owner', createdBy: 'test', now });
    const { app } = makeBoundary(true);
    const headers = { 'x-organisation-id': 'org-001', 'x-user-id': userId };
    const apiKey = 'sk-managed-do-not-persist-plaintext';
    const response = await app.inject({ method: 'POST', url: '/admin/ai-connections', headers,
      payload: { connectionFamilyId: family.id, apiKey } });
    expect(response.statusCode).toBe(201);
    const summary = response.json() as { id: string; ownership: string; credentialConfigured: boolean };
    expect(summary).toMatchObject({ ownership: 'organisation', credentialConfigured: true });
    expect(response.body).not.toContain(apiKey);
    const connection = await new AIConnectionRepository(pool).getConnection('org-001', summary.id);
    expect(connection?.secretRefId).toMatch(/^dbsecret:/);
    await app.close();
  });

});
