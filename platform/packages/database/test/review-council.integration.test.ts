import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createArchitectureInvariant,
  createCalibrationSnapshot,
  createAuditEvent,
  createFindingAdjudication,
  createReviewFinding,
  createReviewRun,
  createReviewerRechallenge,
  digestReviewMaterial
} from '@engineering-os/domain';
import {
  DatabaseUnitOfWork,
  ProjectRepository,
  ReviewCouncilRepository,
  UserRepository
} from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

afterAll(async () => closeDatabase());
beforeEach(async () => resetDatabase());

const now = new Date('2026-08-16T20:00:00.000Z');
const sourceDigest = digestReviewMaterial('source-v1');
const evidenceDigest = digestReviewMaterial('evidence-v1');
async function seedProject(organisationId = 'org-001') {
  const userId = randomUUID();
  await new UserRepository(pool).create({
    id: userId,
    userId: `review.${userId.slice(0, 8)}`,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'admin', 'active', 'bootstrap', $3, $3)`,
    [organisationId, userId, now]
  );
  const projectId = randomUUID();
  await new ProjectRepository(pool).create({
    id: projectId,
    organisationId,
    name: 'Review Council Project',
    stage: 'implementation',
    preferredProductPartner: 'auto',
    createdBy: userId,
    createdAt: now,
    updatedAt: now
  });
  return { organisationId, userId, projectId };
}
function makeRun(project: Awaited<ReturnType<typeof seedProject>>) {
  return createReviewRun({
    id: 'review-run-1',
    organisationId: project.organisationId,
    projectId: project.projectId,
    sourceDigest,
    evidenceDigest,
    invariantIds: ['runner-local-auth'],
    createdBy: project.userId,
    createdAt: now
  });
}

describe('ReviewCouncilRepository preflight bounds', () => {
  it('rejects overlong reviewer modelVersion before any database query', async () => {
    let queryCount = 0;
    const database = {
      async query() {
        queryCount += 1;
        throw new Error('database should not be reached');
      },
    } as unknown as ConstructorParameters<typeof ReviewCouncilRepository>[0];
    const repo = new ReviewCouncilRepository(database);
    await expect(repo.createReviewerAssignment({
      id: 'assignment-bounds', organisationId: 'org-001', reviewRunId: 'run-bounds',
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'x'.repeat(257),
      packetDigest: digestReviewMaterial('packet-bounds'), createdAt: now,
    })).rejects.toThrow(/modelVersion/i);
    expect(queryCount).toBe(0);
  });
});

describe('review council migration schema', () => {
  it('applies migration 010 and creates only bounded review-governance surfaces', async () => {
    const migrations = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
    expect(migrations.rows.map((row) => row.name)).toContain('010_review_council.sql');
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('review_runs','review_reviewer_assignments','review_findings',
         'review_finding_adjudications','review_rechallenges','review_calibration_snapshots',
         'review_architecture_invariants')`
    );
    for (const forbidden of ['api_key','access_token','refresh_token','password','cookie','private_key','secret']) {
      expect(columns.rows.map((row) => row.column_name)).not.toContain(forbidden);
    }
  });
});
describe('ReviewCouncilRepository', () => {
  it('persists and scopes a review run by organisation', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    expect(await repo.getRun(project.organisationId, run.id)).toMatchObject({
      id: run.id,
      projectId: project.projectId,
      sourceDigest,
      evidenceDigest,
      packetDigest: run.packetDigest,
      status: 'collecting'
    });
    expect(await repo.getRun('org-other', run.id)).toBeNull();
  });

  it('records reviewer assignment with the exact blind packet and resolved route identity', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    const assignment = await repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'security', routeId: 'openrouter-grok', modelId: 'grok-4.6',
      modelVersion: '2026-08-16', packetDigest: run.packetDigest, createdAt: now
    });
    expect(assignment.packetDigest).toBe(run.packetDigest);
    expect(assignment.status).toBe('assigned');
  });
  it('fails closed when an assignment claims a packet digest other than the run packet', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await expect(repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: digestReviewMaterial('different-packet'), createdAt: now
    })).rejects.toThrow(/packet/i);
  });

  it('durably distinguishes completed reviewer output from availability failure', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now
    });
    const failed = await repo.recordReviewerAvailabilityFailure(
      project.organisationId, 'assignment-1', 'empty_output', new Date(now.getTime() + 1000)
    );
    expect(failed).toMatchObject({ status: 'availability_failure', availabilityReason: 'empty_output' });
    expect(failed.contentDigest).toBeUndefined();
  });
  it('records completed reviewer output by digest without storing raw reviewer content', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'security', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now
    });
    const contentDigest = digestReviewMaterial('NO FINDINGS');
    const completed = await repo.recordReviewerCompleted(
      project.organisationId, 'assignment-1', contentDigest, new Date(now.getTime() + 1000)
    );
    expect(completed).toMatchObject({ status: 'completed', contentDigest });
    expect(completed.availabilityReason).toBeUndefined();

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'review_reviewer_assignments'`
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('content');
    expect(columns.rows.map((row) => row.column_name)).not.toContain('raw_output');
  });
  it('persists findings, evidence-backed adjudications, and private original-reviewer rechallenges', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now
    });
    const finding = createReviewFinding({
      id: 'finding-1', reviewRunId: run.id, reviewerAssignmentId: 'assignment-1',
      severity: 'important', category: 'correctness', summary: 'Material issue',
      evidenceReferences: ['src/a.ts:10-20'], createdAt: new Date(now.getTime() + 1000)
    });
    await repo.createFinding(project.organisationId, finding);
    const adjudication = createFindingAdjudication({
      id: 'adjudication-1', findingId: finding.id, reviewRunId: run.id,
      status: 'REJECTED', rationale: 'Exact source disproves the claim',
      evidenceReferences: ['src/a.ts:10-20'], adjudicatedBy: project.userId,
      createdAt: new Date(now.getTime() + 2000)
    });
    await repo.createAdjudication(project.organisationId, adjudication);
    const rechallenge = createReviewerRechallenge({
      id: 'rechallenge-1', reviewRunId: run.id, findingId: finding.id,
      reviewerAssignmentId: 'assignment-1', adjudicationStatus: adjudication.status,
      promptDigest: digestReviewMaterial('private rechallenge'),
      createdAt: new Date(now.getTime() + 3000)
    });
    await repo.createRechallenge(project.organisationId, rechallenge);

    expect(await repo.listFindings(project.organisationId, run.id)).toEqual([finding]);
    expect(await repo.listAdjudications(project.organisationId, run.id)).toEqual([adjudication]);
    expect(await repo.listRechallenges(project.organisationId, run.id)).toEqual([rechallenge]);
  });

  it('rejects a rechallenge aimed at a different reviewer assignment than the original finding', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await repo.createReviewerAssignment({
      id: 'assignment-1', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now
    });
    await repo.createReviewerAssignment({
      id: 'assignment-2', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'security', routeId: 'route-2', modelId: 'model-2', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now
    });
    const finding = createReviewFinding({
      id: 'finding-1', reviewRunId: run.id, reviewerAssignmentId: 'assignment-1',
      severity: 'important', category: 'correctness', summary: 'Material issue',
      evidenceReferences: ['src/a.ts:10-20'], createdAt: new Date(now.getTime() + 1000)
    });
    await repo.createFinding(project.organisationId, finding);
    const adjudication = createFindingAdjudication({
      id: 'adjudication-1', findingId: finding.id, reviewRunId: run.id,
      status: 'REJECTED', rationale: 'Rejected with evidence', evidenceReferences: ['src/a.ts:10-20'],
      adjudicatedBy: project.userId, createdAt: new Date(now.getTime() + 2000)
    });
    await repo.createAdjudication(project.organisationId, adjudication);
    const rechallenge = createReviewerRechallenge({
      id: 'rechallenge-1', reviewRunId: run.id, findingId: finding.id,
      reviewerAssignmentId: 'assignment-2', adjudicationStatus: adjudication.status,
      promptDigest: digestReviewMaterial('private rechallenge'), createdAt: new Date(now.getTime() + 3000)
    });
    await expect(repo.createRechallenge(project.organisationId, rechallenge)).rejects.toThrow(/original reviewer/i);
  });
  it('persists calibration evidence and architecture invariants without model-role binding', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const snapshot = createCalibrationSnapshot({
      id: 'calibration-1', organisationId: project.organisationId,
      routeId: 'openrouter-grok', modelId: 'grok-4.6', modelVersion: '2026-08-16',
      sampleSize: 12, usefulFindingRate: 0.5, falsePositiveRate: 0.08,
      availabilityRate: 0.92, medianLatencyMs: 8200, averageCostUsd: 0.14, createdAt: now
    });
    const invariant = createArchitectureInvariant({
      id: 'invariant-1', key: 'runner-local-auth',
      description: 'Provider login material remains runner-local', severity: 'critical', createdAt: now
    });
    await repo.createCalibrationSnapshot(snapshot);
    await repo.createArchitectureInvariant(invariant);
    expect(await repo.listCalibrationSnapshots(project.organisationId, snapshot.routeId)).toEqual([snapshot]);
    expect(await repo.listArchitectureInvariants()).toEqual([invariant]);

    const calibrationColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'review_calibration_snapshots'`
    );
    expect(calibrationColumns.rows.map((row) => row.column_name)).not.toContain('role');
    expect(calibrationColumns.rows.map((row) => row.column_name)).not.toContain('permanent_role');
  });
  it('persists fresh-source invalidation and refuses new assignments on an invalidated run', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    const replacementSourceDigest = digestReviewMaterial('source-v2');
    const invalidated = await repo.invalidateRunForSource(
      project.organisationId, run.id, replacementSourceDigest, new Date(now.getTime() + 1000)
    );
    expect(invalidated).toMatchObject({
      status: 'invalidated', invalidatedBySourceDigest: replacementSourceDigest,
    });
    await expect(repo.createReviewerAssignment({
      id: 'assignment-after-invalidation', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: new Date(now.getTime() + 2000),
    })).rejects.toThrow(/invalidated|collecting/i);
  });

  it('makes findings, adjudications, rechallenges, calibration, and architecture invariants append-only', async () => {
    const project = await seedProject();
    const repo = new ReviewCouncilRepository(pool);
    const run = makeRun(project);
    await repo.createRun(run);
    await repo.createReviewerAssignment({
      id: 'assignment-append', organisationId: project.organisationId, reviewRunId: run.id,
      role: 'general', routeId: 'route-1', modelId: 'model-1', modelVersion: 'v1',
      packetDigest: run.packetDigest, createdAt: now,
    });
    const finding = createReviewFinding({
      id: 'finding-append', reviewRunId: run.id, reviewerAssignmentId: 'assignment-append',
      severity: 'minor', category: 'quality', summary: 'Append only finding',
      evidenceReferences: ['src/a.ts:1'], createdAt: new Date(now.getTime() + 1),
    });
    await repo.createFinding(project.organisationId, finding);
    await expect(pool.query('UPDATE review_findings SET summary = $1 WHERE id = $2', ['tampered', finding.id]))
      .rejects.toThrow(/append|immutable/i);
    await expect(pool.query('DELETE FROM review_findings WHERE id = $1', [finding.id]))
      .rejects.toThrow(/append|immutable/i);
  });

  it('rolls back a review run and mandatory audit evidence when the transaction fails', async () => {
    const project = await seedProject();
    const run = makeRun(project);
    const audit = createAuditEvent({
      organisationId: project.organisationId, projectId: project.projectId,
      eventType: 'review.run.created', actorType: 'user', actorId: project.userId,
      subjectType: 'review_run', subjectId: run.id,
    });
    const unitOfWork = new DatabaseUnitOfWork(pool);
    await expect(unitOfWork.run(async ({ reviewCouncil, audit: auditRepo }) => {
      await reviewCouncil.createRun(run);
      await auditRepo.append(audit);
      await auditRepo.append(audit);
    })).rejects.toThrow();
    expect(await new ReviewCouncilRepository(pool).getRun(project.organisationId, run.id)).toBeNull();
    const rows = await pool.query('SELECT id FROM audit_events WHERE subject_id = $1', [run.id]);
    expect(rows.rows).toEqual([]);
  });
});
