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

async function seedProject() {
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
    role: 'reviewer', createdBy: userId, now,
  });
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

function service(executor: ReviewCouncilExecutor) {
  return new ReviewCouncilService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    memberships: new MembershipRepository(pool),
    users: new UserRepository(pool),
    reviewCouncil: new ReviewCouncilRepository(pool),
    collaborativeMemory: new CollaborativeMemoryRepository(pool),
    executor,
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
      scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
      title: 'Shared architecture', content: 'Runner auth remains local.', createdBy: userId,
      sourceType: 'human', createdAt: now,
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
    expect(callA.memory.excluded.some((item) => 'memoryId' in item && item.memoryId === 'mem_20260817_assignment-b')).toBe(false);
    expect(callB.memory.excluded.some((item) => 'memoryId' in item && item.memoryId === 'mem_20260817_assignment-a')).toBe(false);
    expect(callA.assignment).toMatchObject({ routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' });
    expect(callB.assignment).toMatchObject({ routeId: 'route-b', modelId: 'model-b', modelVersion: 'v2' });
    expect((await new ReviewCouncilRepository(pool).getRun('org-001', created.run.id))?.status).toBe('adjudicating');
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
    ]);
    const council = service(new FakeExecutor(results));
    const created = await council.createBlindRun({
      id: 'run-runtime-malformed', organisationId: 'org-001', projectId: project.id,
      actorUserId: userId, source, evidence, invariantIds: ['runner-local-auth'],
      reviewers: [
        { id: 'assignment-invalid-outcome', role: 'general', routeId: 'route-a', modelId: 'model-a', modelVersion: 'v1' },
        { id: 'assignment-invalid-finding', role: 'security', routeId: 'route-b', modelId: 'model-b', modelVersion: 'v1' },
        { id: 'assignment-unknown-kind', role: 'database', routeId: 'route-c', modelId: 'model-c', modelVersion: 'v1' },
      ], now,
    });
    const collected = await council.collectBlindReviews({
      organisationId: 'org-001', projectId: project.id, actorUserId: userId, reviewRunId: created.run.id,
      source, evidence, invariantIds: ['runner-local-auth'], maxMemoryItems: 10, maxMemoryBytes: 10_000,
    });
    expect(collected.map((entry) => [entry.assignment.id, entry.outcome])).toEqual([
      ['assignment-invalid-finding', { status: 'availability_failure', reason: 'malformed_output' }],
      ['assignment-invalid-outcome', { status: 'availability_failure', reason: 'malformed_output' }],
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
    expect(assignments[0]?.status).toBe('assigned');
    expect(await repository.listFindings('org-001', reviewRunId)).toEqual([]);
    expect((await repository.getRun('org-001', reviewRunId))?.status).toBe('invalidated');
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
