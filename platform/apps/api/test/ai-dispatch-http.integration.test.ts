import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAIConnectionRecord, type RunnerTaskEnvelope } from '@engineering-os/domain';
import {
  AIConnectionRepository,
  AIDispatchRepository,
  AIRunnerRepository,
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeRepository,
  MembershipRepository,
  ProjectRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { signRunnerTaskEnvelope } from '@engineering-os/runner-protocol';
import { buildApp } from '../src/app.js';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { AIDispatchService } from '../src/ai-dispatch-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

beforeEach(async () => resetDatabase(), 30_000);
afterAll(async () => closeDatabase());
interface Seed {
  organisationId: string;
  userId: string;
  projectId: string;
  connectionId: string;
  runnerId: string;
  credential: string;
  dispatches: AIDispatchRepository;
  app: ReturnType<typeof buildApp>;
}

async function seedRunner(suffix: string): Promise<Seed> {
  const now = new Date();
  const organisationId = 'org-001';
  const userId = randomUUID();
  await new UserRepository(pool).create({
    id: userId,
    userId: `dispatch.http.${suffix}`,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  const memberships = new MembershipRepository(pool);
  await memberships.grantOrganisation({
    organisationId,
    userId,
    role: 'member',
    createdBy: 'test',
    now,
  });
  const projectId = randomUUID();
  await new ProjectRepository(pool).create({
    id: projectId,
    organisationId,
    name: `Dispatch HTTP ${suffix}`,
    stage: 'implementation',
    preferredProductPartner: 'auto',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const connectionId = randomUUID();
  await new AIConnectionRepository(pool).createConnection(createAIConnectionRecord({
    id: connectionId,
    organisationId,
    ownership: 'personal',
    ownerUserId: userId,
    providerId: 'openai',
    connectionFamilyId: 'codex_subscription',
    credentialStrategy: 'runner_managed',
    status: 'available',
    createdBy: userId,
    createdAt: now,
  }));

  const aiRunners = new AIRunnerRepository(pool);
  const runnerService = new AIRunnerService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiRunners,
    memberships,
    audit: new AuditRepository(pool),
  });
  const registered = await runnerService.registerRunner({
    organisationId,
    actorUserId: userId,
    ownership: 'personal',
    ownerUserId: userId,
    harnessId: 'codex',
    persistentSupported: false,
    capabilities: ['headless', 'workspace'],
    now,
  });
  await aiRunners.setRunnerTrustState(
    organisationId,
    registered.runnerId,
    'trusted',
    new Date(now.getTime() + 1),
  );
  await aiRunners.recordHeartbeat(
    organisationId,
    registered.runnerId,
    new Date(now.getTime() + 2),
    new Date(now.getTime() + 5 * 60_000),
  );
  await aiRunners.createConnectionBinding({
    id: randomUUID(),
    organisationId,
    runnerId: registered.runnerId,
    connectionId,
    createdBy: userId,
    createdAt: new Date(now.getTime() + 3),
  });
  const dispatches = new AIDispatchRepository(pool);
  const dispatchService = new AIDispatchService({
    runnerService,
    aiRunners,
    memberships,
    dispatches,
  });
  const app = buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork: new DatabaseUnitOfWork(pool),
    modelGateway: new ModelGateway(),
    aiRunnerService: runnerService,
    aiDispatchService: dispatchService,
    allowDevIdentityHeaders: false,
  } as Parameters<typeof buildApp>[0] & { aiDispatchService: AIDispatchService });
  return {
    organisationId,
    userId,
    projectId,
    connectionId,
    runnerId: registered.runnerId,
    credential: registered.credential,
    dispatches,
    app,
  };
}

function runnerHeaders(seed: Seed) {
  return { authorization: `Bearer ${seed.credential}`, 'x-organisation-id': 'forged-org' };
}
async function queue(seed: Seed, suffix: string) {
  const now = new Date();
  const taskEnvelope: RunnerTaskEnvelope = {
    id: randomUUID(),
    organisationId: seed.organisationId,
    projectId: seed.projectId,
    taskId: `task-${suffix}`,
    connectionId: seed.connectionId,
    routeId: 'openrouter-qwen',
    harnessId: 'codex',
    allowedOperations: ['read', 'write', 'test'],
    workspaceScope: `C:/worktrees/task-${suffix}`,
    issuedAt: new Date(now.getTime() - 1_000),
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    nonce: randomUUID(),
  };
  const { privateKey } = generateKeyPairSync('ed25519');
  const envelope = signRunnerTaskEnvelope({
    dispatchId: randomUUID(),
    runnerId: seed.runnerId,
    requesterUserId: seed.userId,
    attempt: 1,
    idempotencyKey: randomUUID(),
    taskEnvelope,
    payload: {
      objective: `Execute ${suffix}.`,
      contextReferences: ['file:src/index.ts'],
      requiredCapabilities: ['headless', 'localWorkspace'],
    },
  }, privateKey);
  await seed.dispatches.create(envelope, now);
  return envelope;
}
describe('runner dispatch HTTP boundary', () => {
  it('uses runner bearer auth, ignores forged organisation headers, and returns 204 when no work exists', async () => {
    const seed = await seedRunner('auth');
    const noWork = await seed.app.inject({
      method: 'POST',
      url: '/runner/v1/claim',
      headers: runnerHeaders(seed),
      payload: {},
    });
    expect(noWork.statusCode).toBe(204);

    const queued = await queue(seed, 'claim');
    const claimed = await seed.app.inject({
      method: 'POST',
      url: '/runner/v1/claim',
      headers: runnerHeaders(seed),
      payload: {},
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({
      dispatchId: queued.dispatchId,
      attempt: 1,
      envelope: { dispatchId: queued.dispatchId, runnerId: seed.runnerId },
    });

    const invalid = await seed.app.inject({
      method: 'POST',
      url: '/runner/v1/claim',
      headers: { authorization: 'Bearer invalid' },
      payload: {},
    });
    expect(invalid.statusCode).toBe(401);
    await seed.app.close();
  });
  it('runs the assigned lifecycle and keeps terminal evidence ids/timestamps server-owned', async () => {
    const seed = await seedRunner('lifecycle');
    const queued = await queue(seed, 'lifecycle');
    await seed.app.inject({ method: 'POST', url: '/runner/v1/claim', headers: runnerHeaders(seed), payload: {} });

    const running = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${queued.dispatchId}/running`,
      headers: runnerHeaders(seed),
      payload: {},
    });
    expect(running.statusCode).toBe(204);

    const checkpoint = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${queued.dispatchId}/checkpoints`,
      headers: runnerHeaders(seed),
      payload: { ordinal: 1, kind: 'test', metadata: { command: 'npm test' } },
    });
    expect(checkpoint.statusCode).toBe(204);

    const completed = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${queued.dispatchId}/complete`,
      headers: runnerHeaders(seed),
      payload: { metadata: { exitCode: 0 }, artifactReferences: ['artifact:test-report'] },
    });
    expect(completed.statusCode).toBe(204);
    const replay = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${queued.dispatchId}/complete`,
      headers: runnerHeaders(seed),
      payload: { metadata: { exitCode: 0 }, artifactReferences: ['artifact:test-report'] },
    });
    expect(replay.statusCode).toBe(204);
    const evidence = await seed.dispatches.listExecutionEvidence(seed.organisationId, queued.dispatchId);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(evidence[0]?.createdAt.getTime()).toBeGreaterThan(0);

    for (const forbidden of ['evidenceId', 'now', 'runnerId', 'organisationId']) {
      const response = await seed.app.inject({
        method: 'POST',
        url: `/runner/v1/dispatches/${queued.dispatchId}/complete`,
        headers: runnerHeaders(seed),
        payload: {
          metadata: { exitCode: 0 },
          artifactReferences: ['artifact:test-report'],
          [forbidden]: 'forbidden',
        },
      });
      expect(response.statusCode, forbidden).toBe(400);
    }
    await seed.app.close();
  });

  it('supports failure and observed cancellation but rejects unknown payload fields', async () => {
    const seed = await seedRunner('terminal');
    const failed = await queue(seed, 'fail');
    await seed.app.inject({ method: 'POST', url: '/runner/v1/claim', headers: runnerHeaders(seed), payload: {} });
    await seed.app.inject({ method: 'POST', url: `/runner/v1/dispatches/${failed.dispatchId}/running`, headers: runnerHeaders(seed), payload: {} });
    const failure = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${failed.dispatchId}/fail`,
      headers: runnerHeaders(seed),
      payload: { metadata: { reason: 'test_failed' }, artifactReferences: ['artifact:test-log'] },
    });
    expect(failure.statusCode).toBe(204);
    expect((await seed.dispatches.get(seed.organisationId, failed.dispatchId))?.state).toBe('failed');

    const cancelled = await queue(seed, 'cancel');
    const observed = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${cancelled.dispatchId}/cancel`,
      headers: runnerHeaders(seed),
      payload: {},
    });
    expect(observed.statusCode).toBe(204);
    expect((await seed.dispatches.get(seed.organisationId, cancelled.dispatchId))?.state).toBe('cancelled');

    const secret = await queue(seed, 'secret');
    await seed.app.inject({ method: 'POST', url: '/runner/v1/claim', headers: runnerHeaders(seed), payload: {} });
    await seed.app.inject({ method: 'POST', url: `/runner/v1/dispatches/${secret.dispatchId}/running`, headers: runnerHeaders(seed), payload: {} });
    const secretEvidence = await seed.app.inject({
      method: 'POST',
      url: `/runner/v1/dispatches/${secret.dispatchId}/fail`,
      headers: runnerHeaders(seed),
      payload: { metadata: { apiKey: 'must-not-persist' }, artifactReferences: [] },
    });
    expect(secretEvidence.statusCode).toBe(400);
    expect((await seed.dispatches.get(seed.organisationId, secret.dispatchId))?.state).toBe('running');

    const smuggled = await seed.app.inject({
      method: 'POST',
      url: '/runner/v1/claim',
      headers: runnerHeaders(seed),
      payload: { runnerId: seed.runnerId },
    });
    expect(smuggled.statusCode).toBe(400);
    await seed.app.close();
  });
});
