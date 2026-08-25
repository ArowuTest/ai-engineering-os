import {
  closeAssuranceFinding,
  createAssuranceFinding,
  createAssuranceRun,
  invalidateAssuranceRunForTarget,
  markAssuranceRunAvailabilityFailure,
  type AssuranceAvailabilityReason,
  type AssuranceFinding,
  type AssuranceRun,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface RunRow {
  id: string; organisation_id: string; project_id: string; profile_id: string;
  target_type: string; target_digest: string; reviewer_agent_capability_id: string;
  reviewer_route_id: string; status: AssuranceRun['status']; created_by: string;
  created_at: Date; completed_at: Date | null; availability_failed_at: Date | null;
  availability_reason: AssuranceAvailabilityReason | null; invalidated_at: Date | null;
  invalidated_by_target_digest: string | null;
}

interface FindingRow {
  id: string; assurance_run_id: string; severity: AssuranceFinding['severity'];
  kind: AssuranceFinding['kind']; category: string; summary: string; rationale: string;
  proposed_question: string | null; suggested_direction: string | null;
  basis: AssuranceFinding['basis']; evidence_references: string[];
  status: AssuranceFinding['status']; created_at: Date; resolved_at: Date | null;
  resolved_by: string | null; resolution_note: string | null;
}

const RUN_COLUMNS = `id, organisation_id, project_id, profile_id, target_type, target_digest,
  reviewer_agent_capability_id, reviewer_route_id, status, created_by, created_at,
  completed_at, availability_failed_at, availability_reason, invalidated_at,
  invalidated_by_target_digest`;

function mapRun(row: RunRow): AssuranceRun {
  const base = createAssuranceRun({
    id: row.id, organisationId: row.organisation_id, projectId: row.project_id,
    profileId: row.profile_id, targetType: row.target_type, targetDigest: row.target_digest,
    reviewerAgentCapabilityId: row.reviewer_agent_capability_id,
    reviewerRouteId: row.reviewer_route_id, createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  });
  return {
    ...base,
    status: row.status,
    ...(row.completed_at === null ? {} : { completedAt: new Date(row.completed_at) }),
    ...(row.availability_failed_at === null
      ? {} : { availabilityFailedAt: new Date(row.availability_failed_at) }),
    ...(row.availability_reason === null ? {} : { availabilityReason: row.availability_reason }),
    ...(row.invalidated_at === null ? {} : { invalidatedAt: new Date(row.invalidated_at) }),
    ...(row.invalidated_by_target_digest === null
      ? {} : { invalidatedByTargetDigest: row.invalidated_by_target_digest }),
  };
}

function mapFinding(row: FindingRow): AssuranceFinding {
  const base = createAssuranceFinding({
    id: row.id, assuranceRunId: row.assurance_run_id, severity: row.severity,
    kind: row.kind, category: row.category, summary: row.summary, rationale: row.rationale,
    ...(row.proposed_question === null ? {} : { proposedQuestion: row.proposed_question }),
    ...(row.suggested_direction === null ? {} : { suggestedDirection: row.suggested_direction }),
    basis: row.basis, evidenceReferences: [...row.evidence_references], createdAt: new Date(row.created_at),
  });
  return {
    ...base,
    status: row.status,
    ...(row.resolved_at === null ? {} : { resolvedAt: new Date(row.resolved_at) }),
    ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }),
    ...(row.resolution_note === null ? {} : { resolutionNote: row.resolution_note }),
  };
}

export class AssuranceRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createRun(input: AssuranceRun): Promise<void> {
    const run = createAssuranceRun(input);
    await this.database.query(
      `INSERT INTO assurance_runs (${RUN_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'collecting',$9,$10,NULL,NULL,NULL,NULL,NULL)`,
      [run.id, run.organisationId, run.projectId, run.profileId, run.targetType,
       run.targetDigest, run.reviewerAgentCapabilityId, run.reviewerRouteId,
       run.createdBy, run.createdAt],
    );
  }

  async getRun(organisationId: string, projectId: string, id: string): Promise<AssuranceRun | null> {
    const result = await this.database.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM assurance_runs
       WHERE organisation_id=$1 AND project_id=$2 AND id=$3`,
      [organisationId, projectId, id],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async getLatestRun(
    organisationId: string, projectId: string, profileId: string,
  ): Promise<AssuranceRun | null> {
    const result = await this.database.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM assurance_runs
       WHERE organisation_id=$1 AND project_id=$2 AND profile_id=$3
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [organisationId, projectId, profileId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async markCompleted(
    organisationId: string, projectId: string, id: string, completedAt: Date,
  ): Promise<AssuranceRun> {
    const result = await this.database.query<RunRow>(
      `UPDATE assurance_runs SET status='completed', completed_at=$4
       WHERE organisation_id=$1 AND project_id=$2 AND id=$3 AND status='collecting'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, projectId, id, completedAt],
    );
    if (!result.rows[0]) throw new Error('assurance run not found or not collecting');
    return mapRun(result.rows[0]);
  }

  async markAvailabilityFailure(
    organisationId: string, projectId: string, id: string,
    reason: AssuranceAvailabilityReason, failedAt: Date,
  ): Promise<AssuranceRun> {
    const current = await this.getRun(organisationId, projectId, id);
    if (!current) throw new Error('assurance run not found');
    const failed = markAssuranceRunAvailabilityFailure(current, reason, failedAt);
    const result = await this.database.query<RunRow>(
      `UPDATE assurance_runs SET status='availability_failure', availability_failed_at=$4,
         availability_reason=$5
       WHERE organisation_id=$1 AND project_id=$2 AND id=$3 AND status='collecting'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, projectId, id, failed.availabilityFailedAt, failed.availabilityReason],
    );
    if (!result.rows[0]) throw new Error('assurance run not found or not collecting');
    return mapRun(result.rows[0]);
  }

  async invalidateRunForTarget(
    organisationId: string, projectId: string, id: string,
    replacementTargetDigest: string, invalidatedAt: Date,
  ): Promise<AssuranceRun> {
    const current = await this.getRun(organisationId, projectId, id);
    if (!current) throw new Error('assurance run not found');
    const invalidated = invalidateAssuranceRunForTarget(current, replacementTargetDigest, invalidatedAt);
    const result = await this.database.query<RunRow>(
      `UPDATE assurance_runs SET status='invalidated', invalidated_at=$4,
         invalidated_by_target_digest=$5
       WHERE organisation_id=$1 AND project_id=$2 AND id=$3 AND status <> 'invalidated'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, projectId, id, invalidated.invalidatedAt, invalidated.invalidatedByTargetDigest],
    );
    if (!result.rows[0]) throw new Error('assurance run already invalidated');
    return mapRun(result.rows[0]);
  }

  async createFinding(
    organisationId: string, projectId: string, input: AssuranceFinding,
  ): Promise<void> {
    const finding = createAssuranceFinding(input);
    await this.database.query(
      `INSERT INTO assurance_findings
       (id, organisation_id, project_id, assurance_run_id, severity, kind, category,
        summary, rationale, proposed_question, suggested_direction, basis,
        evidence_references, status, created_at, resolved_at, resolved_by, resolution_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14,NULL,NULL,NULL)`,
      [finding.id, organisationId, projectId, finding.assuranceRunId, finding.severity,
       finding.kind, finding.category, finding.summary, finding.rationale,
       finding.proposedQuestion ?? null, finding.suggestedDirection ?? null, finding.basis,
       finding.evidenceReferences, finding.createdAt],
    );
  }

  async listFindings(
    organisationId: string, projectId: string, assuranceRunId: string,
  ): Promise<AssuranceFinding[]> {
    const result = await this.database.query<FindingRow>(
      `SELECT id, assurance_run_id, severity, kind, category, summary, rationale,
              proposed_question, suggested_direction, basis, evidence_references,
              status, created_at, resolved_at, resolved_by, resolution_note
       FROM assurance_findings
       WHERE organisation_id=$1 AND project_id=$2 AND assurance_run_id=$3
       ORDER BY created_at ASC, id ASC`,
      [organisationId, projectId, assuranceRunId],
    );
    return result.rows.map(mapFinding);
  }

  async closeFinding(
    organisationId: string,
    projectId: string,
    assuranceRunId: string,
    findingId: string,
    status: 'resolved' | 'dismissed',
    resolvedBy: string,
    resolutionNote: string,
    resolvedAt: Date,
  ): Promise<AssuranceFinding> {
    const current = (await this.listFindings(organisationId, projectId, assuranceRunId))
      .find((finding) => finding.id === findingId);
    if (!current) throw new Error('assurance finding not found');
    const closed = closeAssuranceFinding(current, {
      status, resolvedBy, resolutionNote, resolvedAt,
    });
    const result = await this.database.query<FindingRow>(
      `UPDATE assurance_findings
       SET status=$5, resolved_at=$6, resolved_by=$7, resolution_note=$8
       WHERE organisation_id=$1 AND project_id=$2 AND assurance_run_id=$3
         AND id=$4 AND status='open'
       RETURNING id, assurance_run_id, severity, kind, category, summary, rationale,
         proposed_question, suggested_direction, basis, evidence_references,
         status, created_at, resolved_at, resolved_by, resolution_note`,
      [organisationId, projectId, assuranceRunId, findingId, closed.status,
       closed.resolvedAt, closed.resolvedBy, closed.resolutionNote],
    );
    if (!result.rows[0]) throw new Error('assurance finding is not open');
    return mapFinding(result.rows[0]);
  }
}
