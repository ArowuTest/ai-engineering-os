import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAIConnectionRecord,
  hashOpaqueToken,
  type RunnerTaskEnvelope,
} from '@engineering-os/domain';
import {
  AIConnectionRepository,
  AIDispatchRepository,
  AIRunnerRepository,
  AuditRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  ProjectRepository,
  UserRepository,
} from '@engineering-os/database';
import { signRunnerTaskEnvelope } from '@engineering-os/runner-protocol';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { AIDispatchService, AIDispatchServiceError } from '../src/ai-dispatch-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const BASE = new Date('2026-08-15T12:00:00.000Z');
const CLAIM_AT = new Date('2026-08-15T12:15:00.000Z');

afterAll(async () => closeDatabase());
beforeEach(async () => resetDatabase(), 30_000);
interface SeededRunner {
  organisationId: string;
  userId: string;
  projectId: string;
  connectionId: string;
  runnerId: string;
  credential: string;
  runnerService: AIRunnerService;
  dispatchService: AIDispatchService;
  dispatches: AIDispatchRepository;
  runners: AIRunnerRepository;
  memberships: MembershipRepository;
}

async function seedUser(organisationId: string, userIdValue: string): Promise<string> {
  const id = randomUUID();
  await new UserRepository(pool).create({
    id,
    userId: userIdValue,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: BASE,
    updatedAt: BASE,
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'member', 'active', 'bootstrap', $3, $3)`,
    [organisationId, id, BASE],
  );
  return id;
}

async function seedRunner(suffix = 'one'): Promise<SeededRunner> {
  const organisationId = 'org-001';
  const userId = await seedUser(organisationId, `runner.${suffix}`);
  const projectId = randomUUID();
  await new ProjectRepository(pool).create({
    id: projectId,
    organisationId,
    name: `Runner ${suffix}`,
    stage: 'implementation',
    preferredProductPartner: 'auto',
    createdBy: userId,
    createdAt: BASE,
    updatedAt: BASE,
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
    createdAt: BASE,
  }));
  const runners = new AIRunnerRepository(pool);
  const memberships = new MembershipRepository(pool);
  const runnerService = new AIRunnerService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiRunners: runners,
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
    now: BASE,
  });
  await runners.setRunnerTrustState(
    organisationId,
    registered.runnerId,
    'trusted',
    new Date(BASE.getTime() + 1_000),
  );
  await runners.recordHeartbeat(
    organisationId,
    registered.runnerId,
    new Date(BASE.getTime() + 2_000),
    new Date(BASE.getTime() + 30 * 60_000),
  );
  await runners.createConnectionBinding({
    id: randomUUID(),
    organisationId,
    runnerId: registered.runnerId,
    connectionId,
    createdBy: userId,
    createdAt: new Date(BASE.getTime() + 3_000),
  });
  const dispatches = new AIDispatchRepository(pool);
  const dispatchService = new AIDispatchService({
    runnerService,
    aiRunners: runners,
    memberships,
    dispatches,
  });
  return {
    organisationId,
    userId,
    projectId,
    connectionId,
    runnerId: registered.runnerId,
    credential: registered.credential,
    runnerService,
    dispatchService,
    dispatches,
    runners,
    memberships,
  };
}

function makeSignedDispatch(seed: SeededRunner, suffix = 'one') {
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
    issuedAt: new Date(BASE.getTime() + 5_000),
    expiresAt: new Date(BASE.getTime() + 45 * 60_000),
    nonce: randomUUID(),
  };
  const { privateKey } = generateKeyPairSync('ed25519');
  return signRunnerTaskEnvelope({
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
}

async function queue(seed: SeededRunner, suffix = 'one') {
  const envelope = makeSignedDispatch(seed, suffix);
  await seed.dispatches.create(envelope, new Date(BASE.getTime() + 10_000));
  return envelope;
}

function expectServiceError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AIDispatchServiceError);
  expect((error as AIDispatchServiceError).code).toBe(code);
}

describe('AIDispatchService runner eligibility', () => {
  it('claims only for a live trusted heartbeat-current runner and returns the signed envelope', async () => {
    const seed = await seedRunner();
    const envelope = await queue(seed);
    const claimed = await seed.dispatchService.claimNext({
      credential: seed.credential,
      now: CLAIM_AT,
    });
    expect(claimed).toEqual({
      dispatchId: envelope.dispatchId,
      attempt: 1,
      envelope,
      replayed: false,
    });
  });

  it('fails closed for pending trust, stale heartbeat, and revoked personal membership', async () => {
    const pending = await seedRunner('pending');
    await queue(pending, 'pending');
    await pending.runners.setRunnerTrustState(
      pending.organisationId,
      pending.runnerId,
      'pending',
      new Date(BASE.getTime() + 4_000),
    );
    await expect(pending.dispatchService.claimNext({
      credential: pending.credential,
      now: CLAIM_AT,
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'runner_unavailable');
      return true;
    });

    const stale = await seedRunner('stale');
    await queue(stale, 'stale');
    await expect(stale.dispatchService.claimNext({
      credential: stale.credential,
      now: new Date(BASE.getTime() + 31 * 60_000),
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'runner_unavailable');
      return true;
    });

    const revoked = await seedRunner('membership');
    await queue(revoked, 'membership');
    await revoked.memberships.revokeOrganisation(
      revoked.organisationId,
      revoked.userId,
      new Date(BASE.getTime() + 4_000),
    );
    await expect(revoked.dispatchService.claimNext({
      credential: revoked.credential,
      now: CLAIM_AT,
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'unauthorized');
      return true;
    });
  });

  it('cancels a newly claimed dispatch when its runner binding is no longer live', async () => {
    const seed = await seedRunner('binding');
    const envelope = await queue(seed, 'binding');
    const bindings = await seed.runners.listActiveBindingsForRunner(seed.organisationId, seed.runnerId);
    expect(bindings).toHaveLength(1);
    await seed.runners.revokeConnectionBinding(
      seed.organisationId,
      bindings[0]!.id,
      new Date(BASE.getTime() + 4_000),
    );

    await expect(seed.dispatchService.claimNext({
      credential: seed.credential,
      now: CLAIM_AT,
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'policy_blocked');
      return true;
    });
    expect((await seed.dispatches.get(seed.organisationId, envelope.dispatchId))?.state).toBe('cancelled');
  });

  it('does not let another authenticated runner mutate a dispatch it does not own', async () => {
    const owner = await seedRunner('owner');
    const other = await seedRunner('other');
    const envelope = await queue(owner, 'owned');
    await owner.dispatchService.claimNext({ credential: owner.credential, now: CLAIM_AT });

    await expect(other.dispatchService.markRunning({
      credential: other.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'forbidden');
      return true;
    });
  });
});

describe('AIDispatchService lifecycle', () => {
  it('starts, checkpoints, and completes assigned work with idempotent runner retries', async () => {
    const seed = await seedRunner('lifecycle');
    const envelope = await queue(seed, 'lifecycle');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });

    const startedAt = new Date(CLAIM_AT.getTime() + 1_000);
    await seed.dispatchService.markRunning({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: startedAt,
    });
    await expect(seed.dispatchService.markRunning({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(startedAt.getTime() + 1),
    })).resolves.toBeUndefined();

    const checkpoint = {
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      ordinal: 1,
      kind: 'status',
      metadata: { zeta: 'last', alpha: 'first', phase: 'tests' },
      now: new Date(startedAt.getTime() + 1_000),
    };
    await seed.dispatchService.addCheckpoint(checkpoint);
    await expect(seed.dispatchService.addCheckpoint(checkpoint)).resolves.toBeUndefined();
    await expect(seed.dispatchService.addCheckpoint({
      ...checkpoint,
      metadata: { zeta: 'last', alpha: 'different', phase: 'tests' },
    })).rejects.toSatisfy((error: unknown) => {
      expectServiceError(error, 'conflict');
      return true;
    });

    const completedAt = new Date(startedAt.getTime() + 2_000);
    const evidence = {
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      metadata: { zeta: 'last', alpha: 'first', exitCode: 0 },
      artifactReferences: ['artifact:z-report', 'artifact:a-report'],
      now: completedAt,
    };
    await seed.dispatchService.complete(evidence);
    await expect(seed.dispatchService.complete(evidence)).resolves.toBeUndefined();
    expect((await seed.dispatches.get(seed.organisationId, envelope.dispatchId))?.state).toBe('succeeded');
    expect(await seed.dispatches.listExecutionEvidence(seed.organisationId, envelope.dispatchId)).toHaveLength(1);
  });

  it('makes concurrent identical checkpoint retries idempotent', async () => {
    const seed = await seedRunner('concurrent-checkpoint');
    const envelope = await queue(seed, 'concurrent-checkpoint');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });
    await seed.dispatchService.markRunning({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    });
    const input = {
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      ordinal: 1,
      kind: 'test',
      metadata: { command: 'npm test', status: 'passed' },
      now: new Date(CLAIM_AT.getTime() + 2_000),
    };
    await expect(Promise.all([
      seed.dispatchService.addCheckpoint(input),
      seed.dispatchService.addCheckpoint(input),
    ])).resolves.toEqual([undefined, undefined]);
    expect(await seed.dispatches.listCheckpoints(seed.organisationId, envelope.dispatchId)).toHaveLength(1);
  });
  it('rejects concurrent conflicting checkpoint evidence with a typed conflict', async () => {
    const seed = await seedRunner('conflicting-checkpoint');
    const envelope = await queue(seed, 'conflicting-checkpoint');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });
    await seed.dispatchService.markRunning({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    });
    const base = {
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      ordinal: 1,
      kind: 'test',
      now: new Date(CLAIM_AT.getTime() + 2_000),
    };
    const results = await Promise.allSettled([
      seed.dispatchService.addCheckpoint({ ...base, metadata: { status: 'passed' } }),
      seed.dispatchService.addCheckpoint({ ...base, metadata: { status: 'failed' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
    expect(await seed.dispatches.listCheckpoints(seed.organisationId, envelope.dispatchId)).toHaveLength(1);
  });
  it('fails assigned work and rejects secret-bearing terminal evidence', async () => {
    const seed = await seedRunner('failure');
    const envelope = await queue(seed, 'failure');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });
    await seed.dispatchService.markRunning({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    });
    await expect(seed.dispatchService.fail({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      metadata: { apiKey: 'must-not-persist' },
      artifactReferences: [],
      now: new Date(CLAIM_AT.getTime() + 2_000),
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await seed.dispatches.get(seed.organisationId, envelope.dispatchId))?.state).toBe('running');

    await seed.dispatchService.fail({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      metadata: { exitCode: 1, reason: 'test_failed' },
      artifactReferences: ['artifact:test-log'],
      now: new Date(CLAIM_AT.getTime() + 3_000),
    });
    expect((await seed.dispatches.get(seed.organisationId, envelope.dispatchId))?.state).toBe('failed');
  });

  it('expires claimed and running work before rejecting late mutations with a typed conflict', async () => {
    const lateStart = await seedRunner('expired-start');
    const claimed = await queue(lateStart, 'expired-start');
    await lateStart.dispatchService.claimNext({ credential: lateStart.credential, now: CLAIM_AT });
    await lateStart.runners.recordHeartbeat(
      lateStart.organisationId, lateStart.runnerId,
      new Date(BASE.getTime() + 44 * 60_000), new Date(BASE.getTime() + 60 * 60_000),
    );
    await expect(lateStart.dispatchService.markRunning({
      credential: lateStart.credential,
      dispatchId: claimed.dispatchId,
      now: new Date(BASE.getTime() + 46 * 60_000),
    })).rejects.toMatchObject({ code: 'conflict' });
    expect((await lateStart.dispatches.get(lateStart.organisationId, claimed.dispatchId))?.state).toBe('expired');

    const lateFinish = await seedRunner('expired-finish');
    const running = await queue(lateFinish, 'expired-finish');
    await lateFinish.dispatchService.claimNext({ credential: lateFinish.credential, now: CLAIM_AT });
    await lateFinish.dispatchService.markRunning({
      credential: lateFinish.credential, dispatchId: running.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    });
    await lateFinish.runners.recordHeartbeat(
      lateFinish.organisationId, lateFinish.runnerId,
      new Date(BASE.getTime() + 44 * 60_000), new Date(BASE.getTime() + 60 * 60_000),
    );
    await expect(lateFinish.dispatchService.complete({
      credential: lateFinish.credential, dispatchId: running.dispatchId,
      metadata: { exitCode: 0 }, artifactReferences: [],
      now: new Date(BASE.getTime() + 46 * 60_000),
    })).rejects.toMatchObject({ code: 'conflict' });
    expect((await lateFinish.dispatches.get(lateFinish.organisationId, running.dispatchId))?.state).toBe('expired');
    expect(await lateFinish.dispatches.listExecutionEvidence(lateFinish.organisationId, running.dispatchId)).toHaveLength(0);
  });
  it('maps a concurrent cancellation transition race to typed conflict', async () => {
    const seed = await seedRunner('cancel-race');
    const envelope = await queue(seed, 'cancel-race');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });
    class CancellationRaceRepository extends AIDispatchRepository {
      override async cancel(): Promise<void> {
        throw new Error('active ai dispatch not found for cancellation');
      }
    }
    const racingService = new AIDispatchService({
      runnerService: seed.runnerService,
      aiRunners: seed.runners,
      memberships: seed.memberships,
      dispatches: new CancellationRaceRepository(pool),
    });
    await expect(racingService.cancelObserved({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('records runner-observed cancellation only for active assigned work', async () => {
    const seed = await seedRunner('cancel');
    const envelope = await queue(seed, 'cancel');
    await seed.dispatchService.claimNext({ credential: seed.credential, now: CLAIM_AT });
    await seed.dispatchService.cancelObserved({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 1_000),
    });
    await expect(seed.dispatchService.cancelObserved({
      credential: seed.credential,
      dispatchId: envelope.dispatchId,
      now: new Date(CLAIM_AT.getTime() + 2_000),
    })).resolves.toBeUndefined();
    expect((await seed.dispatches.get(seed.organisationId, envelope.dispatchId))?.state).toBe('cancelled');
  });
});
