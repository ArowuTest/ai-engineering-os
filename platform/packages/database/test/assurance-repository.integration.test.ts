import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssuranceFinding,
  createAssuranceRun,
} from '@engineering-os/domain';
import * as database from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-08-20T10:45:00.000Z');

type Repo = InstanceType<typeof database.AssuranceRepository>;

function repo(): Repo {
  return new database.AssuranceRepository(pool);
}

async function seed() {
  await pool.query(`INSERT INTO projects
    (id, organisation_id, name, created_by, created_at, stage, preferred_product_partner, updated_at)
    VALUES ($1,'org-001','Assurance Project','test',$3,'discovery','auto',$3),
           ($2,'org-002','Other Assurance','test',$3,'discovery','auto',$3)`, [projectId, otherProjectId, now]);
  await pool.query(`INSERT INTO capability_catalogue
    (id, kind, source, source_ref, display_name, maturity, governance_state,
     execution_verification, created_by, created_at, updated_at)
    VALUES ('agent.requirements_reviewer','agent','aios','requirements-reviewer',
      'Requirements Reviewer','supported','approved','verified','test',$1,$1)`, [now]);
}

function assuranceRun(id = 'assurance_run_001', digest = 'a'.repeat(64)) {
  return createAssuranceRun({
    id, organisationId: 'org-001', projectId,
    profileId: 'product_requirements_v1', targetType: 'product_requirements',
    targetDigest: digest, reviewerAgentCapabilityId: 'agent.requirements_reviewer',
    reviewerRouteId: 'anthropic-studio-api', createdBy: 'user-001', createdAt: now,
  });
}

beforeEach(async () => { await resetDatabase(); await seed(); });
afterAll(async () => closeDatabase());

describe('AssuranceRepository', () => {
  it('round-trips an exact-target run and enforces tenant/project scope', async () => {
    const run = assuranceRun();
    await repo().createRun(run);
    expect(await repo().getRun('org-001', projectId, run.id)).toEqual(run);
    expect(await repo().getRun('org-002', otherProjectId, run.id)).toBeNull();
  });

  it('persists structured findings only inside their owning run', async () => {
    const run = assuranceRun();
    await repo().createRun(run);
    const finding = createAssuranceFinding({
      id: 'assurance_finding_001', assuranceRunId: run.id,
      severity: 'important', kind: 'edge_case', category: 'payments',
      summary: 'Duplicate callback flow is undefined.',
      rationale: 'Provider retries can duplicate side effects.',
      proposedQuestion: 'What idempotency rule should callbacks use?',
      basis: 'trained_knowledge', evidenceReferences: ['conversation:12'], createdAt: now,
    });
    await repo().createFinding('org-001', projectId, finding);
    expect(await repo().listFindings('org-001', projectId, run.id)).toEqual([finding]);
    expect(await repo().listFindings('org-002', otherProjectId, run.id)).toEqual([]);
  });

  it('tracks latest run, completion and exact-target invalidation', async () => {
    const first = assuranceRun('assurance_run_001', 'a'.repeat(64));
    await repo().createRun(first);
    const completedAt = new Date(now.getTime() + 1000);
    expect((await repo().markCompleted('org-001', projectId, first.id, completedAt)).status).toBe('completed');
    const second = assuranceRun('assurance_run_002', 'b'.repeat(64));
    await repo().createRun(second);
    expect((await repo().getLatestRun('org-001', projectId, 'product_requirements_v1'))?.id).toBe(second.id);
    const invalidated = await repo().invalidateRunForTarget(
      'org-001', projectId, second.id, 'c'.repeat(64), new Date(now.getTime() + 2000));
    expect(invalidated).toMatchObject({ status: 'invalidated', invalidatedByTargetDigest: 'c'.repeat(64) });
  });

  it('persists reviewer availability failure as durable evidence', async () => {
    const run = assuranceRun('assurance_run_003');
    await repo().createRun(run);
    const failedAt = new Date(now.getTime() + 3000);
    const failed = await repo().markAvailabilityFailure(
      'org-001', projectId, run.id, 'provider_failure', failedAt,
    );
    expect(failed).toMatchObject({
      status: 'availability_failure',
      availabilityReason: 'provider_failure',
      availabilityFailedAt: failedAt,
    });
    expect(await repo().getRun('org-001', projectId, run.id)).toEqual(failed);
  });

  it('is available transactionally through DatabaseUnitOfWork', async () => {
    const run = assuranceRun();
    const uow = new database.DatabaseUnitOfWork(pool);
    await uow.run(async ({ assurance }) => {
      expect(assurance).toBeDefined();
      await assurance.createRun(run);
    });
    expect(await repo().getRun('org-001', projectId, run.id)).toEqual(run);
  });
});

describe('AssuranceRepository finding closure', () => {
  it('persists terminal finding status with actor, timestamp and mandatory resolution note', async () => {
    const run = assuranceRun('assurance_run_close');
    await repo().createRun(run);
    const finding = createAssuranceFinding({
      id: 'assurance_finding_close', assuranceRunId: run.id,
      severity: 'important', kind: 'ambiguity', category: 'identity',
      summary: 'Recovery ownership is unclear.', rationale: 'The exact requirements are ambiguous.',
      basis: 'project_evidence', evidenceReferences: [], createdAt: now,
    });
    await repo().createFinding('org-001', projectId, finding);
    const resolvedAt = new Date(now.getTime() + 5000);
    const closed = await repo().closeFinding(
      'org-001', projectId, run.id, finding.id, 'dismissed',
      'product-owner-001', 'Not applicable for invitation-only accounts.', resolvedAt,
    );
    expect(closed).toMatchObject({
      status: 'dismissed', resolvedBy: 'product-owner-001',
      resolutionNote: 'Not applicable for invitation-only accounts.', resolvedAt,
    });
    await expect(repo().closeFinding(
      'org-001', projectId, run.id, finding.id, 'resolved',
      'product-owner-001', 'Second closure must fail.', new Date(resolvedAt.getTime() + 1),
    )).rejects.toThrow(/open/i);
  });
});
