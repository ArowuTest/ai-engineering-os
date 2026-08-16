import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAIConnectionRecord,
  createAIRunnerRecord,
  type RunnerTaskEnvelope,
} from '@engineering-os/domain';
import {
  signRunnerTaskEnvelope,
  type SignedRunnerTaskEnvelope,
} from '@engineering-os/runner-protocol';
import {
  AIConnectionRepository,
  AIDispatchRepository,
  AIRunnerRepository,
  ProjectRepository,
  UserRepository,
} from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

afterAll(async () => closeDatabase());

const ISSUED_AT = new Date('2026-08-15T12:00:00.000Z');
const CREATED_AT = new Date('2026-08-15T12:05:00.000Z');
const EXPIRES_AT = new Date('2026-08-15T13:00:00.000Z');

interface SeededExecutionContext {
  userId: string;
  projectId: string;
  connectionId: string;
  runnerId: string;
}

async function seedUser(organisationId: string, name: string): Promise<string> {
  const id = randomUUID();
  await new UserRepository(pool).create({
    id,
    userId: name,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'member', 'active', 'bootstrap', $3, $3)`,
    [organisationId, id, ISSUED_AT],
  );
  return id;
}

async function seedExecutionContext(
  organisationId = 'org-001',
  suffix = 'one',
): Promise<SeededExecutionContext> {
  const userId = await seedUser(organisationId, `dispatch.${suffix}`);
  const projectId = randomUUID();
  await new ProjectRepository(pool).create({
    id: projectId,
    organisationId,
    name: `Dispatch ${suffix}`,
    stage: 'implementation',
    preferredProductPartner: 'auto',
    createdBy: userId,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
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
    createdAt: ISSUED_AT,
  }));

  const runner = createAIRunnerRecord({
    id: randomUUID(),
    organisationId,
    ownership: 'personal',
    ownerUserId: userId,
    harnessId: 'codex',
    status: 'online',
    trustState: 'trusted',
    persistentSupported: false,
    capabilities: ['headless', 'workspace'],
    createdBy: userId,
    createdAt: ISSUED_AT,
  });
  const runnerRepo = new AIRunnerRepository(pool);
  await runnerRepo.createRunner(runner);
  await runnerRepo.recordHeartbeat(organisationId, runner.id, CREATED_AT, EXPIRES_AT);
  await runnerRepo.createConnectionBinding({
    id: randomUUID(),
    organisationId,
    runnerId: runner.id,
    connectionId,
    createdBy: userId,
    createdAt: ISSUED_AT,
  });
  return { userId, projectId, connectionId, runnerId: runner.id };
}

function signedDispatch(
  context: SeededExecutionContext,
  overrides: {
    dispatchId?: string;
    taskId?: string;
    attempt?: number;
    idempotencyKey?: string;
    expiresAt?: Date;
  } = {},
): SignedRunnerTaskEnvelope {
  const taskEnvelope: RunnerTaskEnvelope = {
    id: randomUUID(),
    organisationId: 'org-001',
    projectId: context.projectId,
    taskId: overrides.taskId ?? 'task-1',
    connectionId: context.connectionId,
    routeId: 'openrouter-qwen',
    harnessId: 'codex',
    allowedOperations: ['read', 'write', 'test'],
    workspaceScope: 'C:/worktrees/task-1',
    issuedAt: ISSUED_AT,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
    nonce: randomUUID(),
  };
  const { privateKey } = generateKeyPairSync('ed25519');
  return signRunnerTaskEnvelope({
    dispatchId: overrides.dispatchId ?? randomUUID(),
    runnerId: context.runnerId,
    requesterUserId: context.userId,
    attempt: overrides.attempt ?? 1,
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    taskEnvelope,
    payload: {
      objective: 'Implement the queued task.',
      contextReferences: ['file:src/index.ts'],
      requiredCapabilities: ['headless', 'localWorkspace'],
    },
  }, privateKey);
}

describe('ai dispatch migration schema', () => {
  beforeEach(async () => resetDatabase());

  it('applies migration 008 without changing canonical runner migration authority', async () => {
    const migrations = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name ASC',
    );
    expect(migrations.rows.map((row) => row.name)).toContain('007_ai_runners.sql');
    expect(migrations.rows.map((row) => row.name)).toContain('008_ai_dispatches.sql');

    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('ai_dispatches', 'ai_dispatch_checkpoints', 'ai_dispatch_execution_evidence')`,
    );
    expect(columns.rows.length).toBeGreaterThan(0);
    const names = columns.rows.map((row) => row.column_name);
    for (const forbidden of [
      'api_key', 'access_token', 'refresh_token', 'password', 'cookie',
      'provider_session', 'private_key', 'secret',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('makes checkpoints and terminal evidence append-only at the database layer', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(context);
    await repo.create(signed, CREATED_AT);
    const claim = await repo.claimNext('org-001', context.runnerId, new Date('2026-08-15T12:09:00Z'));
    expect(claim?.dispatch.id).toBe(signed.dispatchId);
    await repo.addCheckpoint('org-001', signed.dispatchId, {
      id: randomUUID(),
      attempt: 1,
      ordinal: 1,
      kind: 'status',
      metadata: { status: 'claimed' },
      createdAt: new Date('2026-08-15T12:10:00Z'),
    });
    await repo.markRunning(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:12:00Z'),
    );
    const evidenceId = randomUUID();
    await repo.complete('org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:13:00Z'), {
      id: evidenceId,
      metadata: { exitCode: 0 },
      artifactReferences: ['artifact:test-report'],
    });

    await expect(pool.query(
      `UPDATE ai_dispatch_checkpoints SET kind = 'tampered' WHERE dispatch_id = $1`,
      [signed.dispatchId],
    )).rejects.toThrow();
    await expect(pool.query(
      `DELETE FROM ai_dispatch_execution_evidence WHERE id = $1`,
      [evidenceId],
    )).rejects.toThrow();
  });
});

describe('AIDispatchRepository', () => {
  beforeEach(async () => resetDatabase());

  it('rejects direct mutation of signed execution identity and pre-claim checkpoints', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(context);
    await repo.create(signed, CREATED_AT);

    await expect(pool.query(
      `UPDATE ai_dispatches SET objective = 'tampered objective' WHERE id = $1`,
      [signed.dispatchId],
    )).rejects.toThrow(/immutable/i);

    await repo.claimNext('org-001', context.runnerId, new Date('2026-08-15T12:10:00Z'));
    await expect(repo.addCheckpoint('org-001', signed.dispatchId, {
      id: randomUUID(),
      attempt: 1,
      ordinal: 1,
      kind: 'status',
      metadata: { status: 'claimed' },
      createdAt: new Date('2026-08-15T12:09:59.999Z'),
    })).rejects.toThrow(/checkpoint/);
  });
  it('creates a queued dispatch from the signed protocol envelope and scopes reads by organisation', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(context);
    await repo.create(signed, CREATED_AT);

    const record = await repo.get('org-001', signed.dispatchId);
    expect(record).toMatchObject({
      id: signed.dispatchId,
      organisationId: 'org-001',
      projectId: context.projectId,
      requesterUserId: context.userId,
      runnerId: context.runnerId,
      connectionId: context.connectionId,
      harnessId: 'codex',
      routeId: 'openrouter-qwen',
      state: 'queued',
      attempt: 1,
      idempotencyKey: signed.idempotencyKey,
    });
    expect(record?.signedEnvelope).toEqual(signed);
    expect(await repo.get('org-002', signed.dispatchId)).toBeNull();
  });

  it('refuses to claim when runner liveness or personal membership is no longer valid', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const first = signedDispatch(context, { taskId: 'task-stale' });
    await repo.create(first, CREATED_AT);

    await pool.query(
      `UPDATE ai_runners SET heartbeat_expires_at = $3 WHERE organisation_id = $1 AND id = $2`,
      ['org-001', context.runnerId, new Date('2026-08-15T12:15:00.000Z')],
    );
    const staleAt = new Date('2026-08-15T12:20:00.000Z');
    expect(await repo.claimNext('org-001', context.runnerId, staleAt)).toBeNull();
    expect((await repo.get('org-001', first.dispatchId))?.state).toBe('queued');

    await new AIRunnerRepository(pool).recordHeartbeat(
      'org-001', context.runnerId, new Date('2026-08-15T12:30:00.000Z'), new Date('2026-08-15T13:30:00.000Z'),
    );
    await pool.query(
      `UPDATE organisation_memberships SET status = 'revoked', updated_at = $3
       WHERE organisation_id = $1 AND user_id = $2`,
      ['org-001', context.userId, new Date('2026-08-15T12:31:00.000Z')],
    );
    expect(await repo.claimNext('org-001', context.runnerId, new Date('2026-08-15T12:32:00.000Z'))).toBeNull();
    expect((await repo.get('org-001', first.dispatchId))?.state).toBe('queued');
  });
  it('refuses replay and execution-progress mutations after runner authority is disabled', async () => {
    const replayContext = await seedExecutionContext('org-001', 'authority-replay');
    const repo = new AIDispatchRepository(pool);
    const replayDispatch = signedDispatch(replayContext, { taskId: 'task-authority-replay' });
    await repo.create(replayDispatch, CREATED_AT);
    await repo.claimNext('org-001', replayContext.runnerId, new Date('2026-08-15T12:10:00Z'));
    await new AIRunnerRepository(pool).setRunnerStatus(
      'org-001', replayContext.runnerId, 'disabled', new Date('2026-08-15T12:11:00Z'),
    );
    expect(await repo.claimNext(
      'org-001', replayContext.runnerId, new Date('2026-08-15T12:12:00Z'),
    )).toBeNull();
    expect((await repo.get('org-001', replayDispatch.dispatchId))?.state).toBe('claimed');

    const startContext = await seedExecutionContext('org-001', 'authority-start');
    const startDispatch = signedDispatch(startContext, { taskId: 'task-authority-start' });
    await repo.create(startDispatch, CREATED_AT);
    await repo.claimNext('org-001', startContext.runnerId, new Date('2026-08-15T12:10:00Z'));
    await new AIRunnerRepository(pool).setRunnerStatus(
      'org-001', startContext.runnerId, 'disabled', new Date('2026-08-15T12:11:00Z'),
    );
    await expect(repo.markRunning(
      'org-001', startDispatch.dispatchId, startContext.runnerId, new Date('2026-08-15T12:12:00Z'),
    )).rejects.toThrow(/claimed ai dispatch/i);
    expect((await repo.get('org-001', startDispatch.dispatchId))?.state).toBe('claimed');
    const progressContext = await seedExecutionContext('org-001', 'authority-progress');
    const progressDispatch = signedDispatch(progressContext, { taskId: 'task-authority-progress' });
    await repo.create(progressDispatch, CREATED_AT);
    await repo.claimNext('org-001', progressContext.runnerId, new Date('2026-08-15T12:10:00Z'));
    await repo.markRunning(
      'org-001', progressDispatch.dispatchId, progressContext.runnerId, new Date('2026-08-15T12:11:00Z'),
    );
    await new AIRunnerRepository(pool).setRunnerStatus(
      'org-001', progressContext.runnerId, 'disabled', new Date('2026-08-15T12:12:00Z'),
    );
    await expect(repo.addCheckpoint('org-001', progressDispatch.dispatchId, {
      id: randomUUID(), attempt: 1, ordinal: 1, kind: 'status', metadata: { status: 'late' },
      createdAt: new Date('2026-08-15T12:13:00Z'),
    })).rejects.toThrow(/active ai dispatch/i);
    await expect(repo.complete(
      'org-001', progressDispatch.dispatchId, progressContext.runnerId,
      new Date('2026-08-15T12:13:00Z'),
      { id: randomUUID(), metadata: { exitCode: 0 }, artifactReferences: [] },
    )).rejects.toThrow(/terminal transition/i);
    expect(await repo.listCheckpoints('org-001', progressDispatch.dispatchId)).toHaveLength(0);
    expect(await repo.listExecutionEvidence('org-001', progressDispatch.dispatchId)).toHaveLength(0);
    expect((await repo.get('org-001', progressDispatch.dispatchId))?.state).toBe('running');
  });
  it('checkpoint transaction locks only its assigned runner and cannot hide another runner queued claim', async () => {
    const runnerA = await seedExecutionContext('org-001', 'lock-a');
    const runnerB = await seedExecutionContext('org-001', 'lock-b');
    const repo = new AIDispatchRepository(pool);
    const dispatchA = signedDispatch(runnerA, { taskId: 'task-lock-a' });
    const dispatchB = signedDispatch(runnerB, { taskId: 'task-lock-b' });
    await repo.create(dispatchA, CREATED_AT);
    await repo.create(dispatchB, new Date(CREATED_AT.getTime() + 1));
    await repo.claimNext('org-001', runnerB.runnerId, new Date('2026-08-15T12:10:00Z'));
    await repo.markRunning('org-001', dispatchB.dispatchId, runnerB.runnerId, new Date('2026-08-15T12:11:00Z'));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txRepo = new AIDispatchRepository(client);
      await txRepo.addCheckpoint('org-001', dispatchB.dispatchId, {
        id: randomUUID(), attempt: 1, ordinal: 1, kind: 'status', metadata: { phase: 'held-open' },
        createdAt: new Date('2026-08-15T12:12:00Z'),
      });
      const claimedA = await repo.claimNext('org-001', runnerA.runnerId, new Date('2026-08-15T12:12:01Z'));
      expect(claimedA?.dispatch.id).toBe(dispatchA.dispatchId);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
  it('does not report false no-work when an unrelated runner-row lock releases', async () => {
    const context = await seedExecutionContext('org-001', 'runner-lock-no-work');
    const repo = new AIDispatchRepository(pool);
    const dispatch = signedDispatch(context, { taskId: 'task-runner-lock' });
    await repo.create(dispatch, CREATED_AT);

    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(
        'SELECT id FROM ai_runners WHERE organisation_id = $1 AND id = $2 FOR UPDATE',
        ['org-001', context.runnerId],
      );
      const release = setTimeout(() => void locker.query('COMMIT'), 500);
      const claimed = await new AIDispatchRepository(pool).claimNext(
        'org-001', context.runnerId, new Date('2026-08-15T12:10:01Z'),
      );
      clearTimeout(release);
      expect(claimed?.dispatch.id).toBe(dispatch.dispatchId);
      expect(claimed?.replayed).toBe(false);
    } finally {
      try { await locker.query('ROLLBACK'); } catch { /* transaction may already be committed */ }
      locker.release();
    }
  });
  it('waits for an in-flight single queued claim and replays it after commit', async () => {
    const context = await seedExecutionContext('org-001', 'single-claim-replay');
    const repo = new AIDispatchRepository(pool);
    const dispatch = signedDispatch(context, { taskId: 'task-single-claim' });
    await repo.create(dispatch, CREATED_AT);

    const claiming = await pool.connect();
    try {
      await claiming.query('BEGIN');
      await claiming.query(
        'SELECT id FROM ai_runners WHERE organisation_id = $1 AND id = $2 FOR UPDATE',
        ['org-001', context.runnerId],
      );
      await claiming.query(
        `UPDATE ai_dispatches SET state = 'claimed', claimed_at = $3, updated_at = $3
         WHERE organisation_id = $1 AND id = $2`,
        ['org-001', dispatch.dispatchId, new Date('2026-08-15T12:10:00Z')],
      );

      const release = setTimeout(() => void claiming.query('COMMIT'), 500);
      const replay = await new AIDispatchRepository(pool).claimNext(
        'org-001', context.runnerId, new Date('2026-08-15T12:10:01Z'),
      );
      clearTimeout(release);
      expect(replay?.dispatch.id).toBe(dispatch.dispatchId);
      expect(replay?.replayed).toBe(true);
    } finally {
      try { await claiming.query('ROLLBACK'); } catch { /* transaction may already be committed */ }
      claiming.release();
    }
  });
  it('allows at most one active dispatch per runner under concurrent claims', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const first = signedDispatch(context, { taskId: 'task-a', idempotencyKey: randomUUID() });
    const second = signedDispatch(context, { taskId: 'task-b', idempotencyKey: randomUUID() });
    await repo.create(first, CREATED_AT);
    await repo.create(second, new Date(CREATED_AT.getTime() + 1));

    const now = new Date('2026-08-15T12:10:00Z');
    const [left, right] = await Promise.all([
      new AIDispatchRepository(pool).claimNext('org-001', context.runnerId, now),
      new AIDispatchRepository(pool).claimNext('org-001', context.runnerId, now),
    ]);

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left?.dispatch.id).toBe(right?.dispatch.id);
    expect([left?.replayed, right?.replayed].sort()).toEqual([false, true]);

    const active = await pool.query<{ id: string }>(
      `SELECT id FROM ai_dispatches
       WHERE organisation_id = 'org-001' AND runner_id = $1
         AND state IN ('claimed', 'running')`,
      [context.runnerId],
    );
    expect(active.rows).toHaveLength(1);
    const queued = await pool.query<{ id: string }>(
      `SELECT id FROM ai_dispatches WHERE runner_id = $1 AND state = 'queued'`,
      [context.runnerId],
    );
    expect(queued.rows).toHaveLength(1);
  });

  it('makes concurrent identical start and terminal retries idempotent despite server-owned evidence ids', async () => {
    const startContext = await seedExecutionContext('org-001', 'concurrent-start');
    const repo = new AIDispatchRepository(pool);
    const startDispatch = signedDispatch(startContext, { taskId: 'task-concurrent-start' });
    await repo.create(startDispatch, CREATED_AT);
    await repo.claimNext('org-001', startContext.runnerId, new Date('2026-08-15T12:10:00Z'));
    const startAt = new Date('2026-08-15T12:11:00Z');
    await expect(Promise.all([
      new AIDispatchRepository(pool).markRunning('org-001', startDispatch.dispatchId, startContext.runnerId, startAt),
      new AIDispatchRepository(pool).markRunning('org-001', startDispatch.dispatchId, startContext.runnerId, startAt),
    ])).resolves.toEqual([undefined, undefined]);

    const finishContext = await seedExecutionContext('org-001', 'concurrent-finish');
    const finishDispatch = signedDispatch(finishContext, { taskId: 'task-concurrent-finish' });
    await repo.create(finishDispatch, CREATED_AT);
    await repo.claimNext('org-001', finishContext.runnerId, new Date('2026-08-15T12:10:00Z'));
    await repo.markRunning('org-001', finishDispatch.dispatchId, finishContext.runnerId, startAt);
    const completedAt = new Date('2026-08-15T12:12:00Z');
    const common = { metadata: { exitCode: 0 }, artifactReferences: ['artifact:test-report'] };
    await expect(Promise.all([
      new AIDispatchRepository(pool).complete('org-001', finishDispatch.dispatchId, finishContext.runnerId, completedAt, { id: randomUUID(), ...common }),
      new AIDispatchRepository(pool).complete('org-001', finishDispatch.dispatchId, finishContext.runnerId, completedAt, { id: randomUUID(), ...common }),
    ])).resolves.toEqual([undefined, undefined]);
    expect(await repo.listExecutionEvidence('org-001', finishDispatch.dispatchId)).toHaveLength(1);
  });
  it('enforces legal transitions and makes an exact terminal replay idempotent', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(context);
    await repo.create(signed, CREATED_AT);

    await expect(repo.markRunning(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:06:00Z'),
    )).rejects.toThrow(/claimed/);

    await repo.claimNext('org-001', context.runnerId, new Date('2026-08-15T12:07:00Z'));
    await repo.markRunning(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:08:00Z'),
    );
    const evidence = {
      id: randomUUID(),
      metadata: { zeta: 'last', alpha: 'first', exitCode: 0, inputTokens: 42 },
      artifactReferences: ['artifact:test-report'],
    };
    const completedAt = new Date('2026-08-15T12:09:00Z');
    await repo.complete('org-001', signed.dispatchId, context.runnerId, completedAt, evidence);
    await expect(
      repo.complete('org-001', signed.dispatchId, context.runnerId, completedAt, evidence),
    ).resolves.toBeUndefined();
    await expect(repo.complete(
      'org-001', signed.dispatchId, context.runnerId,
      new Date(completedAt.getTime() + 1), { ...evidence, id: randomUUID() },
    )).resolves.toBeUndefined();

    const stored = await repo.get('org-001', signed.dispatchId);
    expect(stored?.state).toBe('succeeded');
    const storedEvidence = await repo.listExecutionEvidence('org-001', signed.dispatchId);
    expect(storedEvidence).toHaveLength(1);
    expect(storedEvidence[0]).toMatchObject({
      id: evidence.id,
      outcome: 'succeeded',
      metadata: { zeta: 'last', alpha: 'first', exitCode: 0, inputTokens: 42 },
      artifactReferences: ['artifact:test-report'],
    });

    await expect(repo.fail(
      'org-001', signed.dispatchId, context.runnerId, completedAt,
      { ...evidence, id: randomUUID() },
    )).rejects.toThrow(/terminal/);
  });

  it('cancels or expires only the intended tenant and runner work', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const cancellable = signedDispatch(context, { taskId: 'task-cancel' });
    const expiring = signedDispatch(context, {
      taskId: 'task-expire',
      idempotencyKey: randomUUID(),
      expiresAt: new Date('2026-08-15T12:20:00Z'),
    });
    await repo.create(cancellable, CREATED_AT);
    await repo.create(expiring, new Date(CREATED_AT.getTime() + 1));

    await repo.cancel(
      'org-001', cancellable.dispatchId, context.runnerId, new Date('2026-08-15T12:10:00Z'),
    );
    expect((await repo.get('org-001', cancellable.dispatchId))?.state).toBe('cancelled');

    expect(await repo.expireDue(
      'org-002', context.runnerId, new Date('2026-08-15T12:21:00Z'),
    )).toBe(0);
    expect(await repo.expireDue(
      'org-001', context.runnerId, new Date('2026-08-15T12:21:00Z'),
    )).toBe(1);
    expect((await repo.get('org-001', expiring.dispatchId))?.state).toBe('expired');
  });

  it('rejects oversized or secret-bearing evidence before it reaches persistence', async () => {
    const context = await seedExecutionContext();
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(context);
    await repo.create(signed, CREATED_AT);
    await repo.claimNext('org-001', context.runnerId, new Date('2026-08-15T12:06:00Z'));
    await repo.markRunning(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:07:00Z'),
    );

    await expect(repo.complete(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:08:00Z'),
      { id: randomUUID(), metadata: { apiKey: 'secret-value' }, artifactReferences: [] },
    )).rejects.toThrow(/credential|secret/i);
    await expect(repo.complete(
      'org-001', signed.dispatchId, context.runnerId, new Date('2026-08-15T12:08:00Z'),
      {
        id: randomUUID(),
        metadata: { diagnostic: 'x'.repeat(20_000) },
        artifactReferences: [],
      },
    )).rejects.toThrow(/metadata.*large/i);

    const record = await repo.get('org-001', signed.dispatchId);
    expect(record?.state).toBe('running');
    expect(await repo.listExecutionEvidence('org-001', signed.dispatchId)).toEqual([]);
  });

  it('rejects cross-tenant dispatch identities through PostgreSQL foreign keys', async () => {
    const one = await seedExecutionContext('org-001', 'tenant-one');
    const two = await seedExecutionContext('org-002', 'tenant-two');
    const repo = new AIDispatchRepository(pool);
    const signed = signedDispatch(one);
    const forged = {
      ...signed,
      runnerId: two.runnerId,
    } as SignedRunnerTaskEnvelope;

    await expect(repo.create(forged, CREATED_AT)).rejects.toThrow();
    expect(await repo.get('org-001', signed.dispatchId)).toBeNull();
  });
});
