import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCollaborativeMemoryRecord,
  createProject,
  createReviewFinding,
  digestReviewMaterial,
  type ReviewerOutcomeInput,
} from '@engineering-os/domain';
import {
  CollaborativeMemoryRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  ProjectRepository,
  ReviewCouncilRepository,
  UserRepository,
} from '@engineering-os/database';
import {
  ReviewCouncilService,
  type ReviewCouncilExecutor,
  type ReviewExecutionInput,
  type ReviewExecutionResult,
} from '../src/review-council-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const now = new Date('2026-08-17T01:45:00.000Z');
const source = 'commit:review-candidate\nfile:src/a.ts\ncontent:alpha';
const evidence = 'tests:all-green\ntypecheck:pass';

async function seedProject(role: 'reviewer' | 'engineer' | 'product_owner' = 'reviewer') {
  const userId = randomUUID();
  await new UserRepository(pool).create({
    id: userId, userId: `council.${userId.slice(0, 8)}`, passwordHash: 'scrypt$test$hash',
    status: 'active', createdAt: now, updatedAt: now,
  });  const memberships = new MembershipRepository(pool);
  await memberships.grantOrganisation({
    organisationId: 'org-001', userId, role: 'admin', createdBy: 'bootstrap', now,
  });
  const project = createProject({
    organisationId: 'org-001', name: 'Review Council', createdBy: userId,
  });
  await new ProjectRepository(pool).create(project);
  await memberships.grantProject({
    organisationId: 'org-001', projectId: project.id, userId,
    role, createdBy: userId, now,
  });
  const reviewCouncil = new ReviewCouncilRepository(pool);
  if (!(await reviewCouncil.listArchitectureInvariants()).some((entry) => entry.id === 'runner-local-auth')) {
    await reviewCouncil.createArchitectureInvariant({
      id: 'runner-local-auth', key: 'runner-local-auth',
      description: 'Runner authentication remains local to the authorised runner boundary.',
      severity: 'important', createdAt: now,
    });
  }
  return { userId, project };
}

class FakeExecutor implements ReviewCouncilExecutor {
  readonly calls: ReviewExecutionInput[] = [];
  constructor(private readonly results: Map<string, ReviewExecutionResult>) {}

  async review(input: ReviewExecutionInput): Promise<ReviewExecutionResult> {
    this.calls.push(input);
    return this.results.get(input.assignment.id) ?? {
      outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [],
    };
  }
}

function service(executor: ReviewCouncilExecutor, options: { reviewExecutionTimeoutMs?: number } = {}) {
  return new ReviewCouncilService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    memberships: new MembershipRepository(pool),
    users: new UserRepository(pool),
    reviewCouncil: new ReviewCouncilRepository(pool),
    collaborativeMemory: new CollaborativeMemoryRepository(pool),
    executor,
    ...options,
  });
}

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());
describe('ReviewCouncilService blind collection', () => {
  it('sends every reviewer the same canonical packet while keeping reviewer-private memory isolated', async () => {
    const { userId, project } = await seedProject();
    const executor = new FakeExecutor(new Map());
    const council = service(executor);
    const created = await council.createBlindRun({
      id: 'run-blind', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-a', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-b', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v2' },
      ],
      now,
    });
    const memories = new CollaborativeMemoryRepository(pool);
    await memories.createMemory(createCollaborativeMemoryRecord({
      id: 'mem_20260817_project', organisationId: 'org-001', projectId: project.id,
      scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'governed',
      title: 'Shared architecture', content: 'Runner auth remains local.', createdBy: userId,
      sourceType: 'human', createdAt: now,
    }));
    await memories.createMemory(createCollaborativeMemoryRecord({
      id: 'mem_20260817_unreviewed_project', organisationId: 'org-001', projectId: project.id,
      scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
      title: 'Unreviewed project note', content: 'Must not be sent to blind reviewers.', createdBy: userId,
      sourceType: 'human', createdAt: new Date(now.getTime() + 1),
    }));
    for (const assignmentId of ['assignment-a', 'assignment-b']) {
      await memories.createMemory(createCollaborativeMemoryRecord({
        id: `mem_20260817_${assignmentId}`, organisationId: 'org-001', projectId: project.id,
        scope: 'review', visibility: 'reviewer_private', reviewerAssignmentId: assignmentId,
        kind: 'evidence', trust: 'unreviewed', title: `Private ${assignmentId}`,
        content: `Private context for ${assignmentId}.`, createdBy: userId,
        sourceType: 'review_council', createdAt: now,
      }));
    }
    await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 20, maxMemoryBytes: 20_000,
    });

    expect(executor.calls).toHaveLength(2);
    expect(new Set(executor.calls.map((call) => call.packet.packetDigest))).toEqual(new Set([created.run.packetDigest]));
    expect(executor.calls.every((call) => call.packet.source === source && call.packet.evidence === evidence)).toBe(true);
    const callA = executor.calls.find((call) => call.assignment.id === 'assignment-a')!;
    const callB = executor.calls.find((call) => call.assignment.id === 'assignment-b')!;
    expect(callA.memory.items.map((item) => item.memoryId).sort()).toEqual([
      'mem_20260817_assignment-a', 'mem_20260817_project',
    ]);
    expect(callB.memory.items.map((item) => item.memoryId).sort()).toEqual([
      'mem_20260817_assignment-b', 'mem_20260817_project',
    ]);
    expect(callA.memory.items.map((item) => item.memoryId)).not.toContain('mem_20260817_assignment-b');
    expect(callB.memory.items.map((item) => item.memoryId)).not.toContain('mem_20260817_assignment-a');
    expect(callA.memory.items.map((item) => item.memoryId)).not.toContain('mem_20260817_unreviewed_project');
    expect(callB.memory.items.map((item) => item.memoryId)).not.toContain('mem_20260817_unreviewed_project');
    expect(callA.memory.excluded.some((item) => 'memoryId' in item && item.memoryId === 'mem_20260817_assignment-b')).toBe(false);
    expect(callB.memory.excluded.some((item) => 'memoryId' in item && item.memoryId === 'mem_20260817_assignment-a')).toBe(false);
    expect(callA.assignment).toMatchObject({ routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' });
    expect(callB.assignment).toMatchObject({ routeId: 'route-b', modelId: 'model-b', modelVersion: 'v2' });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
  });

  it('recovers the canonical blind packet from durable review material after transient request state is lost', async () => {
    const { userId, project } = await seedProject();
    const executor = new FakeExecutor(new Map());
    const council = service(executor);
    const created = await council.createBlindRun({
      id: 'run-durable-material', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'], reviewers: [
        { id: 'assignment-durable', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    await (council as any).collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.packet).toMatchObject({
      source, evidence, invariantIds: ['runner-local-auth'], packetDigest: created.run.packetDigest,
    });
  });

  it('binds invariant IDs into the durable packet identity and rejects collection with changed invariants', async () => {
    const { userId, project } = await seedProject();
    const executor = new FakeExecutor(new Map());
    const council = service(executor);
    const created = await council.createBlindRun({
      id: 'run-invariant-binding', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-invariant', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });

    await expect(council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['different-invariant'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000,
    })).rejects.toThrow(/packet|invariant|digest/i);
    expect(executor.calls).toHaveLength(0);
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('collecting');
  });

  it('rejects a blind run that binds an invariant ID absent from the durable registry', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map()));
    await expect(council.createBlindRun({
      id: 'run-missing-invariant', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['missing-invariant'],
      reviewers: [{ id: 'assignment-missing-invariant', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }],
      now,
    })).rejects.toThrow(/invariant/i);
    expect(await new ReviewCouncilRepository(pool).getRun('org-001', 'run-missing-invariant')).toBeNull();
  });

  it('requires review authority before creating or collecting a council run', async () => {
    const engineer = await seedProject('engineer');
    const engineerExecutor = new FakeExecutor(new Map());
    await expect(service(engineerExecutor).createBlindRun({ id:'run-engineer-create', organisationId:'org-001', projectId:engineer.project.id, actorUserId:engineer.userId, source, evidence, invariantIds:['runner-local-auth'], reviewers:[{id:'assignment-engineer',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}], now })).rejects.toThrow('forbidden');
    expect(await new ReviewCouncilRepository(pool).getRun('org-001','run-engineer-create')).toBeNull();

    await resetDatabase();
    const seeded = await seedProject('reviewer');
    const executor = new FakeExecutor(new Map());
    const council = service(executor);
    const created = await council.createBlindRun({ id:'run-engineer-collect', organisationId:'org-001', projectId:seeded.project.id, actorUserId:seeded.userId, source, evidence, invariantIds:['runner-local-auth'], reviewers:[{id:'assignment-collect',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}], now });
    await new MembershipRepository(pool).grantProject({ organisationId:'org-001', projectId:seeded.project.id, userId:seeded.userId, role:'engineer', createdBy:'bootstrap', now:new Date(now.getTime()+1) });
    await expect(council.collectBlindReviews({ organisationId:'org-001', projectId:seeded.project.id, actorUserId:seeded.userId, reviewRunId:created.run.id, maxMemoryItems:10, maxMemoryBytes:10_000 })).rejects.toThrow('forbidden');
    expect(executor.calls).toHaveLength(0);
  });

  it('does not automatically steal an expired collection claim while provider work is still in flight', async () => {
    const { userId, project } = await seedProject();
    let calls=0; let release!:()=>void; let entered!:()=>void;
    const barrier=new Promise<void>((resolve)=>{ release=resolve; }); const started=new Promise<void>((resolve)=>{ entered=resolve; });
    const council=service({async review(){calls+=1; entered(); await barrier; return {outcome:{kind:'completed',content:'NO FINDINGS'},findings:[]};}});
    const created=await council.createBlindRun({id:'run-expired-claim',organisationId:'org-001',projectId:project.id,actorUserId:userId,source,evidence,invariantIds:['runner-local-auth'],reviewers:[{id:'assignment-expiry',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}],now});
    const first=council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000}).then((value)=>({ok:true as const,value}),(error)=>({ok:false as const,error}));
    await started; await pool.query("UPDATE review_runs SET collection_claim_expires_at=$3 WHERE organisation_id=$1 AND id=$2",['org-001',created.run.id,new Date(Date.now()-1000)]);
    const second=council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000}).then((value)=>({ok:true as const,value}),(error)=>({ok:false as const,error}));
    await new Promise((resolve)=>setTimeout(resolve,75));
    const callsBeforeRelease=calls; release();
    const settled=await Promise.all([first,second]);
    expect(callsBeforeRelease).toBe(1);
    expect(settled.filter((result)=>result.ok)).toHaveLength(0);
    expect(settled.filter((result)=>!result.ok)).toHaveLength(2);
  });

  it('stops queued reviewer work when the active collection claim expires mid-collection', async () => {
    const { userId, project } = await seedProject();
    let calls = 0;
    const council = service({ async review() {
      calls += 1;
      if (calls === 1) {
        await pool.query(
          'UPDATE review_runs SET collection_claim_expires_at=$3 WHERE organisation_id=$1 AND id=$2',
          ['org-001', 'run-midloop-expiry', new Date(Date.now() - 1_000)],
        );
      }
      return { outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [] };
    } });
    const reviewers = Array.from({ length: 5 }, (_, index) => ({
      id: `assignment-expire-${index}`, role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1',
    }));
    const created = await council.createBlindRun({ id: 'run-midloop-expiry', organisationId: 'org-001',
      projectId: project.id, actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'], reviewers, now });

    await expect(council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 }))
      .rejects.toThrow(/claim|stale|expired/i);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(reviewers.length);
  });

  it('recovers an explicitly expired crash claim through reviewer-authorised service recovery', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map()));
    const created = await council.createBlindRun({
      id: 'run-crash-recovery', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-crash', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now,
    });
    const repo = new ReviewCouncilRepository(pool);
    await repo.claimCollection('org-001', created.run.id, 'lost-claim', now, new Date(now.getTime() + 100));
    await expect((council as any).recoverExpiredCollectionClaim({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, observedAt: new Date(now.getTime() + 101),
    })).resolves.toBe(true);
    await expect(council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 })).resolves.toHaveLength(1);
  });

  it('does not recover a database-valid collection claim using a future application observation time', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map()));
    const created = await council.createBlindRun({
      id: 'run-db-clock-recovery', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-db-clock', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now,
    });
    const repo = new ReviewCouncilRepository(pool);
    const claimNow = new Date();
    await repo.claimCollection('org-001', created.run.id, 'db-clock-claim', claimNow, new Date(claimNow.getTime() + 300_000));
    await expect(council.recoverExpiredCollectionClaim({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, observedAt: new Date(claimNow.getTime() + 86_400_000),
    })).resolves.toBe(false);
    await expect(repo.requireCollectionClaim('org-001', created.run.id, 'db-clock-claim')).resolves.toBeUndefined();
  });

  it('durably checkpoints a completed reviewer before slower seats finish', async () => {
    const { userId, project } = await seedProject();
    let releaseSlow!: () => void; let fastReturned!: () => void;
    const slowBarrier = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const fastDone = new Promise<void>((resolve) => { fastReturned = resolve; });
    const council = service({ async review(input) {
      if (input.assignment.id === 'assignment-checkpoint-fast') {
        fastReturned(); return { outcome:{kind:'completed',content:'fast'}, findings:[] };
      }
      await slowBarrier; return { outcome:{kind:'completed',content:'slow'}, findings:[] };
    }});
    const created = await council.createBlindRun({ id:'run-seat-checkpoint', organisationId:'org-001', projectId:project.id,
      actorUserId:userId, source, evidence, invariantIds:['runner-local-auth'], reviewers:[
        {id:'assignment-checkpoint-fast',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'},
        {id:'assignment-checkpoint-slow',role:'security',routeId:'route-b',modelId:'model-b',modelVersion:'v1'},
      ], now });
    const collecting = council.collectBlindReviews({ organisationId:'org-001', projectId:project.id, actorUserId:userId,
      reviewRunId:created.run.id, maxMemoryItems:10, maxMemoryBytes:10_000 });
    await fastDone; await new Promise((resolve)=>setTimeout(resolve,75));
    const fastStatus=(await new ReviewCouncilRepository(pool).getReviewerAssignment(
      'org-001', created.run.id, 'assignment-checkpoint-fast'))?.status;
    releaseSlow(); await collecting;
    expect(fastStatus).toBe('completed');
  });

  it('returns a timeout within a fixed bound even when the executor ignores abort forever', async () => {
    const { userId, project } = await seedProject();
    const council=service({ async review(){ return new Promise<ReviewExecutionResult>(()=>{}); } }, {reviewExecutionTimeoutMs:20});
    const created=await council.createBlindRun({id:'run-never-settles',organisationId:'org-001',projectId:project.id,
      actorUserId:userId,source,evidence,invariantIds:['runner-local-auth'],reviewers:[
        {id:'assignment-never-settles',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}],now});
    const collection=council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,
      reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000});
    const bounded=await Promise.race([collection.then(()=>true,()=>true),new Promise<boolean>((resolve)=>setTimeout(()=>resolve(false),1500))]);
    expect(bounded).toBe(true);
  });

  it('does not recover an expired database claim while its provider call is still live', async () => {
    const { userId, project } = await seedProject();
    let entered!:()=>void; const started=new Promise<void>((resolve)=>{entered=resolve;});
    const council=service({ async review(){ entered(); return new Promise<ReviewExecutionResult>(()=>{}); } }, {reviewExecutionTimeoutMs:20});
    const created=await council.createBlindRun({id:'run-live-claim-recovery',organisationId:'org-001',projectId:project.id,
      actorUserId:userId,source,evidence,invariantIds:['runner-local-auth'],reviewers:[
        {id:'assignment-live-claim',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}],now});
    const collection=council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,
      reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000}).then(()=>true,()=>true);
    await started; await new Promise((resolve)=>setTimeout(resolve,35));
    const beforeRecovery=await new ReviewCouncilRepository(pool).getRun('org-001',created.run.id);
    if (beforeRecovery?.status === 'collecting') {
      await pool.query('UPDATE review_runs SET collection_claim_expires_at=$3 WHERE organisation_id=$1 AND id=$2',
        ['org-001',created.run.id,new Date(Date.now()-1000)]);
    }
    const recovered=await council.recoverExpiredCollectionClaim({organisationId:'org-001',projectId:project.id,
      actorUserId:userId,reviewRunId:created.run.id,observedAt:new Date()}).then((value)=>value,()=>false);
    expect(recovered).toBe(false);
    expect(await Promise.race([collection,new Promise<boolean>((resolve)=>setTimeout(()=>resolve(false),1500))])).toBe(true);
  });

  it('recovers a stale executing seat terminally and never re-sends it to the provider', async () => {
    const { userId, project } = await seedProject();
    const executor = new FakeExecutor(new Map());
    const council = service(executor);
    const created = await council.createBlindRun({ id:'run-stale-executing-no-resend', organisationId:'org-001',
      projectId:project.id, actorUserId:userId, source, evidence, invariantIds:['runner-local-auth'], reviewers:[
        {id:'assignment-stale-executing',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}], now });
    const repo = new ReviewCouncilRepository(pool);
    const claimNow = new Date();
    await repo.claimCollection('org-001', created.run.id, 'stale-seat-claim', claimNow, new Date(claimNow.getTime()+5000));
    await repo.beginReviewerExecution('org-001', created.run.id, 'assignment-stale-executing', 'stale-seat-claim', claimNow);
    await pool.query('UPDATE review_runs SET collection_claim_expires_at=$3 WHERE organisation_id=$1 AND id=$2',
      ['org-001', created.run.id, new Date(Date.now()-1000)]);
    expect(await council.recoverExpiredCollectionClaim({ organisationId:'org-001', projectId:project.id,
      actorUserId:userId, reviewRunId:created.run.id, observedAt:new Date() })).toBe(true);
    expect(await repo.getReviewerAssignment('org-001', created.run.id, 'assignment-stale-executing'))
      .toMatchObject({ status:'availability_failure', availabilityReason:'executor_failure' });
    await council.collectBlindReviews({ organisationId:'org-001', projectId:project.id, actorUserId:userId,
      reviewRunId:created.run.id, maxMemoryItems:10, maxMemoryBytes:10_000 });
    expect(executor.calls).toHaveLength(0);
  });

  it('records executor faults distinctly from malformed reviewer output', async () => {
    const { userId, project } = await seedProject();
    const council = service({ async review() { throw new Error('provider socket reset'); } });
    const created = await council.createBlindRun({
      id: 'run-executor-failure', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-executor-failure', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now,
    });
    const [result] = await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    expect(result?.outcome).toEqual({ status: 'availability_failure', reason: 'executor_failure' });
    expect((await new ReviewCouncilRepository(pool).getReviewerAssignment(
      'org-001', created.run.id, 'assignment-executor-failure'))?.availabilityReason).toBe('executor_failure');
  });

  it('passes a bounded cancellation signal and classifies service deadline expiry as timeout', async () => {
    const { userId, project } = await seedProject();
    let seenSignal: AbortSignal | undefined;
    const council = service({ async review(input) {
      seenSignal = (input as any).signal;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { outcome: { kind: 'completed', content: 'late' }, findings: [] };
    } }, { reviewExecutionTimeoutMs: 20 });
    const created = await council.createBlindRun({ id: 'run-deadline', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-deadline', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now });
    const [result] = await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(result?.outcome).toEqual({ status: 'availability_failure', reason: 'timeout' });
  });

  it('does not start queued reviewer provider calls after the run is invalidated', async () => {
    const { userId, project } = await seedProject();
    let calls = 0; let entered = 0; let release!: () => void; let fourEntered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { fourEntered = resolve; });
    const council = service({ async review() {
      calls += 1; entered += 1; if (entered === 4) fourEntered();
      await barrier; return { outcome: { kind: 'completed', content: 'done' }, findings: [] };
    } });
    const reviewers = Array.from({ length: 6 }, (_, i) => ({
      id: 'assignment-queued-' + i, role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1',
    }));
    const created = await council.createBlindRun({ id: 'run-invalidate-queued', organisationId: 'org-001',
      projectId: project.id, actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'], reviewers, now });
    const collecting = council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 })
      .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
    await started;
    await council.invalidateRunForSource({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, replacementSource: source + '\nchanged', now: new Date(now.getTime() + 1) });
    release(); const result = await collecting;
    expect(result.ok).toBe(false); expect(calls).toBe(4);
  });

  it('caps council seat count before persistence', async () => {
    const { userId, project } = await seedProject();
    const reviewers = Array.from({ length: 17 }, (_, index) => ({
      id: `assignment-cap-${String(index).padStart(2,'0')}`, role: 'general',
      routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1',
    }));
    await expect(service(new FakeExecutor(new Map())).createBlindRun({
      id: 'run-seat-cap', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'], reviewers, now,
    })).rejects.toThrow(/reviewer|seat|16|limit/i);
    expect(await new ReviewCouncilRepository(pool).getRun('org-001','run-seat-cap')).toBeNull();
  });

  it('does not terminally burn a reviewer seat while waiting for capacity held by another run', async () => {
    const { userId, project } = await seedProject();
    const calls: string[] = [];
    const council = service({ async review(input) {
      calls.push(input.assignment.id);
      if (input.assignment.id.startsWith('assignment-capacity-hold-')) {
        return new Promise<ReviewExecutionResult>(() => {});
      }
      return { outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [] };
    } }, { reviewExecutionTimeoutMs: 20 });
    const holding = await council.createBlindRun({
      id: 'run-capacity-holder', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: Array.from({ length: 4 }, (_, index) => ({
        id: `assignment-capacity-hold-${index}`, role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1',
      })), now,
    });
    await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: holding.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    const waiting = await council.createBlindRun({
      id: 'run-capacity-waiter', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-capacity-waiter', role: 'general', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' }], now,
    });
    await expect(council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: waiting.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 })).rejects.toThrow(/capacity|busy/i);
    expect(await new ReviewCouncilRepository(pool).getReviewerAssignment(
      'org-001', waiting.run.id, 'assignment-capacity-waiter')).toMatchObject({ status: 'assigned' });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', waiting.run.id))?.status).toBe('collecting');
    expect(calls).not.toContain('assignment-capacity-waiter');
  });

  it('caps pending review execution waiters instead of growing an unbounded queue', async () => {
    const council = service(new FakeExecutor(new Map()), { reviewExecutionTimeoutMs: 5_000 });
    const permits = council as unknown as { acquireReviewExecutionPermit(): Promise<(() => void) | null> };
    const active = await Promise.all(Array.from({ length: 4 }, () => permits.acquireReviewExecutionPermit()));
    const queued = Array.from({ length: 4 }, () => permits.acquireReviewExecutionPermit());
    const overflow = permits.acquireReviewExecutionPermit();
    try {
      const state = await Promise.race([
        overflow.then((release) => release === null ? 'rejected' : 'acquired'),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
      ]);
      expect(state).toBe('rejected');
    } finally {
      active.forEach((release) => release?.());
      const queuedReleases = await Promise.all(queued);
      queuedReleases.forEach((release) => release?.());
      const overflowRelease = await overflow;
      overflowRelease?.();
    }
  });

  it('bounds simultaneous reviewer executions even inside one claimed run', async () => {
    const { userId, project } = await seedProject();
    let active=0, maxActive=0;
    const executor: ReviewCouncilExecutor = { async review() {
      active+=1; maxActive=Math.max(maxActive,active);
      await new Promise((resolve)=>setTimeout(resolve,50)); active-=1;
      return { outcome:{kind:'completed',content:'NO FINDINGS'}, findings:[] };
    }};
    const council=service(executor);
    const reviewers=Array.from({length:6},(_,index)=>({id:`assignment-bound-${index}`,role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}));
    const created=await council.createBlindRun({id:'run-bounded-fanout',organisationId:'org-001',projectId:project.id,actorUserId:userId,source,evidence,invariantIds:['runner-local-auth'],reviewers,now});
    await council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000});
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('keeps timed-out provider executions inside the four-call bulkhead until they actually settle', async () => {
    const { userId, project } = await seedProject();
    let active = 0;
    let maxActive = 0;
    const council = service({ async review() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      active -= 1;
      return { outcome: { kind: 'completed', content: 'late result' }, findings: [] };
    } }, { reviewExecutionTimeoutMs: 20 });
    const reviewers = Array.from({ length: 6 }, (_, index) => ({
      id: `assignment-timeout-bound-${index}`, role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1',
    }));
    const created = await council.createBlindRun({ id: 'run-timeout-bulkhead', organisationId: 'org-001',
      projectId: project.id, actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'], reviewers, now });

    await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('classifies runtime-invalid reviewer outcomes and finding drafts as malformed availability failures', async () => {
    const { userId, project } = await seedProject();
    const results = new Map<string, ReviewExecutionResult>([
      ['assignment-invalid-outcome', {
        outcome: { kind: 'completed', content: 123 }, findings: [],
      } as unknown as ReviewExecutionResult],
      ['assignment-invalid-finding', {
        outcome: { kind: 'completed', content: 'A malformed structured finding follows.' },
        findings: [{ severity: 'invalid', category: '', summary: '', evidenceReferences: [] }],
      } as unknown as ReviewExecutionResult],
      ['assignment-unknown-kind', {
        outcome: { kind: 'unexpected_runtime_state', content: 'Looks like content but kind is unknown.' }, findings: [],
      } as unknown as ReviewExecutionResult],
      ['assignment-oversized-summary', {
        outcome: { kind: 'completed', content: 'Oversized summary follows.' },
        findings: [{ severity: 'important', category: 'correctness', summary: 'x'.repeat(16_385), evidenceReferences: [] }],
      } as unknown as ReviewExecutionResult],
      ['assignment-too-many-refs', {
        outcome: { kind: 'completed', content: 'Too many evidence references follow.' },
        findings: [{ severity: 'important', category: 'correctness', summary: 'bounded', evidenceReferences: Array.from({ length: 65 }, (_, i) => `ref-${i}`) }],
      } as unknown as ReviewExecutionResult],
      ['assignment-too-many-findings', {
        outcome: { kind: 'completed', content: 'Unbounded finding set follows.' },
        findings: Array.from({ length: 33 }, (_, i) => ({ severity: 'important' as const, category: 'correctness', summary: `Finding ${i}`, evidenceReferences: [`ref-${i}`] })),
      }],
    ]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-runtime-malformed', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-invalid-outcome', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-invalid-finding', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
        { id: 'assignment-unknown-kind', role: 'database', routeId: 'route-c', modelId: 'model-c', modelVersion: 'v1' },
        { id: 'assignment-oversized-summary', role: 'architecture', routeId: 'route-d', modelId: 'model-d', modelVersion: 'v1' },
        { id: 'assignment-too-many-refs', role: 'correctness', routeId: 'route-e', modelId: 'model-e', modelVersion: 'v1' },
        { id: 'assignment-too-many-findings', role: 'general', routeId: 'route-f', modelId: 'model-f', modelVersion: 'v1' },
      ], now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    expect(collected.map((entry) => [entry.assignment.id, entry.outcome])).toEqual([
      ['assignment-invalid-finding', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-invalid-outcome', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-oversized-summary', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-too-many-findings', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-too-many-refs', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-unknown-kind', { status: 'availability_failure', reason: 'malformed_output' }],
    ]);
    expect(await new ReviewCouncilRepository(pool).listFindings('org-001', created.run.id)).toEqual([]);
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
  });

  it('does not persist reviewer completion or findings after the run is invalidated in flight', async () => {
    const { userId, project } = await seedProject();
    let reviewRunId = '';
    const repository = new ReviewCouncilRepository(pool);
    const executor: ReviewCouncilExecutor = {
      async review() {
        await repository.invalidateRunForSource(
          'org-001', reviewRunId, digestReviewMaterial(source + '\nchanged-in-flight:true'),
          new Date(now.getTime() + 1),
        );
        return {
          outcome: { kind: 'completed', content: 'Finding from stale execution.' },
          findings: [{
            severity: 'important', category: 'correctness', summary: 'Must not persist after invalidation',
            evidenceReferences: ['src/a.ts:1-2'],
          }],
        };
      },
    };
    const council = service(executor);
    const created = await council.createBlindRun({
      id: 'run-in-flight-invalidated', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-in-flight', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    reviewRunId = created.run.id;

    await expect(council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId,
      source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000,
    })).rejects.toThrow(/invalidated|collecting/i);
    const assignments = await repository.listReviewerAssignments('org-001', reviewRunId);
    expect(assignments[0]).toMatchObject({ status: 'availability_failure', availabilityReason: 'executor_failure' });
    expect(await repository.listFindings('org-001', reviewRunId)).toEqual([]);
    expect((await repository.getRun('org-001', reviewRunId))?.status).toBe('invalidated');
  });

  it('single-flights concurrent blind collection so each assignment executes once', async () => {
    const { userId, project } = await seedProject();
    let calls = 0;
    let release!: () => void;
    let firstEntered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    const executor: ReviewCouncilExecutor = { async review() {
      calls += 1;
      if (calls === 1) firstEntered();
      await barrier;
      return { outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [] };
    }};
    const council = service(executor);
    const created = await council.createBlindRun({
      id: 'run-single-flight', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-single-flight', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now,
    });
    const collect = () => council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, source, evidence,
      invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    const first = collect().then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
    await entered;
    const second = collect().then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(calls).toBe(1);
    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
  });

  it('does not disguise an internal normalizer fault as malformed reviewer output', async () => {
    const { userId, project } = await seedProject();
    const poisoned = { outcome: { kind: 'completed', content: 'valid content' } } as unknown as ReviewExecutionResult;
    Object.defineProperty(poisoned, 'findings', { get() { throw new Error('normalizer internal fault'); } });
    const council = service({ async review() { return poisoned; } });
    const created = await council.createBlindRun({
      id: 'run-normalizer-fault', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'], reviewers: [
        { id: 'assignment-normalizer-fault', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    await expect(council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000 })).rejects.toThrow('normalizer internal fault');
    const [assignment] = await new ReviewCouncilRepository(pool).listReviewerAssignments('org-001', created.run.id);
    expect(assignment).toMatchObject({ status: 'availability_failure', availabilityReason: 'executor_failure' });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('collecting');
  });

  it('preserves the original collection failure when claim cleanup also fails', async () => {
    const { userId, project } = await seedProject();
    const poisoned = { outcome: { kind: 'completed', content: 'valid content' } } as unknown as ReviewExecutionResult;
    Object.defineProperty(poisoned, 'findings', { get() { throw new Error('primary collection failure'); } });
    const council = service({ async review() { return poisoned; } });
    const repository = (council as any).dependencies.reviewCouncil as ReviewCouncilRepository;
    repository.releaseCollectionClaim = async () => { throw new Error('claim cleanup failure'); };
    const created = await council.createBlindRun({
      id: 'run-cleanup-failure', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'], reviewers: [
        { id: 'assignment-cleanup-failure', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });

    await expect(council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 }))
      .rejects.toThrow(/primary collection failure/i);
  });

  it('records timeout, empty, and malformed reviewer results only as availability failures', async () => {
    const { userId, project } = await seedProject();
    const results = new Map<string, ReviewExecutionResult>([
      ['assignment-timeout', { outcome: { kind: 'timeout' }, findings: [] }],
      ['assignment-empty', { outcome: { kind: 'completed', content: '   ' }, findings: [] }],
      ['assignment-malformed', { outcome: { kind: 'malformed', detail: 'bad json' }, findings: [] }],
    ]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-availability', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-timeout', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-empty', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
        { id: 'assignment-malformed', role: 'database', routeId: 'route-c', modelId: 'model-c', modelVersion: 'v1' },
      ],
      now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    expect(collected.map((entry) => [entry.assignment.id, entry.outcome])).toEqual([
      ['assignment-empty', { status: 'availability_failure', reason: 'empty_output' }],
      ['assignment-malformed', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-timeout', { status: 'availability_failure', reason: 'timeout' }],
    ]);
    const stored = await new ReviewCouncilRepository(pool).listReviewerAssignments('org-001', created.run.id);
    expect(stored.every((assignment) => assignment.status === 'availability_failure')).toBe(true);
    expect(await new ReviewCouncilRepository(pool).listFindings('org-001', created.run.id)).toEqual([]);
    expect(await council.evaluateGate({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
    })).toEqual({
      status: 'insufficient_evidence', blockingFindingIds: [],
      assignedReviewers: 3, completedReviewers: 0, requiredCompletedReviewers: 2,
    });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
  });
});

describe('ReviewCouncilService adjudication and acceptance', () => {
  it('does not let an engineer adjudicate findings or accept the review gate', async () => {
    const { userId, project } = await seedProject('reviewer');
    const council = service(new FakeExecutor(new Map([['assignment-role', {
      outcome: { kind: 'completed', content: 'Material finding.' },
      findings: [{ severity: 'important', category: 'security', summary: 'Independent review required', evidenceReferences: ['src/a.ts:1-2'] }],
    }]])));
    const created = await council.createBlindRun({
      id: 'run-role-authority', organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      source, evidence, invariantIds: ['runner-local-auth'], reviewers: [
        { id: 'assignment-role', role: 'security', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    const [finding] = await new ReviewCouncilRepository(pool).listFindings('org-001', created.run.id);
    await new MembershipRepository(pool).grantProject({ organisationId: 'org-001', projectId: project.id, userId, role: 'engineer', createdBy: 'bootstrap', now: new Date(now.getTime()+1) });
    await expect(council.adjudicateFinding({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding!.id, status: 'REJECTED', rationale: 'Self-certified', evidenceReferences: ['src/a.ts:1-2'], now })).rejects.toThrow('forbidden');
    await expect(council.evaluateGate({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id })).rejects.toThrow('forbidden');
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
  });
  it('rejects adjudication while a run is still collecting even if a finding row already exists', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map()));
    const created = await council.createBlindRun({
      id: 'run-premature-adjudication', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-premature', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    const finding = createReviewFinding({
      id: 'finding-premature', reviewRunId: created.run.id, reviewerAssignmentId: 'assignment-premature',
      severity: 'important', category: 'correctness', summary: 'Premature finding',
      evidenceReferences: ['src/a.ts:1-2'], createdAt: now,
    });
    await new ReviewCouncilRepository(pool).createFinding('org-001', finding);

    await expect(council.adjudicateFinding({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id, status: 'REJECTED',
      rationale: 'Should not be reachable while collecting.', evidenceReferences: ['src/a.ts:1-2'], now,
    })).rejects.toThrow(/collecting|adjudicating/i);
    expect(await new ReviewCouncilRepository(pool).listAdjudications('org-001', created.run.id)).toEqual([]);
  });

  it('does not allow a later adjudication to clear an already confirmed material finding', async () => {
    const { userId, project } = await seedProject('reviewer');
    const council = service(new FakeExecutor(new Map([['assignment-terminal', {
      outcome: { kind: 'completed', content: 'material' },
      findings: [{ severity: 'important', category: 'security', summary: 'terminal blocker', evidenceReferences: ['src/a.ts:1'] }],
    }]])));
    const created = await council.createBlindRun({ id: 'run-terminal-adjudication', organisationId: 'org-001',
      projectId: project.id, actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [{ id: 'assignment-terminal', role: 'security', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' }], now });
    await council.collectBlindReviews({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, maxMemoryItems: 10, maxMemoryBytes: 10_000 });
    const [finding] = await new ReviewCouncilRepository(pool).listFindings('org-001', created.run.id);
    await council.adjudicateFinding({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding!.id, status: 'CONFIRMED', rationale: 'confirmed with evidence',
      evidenceReferences: ['src/a.ts:1'], now });
    await expect(council.adjudicateFinding({ organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding!.id, status: 'REJECTED', rationale: 'later downgrade',
      evidenceReferences: ['src/a.ts:1'], now: new Date(now.getTime() + 1) })).rejects.toThrow(/terminal|confirmed|adjudicat/i);
    expect((await council.evaluateGate({ organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, reviewRunId: created.run.id })).status).toBe('blocked');
  });

  it('requires review authority to invalidate accepted review state', async () => {
    const { userId, project } = await seedProject('reviewer'); const council=service(new FakeExecutor(new Map()));
    const created=await council.createBlindRun({id:'run-invalidate-role',organisationId:'org-001',projectId:project.id,actorUserId:userId,source,evidence,invariantIds:['runner-local-auth'],reviewers:[{id:'assignment-invalidate-role',role:'general',routeId:'route-a',modelId:'model-a',modelVersion:'v1'}],now});
    await council.collectBlindReviews({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id,maxMemoryItems:10,maxMemoryBytes:10_000});
    expect((await council.evaluateGate({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id})).status).toBe('clear');
    await new MembershipRepository(pool).grantProject({organisationId:'org-001',projectId:project.id,userId,role:'engineer',createdBy:'bootstrap',now:new Date(now.getTime()+1)});
    await expect(council.invalidateRunForSource({organisationId:'org-001',projectId:project.id,actorUserId:userId,reviewRunId:created.run.id,replacementSource:source+'\nforged',now:new Date(now.getTime()+2)})).rejects.toThrow('forbidden');
    expect((await new ReviewCouncilRepository(pool).getRun('org-001',created.run.id))?.status).toBe('accepted');
  });

  it('rejects adjudication, rechallenge, and gate evaluation after source invalidation', async () => {
    const { userId, project } = await seedProject();
    const results = new Map<string, ReviewExecutionResult>([[
      'assignment-stale', {
        outcome: { kind: 'completed', content: 'One disputed finding.' },
        findings: [{ severity: 'important', category: 'correctness', summary: 'Stale finding', evidenceReferences: ['src/a.ts:3-4'] }],
      },
    ]]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-stale-lifecycle', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-stale', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    const finding = collected[0]!.findings[0]!;
    await council.adjudicateFinding({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id, status: 'REJECTED',
      rationale: 'Initial adjudication before source change.', evidenceReferences: ['src/a.ts:3-4'], now,
    });
    await council.invalidateRunForSource({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      replacementSource: source + '\nchanged:true', now: new Date(now.getTime() + 1),
    });

    await expect(council.adjudicateFinding({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id, status: 'CONFIRMED',
      rationale: 'Stale adjudication must fail.', evidenceReferences: ['src/a.ts:3-4'], now: new Date(now.getTime() + 2),
    })).rejects.toThrow(/invalidated|adjudicating/i);
    await expect(council.createPrivateRechallenge({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      findingId: finding.id, prompt: 'Stale rechallenge must fail.', now: new Date(now.getTime() + 3),
    })).rejects.toThrow(/invalidated|adjudicating/i);
    await expect(council.evaluateGate({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
    })).rejects.toThrow(/invalidated|adjudicating/i);
  });

  it('accepts a clean council with a strict majority completed while one reviewer is unavailable', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map([
      ['assignment-d', { outcome: { kind: 'timeout' }, findings: [] }],
    ])));
    const created = await council.createBlindRun({
      id: 'run-clean-majority', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-a', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-b', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
        { id: 'assignment-c', role: 'database', routeId: 'route-c', modelId: 'model-c', modelVersion: 'v1' },
        { id: 'assignment-d', role: 'architecture', routeId: 'route-d', modelId: 'model-d', modelVersion: 'v1' },
      ], now,
    });
    await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    expect(await council.evaluateGate({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
    })).toEqual({ status: 'clear', blockingFindingIds: [] });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('accepted');
  });

  it('blocks acceptance on one independently confirmed Important finding even when another reviewer has no findings', async () => {
    const { userId, project } = await seedProject();
    const results = new Map<string, ReviewExecutionResult>([
      ['assignment-a', {
        outcome: { kind: 'completed', content: 'Found a material correctness defect.' },
        findings: [{
          severity: 'important', category: 'correctness', summary: 'Material defect',
          evidenceReferences: ['src/a.ts:1-5'],
        }],
      }],
      ['assignment-b', { outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [] }],
    ]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-blocking', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-a', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-b', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
      ], now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    const finding = collected.flatMap((entry) => entry.findings)[0]!;
    const adjudication = await council.adjudicateFinding({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id, status: 'CONFIRMED',
      rationale: 'Exact source and test evidence confirm the defect.',
      evidenceReferences: ['src/a.ts:1-5'], now: new Date(now.getTime() + 1000),
    });
    expect(adjudication.status).toBe('CONFIRMED');
    const gate = await council.evaluateGate({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id,
    });
    expect(gate).toEqual({ status: 'blocked', blockingFindingIds: [finding.id] });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('blocked');
  });

  it('creates a private rechallenge only for the reviewer that originally raised the rejected finding', async () => {
    const { userId, project } = await seedProject();
    const results = new Map<string, ReviewExecutionResult>([
      ['assignment-a', {
        outcome: { kind: 'completed', content: 'One disputed finding.' },
        findings: [{
          severity: 'important', category: 'architecture', summary: 'Disputed architecture claim',
          evidenceReferences: ['src/a.ts:10-20'],
        }],
      }],
      ['assignment-b', { outcome: { kind: 'completed', content: 'NO FINDINGS' }, findings: [] }],
    ]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-rechallenge', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-a', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-b', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
      ], now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    const finding = collected.flatMap((entry) => entry.findings)[0]!;
    await council.adjudicateFinding({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id, status: 'REJECTED',
      rationale: 'The canonical source disproves the reviewer claim.',
      evidenceReferences: ['src/a.ts:10-20'], now: new Date(now.getTime() + 1000),
    });
    const privateChallenge = await council.createPrivateRechallenge({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: created.run.id, findingId: finding.id,
      prompt: 'Please reconsider against the attached canonical evidence.',
      now: new Date(now.getTime() + 2000),
    });
    expect(privateChallenge.assignment.id).toBe('assignment-a');
    expect(privateChallenge.assignment.id).not.toBe('assignment-b');
    expect(privateChallenge.rechallenge.visibility).toBe('private_original_reviewer');
    expect(privateChallenge.rechallenge.reviewerAssignmentId).toBe('assignment-a');
  });
});

describe('ReviewCouncilService fresh-source and calibration semantics', () => {
  it('invalidates the old acceptance context after source changes and requires a fresh run/packet', async () => {
    const { userId, project } = await seedProject();
    const council = service(new FakeExecutor(new Map()));
    const oldRun = await council.createBlindRun({
      id: 'run-old-source', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-old', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now,
    });
    const replacementSource = `${source}\nmaterial-change:true`;
    const invalidated = await council.invalidateRunForSource({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: oldRun.run.id, replacementSource,
      now: new Date(now.getTime() + 1000),
    });
    expect(invalidated.status).toBe('invalidated');

    await expect(council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId,
      reviewRunId: oldRun.run.id, source, evidence, invariantIds: ['runner-local-auth'],
      maxMemoryItems: 10, maxMemoryBytes: 10_000,
    })).rejects.toThrow(/invalidated|collecting/i);

    const fresh = await council.createBlindRun({
      id: 'run-fresh-source', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source: replacementSource, evidence,
      invariantIds: ['runner-local-auth'], reviewers: [
        { id: 'assignment-fresh', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
      ], now: new Date(now.getTime() + 2000),
    });
    expect(fresh.run.sourceDigest).not.toBe(oldRun.run.sourceDigest);
    expect(fresh.run.packetDigest).not.toBe(oldRun.run.packetDigest);
  });

  it('aggregates calibration as route evidence without creating a permanent role binding', async () => {
    const { userId, project } = await seedProject();
    const repository = new ReviewCouncilRepository(pool);
    await repository.createCalibrationSnapshot({
      id: 'calibration-a', organisationId: 'org-001', routeId: 'route-a',
      modelId: 'model-a', modelVersion: 'v1', sampleSize: 10,
      usefulFindingRate: 0.4, falsePositiveRate: 0.1, availabilityRate: 0.9,
      medianLatencyMs: 1000, averageCostUsd: 0.1, createdAt: now,
    });
    await repository.createCalibrationSnapshot({
      id: 'calibration-b', organisationId: 'org-001', routeId: 'route-a',
      modelId: 'model-a', modelVersion: 'v2', sampleSize: 30,
      usefulFindingRate: 0.6, falsePositiveRate: 0.2, availabilityRate: 1,
      medianLatencyMs: 3000, averageCostUsd: 0.3, createdAt: new Date(now.getTime() + 1),
    });
    const council = service(new FakeExecutor(new Map()));
    const calibration = await council.getCalibrationEvidence({
      organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, routeId: 'route-a',
    });
    expect(calibration).toEqual({
      routeId: 'route-a', sampleSize: 40,
      usefulFindingRate: 0.55, falsePositiveRate: 0.175,
      availabilityRate: 0.975, medianLatencyMs: 2500, averageCostUsd: 0.25,
      models: [
        { modelId: 'model-a', modelVersion: 'v1' },
        { modelId: 'model-a', modelVersion: 'v2' },
      ],
    });
    expect(Object.prototype.hasOwnProperty.call(calibration, 'role')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(calibration, 'permanentRole')).toBe(false);
  });
});
