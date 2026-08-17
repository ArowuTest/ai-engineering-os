import {
  buildBlindReviewPacket,
  createArchitectureInvariant,
  createCalibrationSnapshot,
  createFindingAdjudication,
  createReviewFinding,
  createReviewRun,
  createReviewerRechallenge,
  invalidateReviewRunForSource,
  REVIEW_MAX_MODEL_VERSION_LENGTH,
  requireNonBlank,
  requireStableIdentifier,
  type ArchitectureInvariant,
  type CalibrationSnapshot,
  type FindingAdjudication,
  type ReviewFinding,
  type ReviewerRechallenge,
  type ReviewRun,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ReviewerAssignmentStatus = 'assigned' | 'completed' | 'availability_failure';
export type ReviewerAvailabilityReason = 'empty_output' | 'timeout' | 'malformed_output';

export interface ReviewerAssignmentRecord {
  id: string;
  organisationId: string;
  reviewRunId: string;
  role: string;
  routeId: string;
  modelId: string;
  modelVersion: string;
  packetDigest: string;
  status: ReviewerAssignmentStatus;
  availabilityReason?: ReviewerAvailabilityReason;
  contentDigest?: string;
  createdAt: Date;
  resolvedAt?: Date;
}
export interface CreateReviewerAssignmentInput {
  id: string;
  organisationId: string;
  reviewRunId: string;
  role: string;
  routeId: string;
  modelId: string;
  modelVersion: string;
  packetDigest: string;
  createdAt: Date;
}

interface ReviewRunRow {
  id: string; organisation_id: string; project_id: string; source_digest: string;
  evidence_digest: string; packet_digest: string; status: ReviewRun['status'];
  created_by: string; created_at: Date; invalidated_at: Date | null;
  invalidated_by_source_digest: string | null;
}

interface AssignmentRow {
  id: string; organisation_id: string; review_run_id: string; role: string;
  route_id: string; model_id: string; model_version: string; packet_digest: string;
  status: ReviewerAssignmentStatus; availability_reason: ReviewerAvailabilityReason | null;
  content_digest: string | null; created_at: Date; resolved_at: Date | null;
}

interface FindingRow {
  id: string; review_run_id: string; reviewer_assignment_id: string;
  severity: ReviewFinding['severity']; category: string; summary: string;
  evidence_references: string[]; created_at: Date;
}

interface AdjudicationRow {
  id: string; finding_id: string; review_run_id: string; status: FindingAdjudication['status'];
  rationale: string; evidence_references: string[]; adjudicated_by: string; created_at: Date;
}

interface RechallengeRow {
  id: string; review_run_id: string; finding_id: string; reviewer_assignment_id: string;
  adjudication_status: ReviewerRechallenge['adjudicationStatus']; prompt_digest: string;
  created_at: Date;
}
interface CalibrationRow {
  id: string; organisation_id: string; route_id: string; model_id: string; model_version: string;
  sample_size: number; useful_finding_rate: number; false_positive_rate: number;
  availability_rate: number; median_latency_ms: number; average_cost_usd: number; created_at: Date;
}

interface InvariantRow {
  id: string; key: string; description: string; severity: ArchitectureInvariant['severity']; created_at: Date;
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeAssignment(input: CreateReviewerAssignmentInput): ReviewerAssignmentRecord {
  return {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    reviewRunId: requireStableIdentifier(input.reviewRunId, 'reviewRunId'),
    role: requireStableIdentifier(input.role, 'role'),
    routeId: requireStableIdentifier(input.routeId, 'routeId'),
    modelId: requireStableIdentifier(input.modelId, 'modelId'),
    modelVersion: (() => {
      const value = requireNonBlank(input.modelVersion, 'modelVersion');
      if (value.length > REVIEW_MAX_MODEL_VERSION_LENGTH) {
        throw new TypeError(`modelVersion must be at most ${REVIEW_MAX_MODEL_VERSION_LENGTH} characters`);
      }
      return value;
    })(),
    packetDigest: requireDigest(input.packetDigest, 'packetDigest'),
    status: 'assigned',
    createdAt: requireDate(input.createdAt, 'createdAt'),
  };
}
function mapRun(row: ReviewRunRow): ReviewRun {
  const base = createReviewRun({
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    sourceDigest: row.source_digest,
    evidenceDigest: row.evidence_digest,
    packetDigest: row.packet_digest,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  });
  if (base.packetDigest !== row.packet_digest) {
    throw new Error(`review run ${row.id} packet digest mismatch`);
  }
  return {
    ...base,
    status: row.status,
    ...(row.invalidated_at === null ? {} : { invalidatedAt: new Date(row.invalidated_at) }),
    ...(row.invalidated_by_source_digest === null
      ? {}
      : { invalidatedBySourceDigest: row.invalidated_by_source_digest }),
  };
}

function mapAssignment(row: AssignmentRow): ReviewerAssignmentRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    reviewRunId: row.review_run_id,
    role: row.role,
    routeId: row.route_id,
    modelId: row.model_id,
    modelVersion: row.model_version,
    packetDigest: row.packet_digest,
    status: row.status,
    ...(row.availability_reason === null ? {} : { availabilityReason: row.availability_reason }),
    ...(row.content_digest === null ? {} : { contentDigest: row.content_digest }),
    createdAt: new Date(row.created_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: new Date(row.resolved_at) }),
  };
}
function mapFinding(row: FindingRow): ReviewFinding {
  return createReviewFinding({
    id: row.id,
    reviewRunId: row.review_run_id,
    reviewerAssignmentId: row.reviewer_assignment_id,
    severity: row.severity,
    category: row.category,
    summary: row.summary,
    evidenceReferences: [...row.evidence_references],
    createdAt: new Date(row.created_at),
  });
}

function mapAdjudication(row: AdjudicationRow): FindingAdjudication {
  return createFindingAdjudication({
    id: row.id,
    findingId: row.finding_id,
    reviewRunId: row.review_run_id,
    status: row.status,
    rationale: row.rationale,
    evidenceReferences: [...row.evidence_references],
    adjudicatedBy: row.adjudicated_by,
    createdAt: new Date(row.created_at),
  });
}

function mapRechallenge(row: RechallengeRow): ReviewerRechallenge {
  return createReviewerRechallenge({
    id: row.id,
    reviewRunId: row.review_run_id,
    findingId: row.finding_id,
    reviewerAssignmentId: row.reviewer_assignment_id,
    adjudicationStatus: row.adjudication_status,
    promptDigest: row.prompt_digest,
    createdAt: new Date(row.created_at),
  });
}
function mapCalibration(row: CalibrationRow): CalibrationSnapshot {
  return createCalibrationSnapshot({
    id: row.id,
    organisationId: row.organisation_id,
    routeId: row.route_id,
    modelId: row.model_id,
    modelVersion: row.model_version,
    sampleSize: row.sample_size,
    usefulFindingRate: row.useful_finding_rate,
    falsePositiveRate: row.false_positive_rate,
    availabilityRate: row.availability_rate,
    medianLatencyMs: row.median_latency_ms,
    averageCostUsd: row.average_cost_usd,
    createdAt: new Date(row.created_at),
  });
}

function mapInvariant(row: InvariantRow): ArchitectureInvariant {
  return createArchitectureInvariant({
    id: row.id,
    key: row.key,
    description: row.description,
    severity: row.severity,
    createdAt: new Date(row.created_at),
  });
}

const RUN_COLUMNS = `id, organisation_id, project_id, source_digest, evidence_digest,
  packet_digest, status, created_by, created_at, invalidated_at, invalidated_by_source_digest`;
const ASSIGNMENT_COLUMNS = `id, organisation_id, review_run_id, role, route_id, model_id,
  model_version, packet_digest, status, availability_reason, content_digest, created_at, resolved_at`;

export class ReviewCouncilRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createRun(input: ReviewRun, material: {
    source: string; evidence: string; invariantIds: string[];
  }): Promise<void> {
    const run = createReviewRun(input);
    buildBlindReviewPacket(run, material);
    await this.database.query(
      `INSERT INTO review_runs (${RUN_COLUMNS}, source_material, evidence_material, invariant_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,$11,$12)`,
      [run.id, run.organisationId, run.projectId, run.sourceDigest, run.evidenceDigest,
       run.packetDigest, run.status, run.createdBy, run.createdAt,
       material.source, material.evidence, material.invariantIds],
    );
  }

  async getRunMaterial(organisationId: string, reviewRunId: string): Promise<{
    source: string; evidence: string; invariantIds: string[];
  } | null> {
    const result = await this.database.query<{ source_material: string; evidence_material: string; invariant_ids: string[] }>(
      `SELECT source_material, evidence_material, invariant_ids FROM review_runs
       WHERE organisation_id=$1 AND id=$2`,
      [organisationId, reviewRunId],
    );
    const row = result.rows[0];
    return row ? { source: row.source_material, evidence: row.evidence_material, invariantIds: [...row.invariant_ids] } : null;
  }
  async getRun(organisationId: string, reviewRunId: string): Promise<ReviewRun | null> {
    const result = await this.database.query<ReviewRunRow>(
      `SELECT ${RUN_COLUMNS} FROM review_runs WHERE organisation_id = $1 AND id = $2`,
      [organisationId, reviewRunId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async getRunForUpdate(organisationId: string, reviewRunId: string): Promise<ReviewRun | null> {
    const result = await this.database.query<ReviewRunRow>(
      `SELECT ${RUN_COLUMNS} FROM review_runs
       WHERE organisation_id = $1 AND id = $2
       FOR UPDATE`,
      [organisationId, reviewRunId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async claimCollection(organisationId: string, reviewRunId: string, claimToken: string,
    claimedAt: Date, expiresAt: Date): Promise<void> {
    const token = requireStableIdentifier(claimToken, 'claimToken');
    const claimed = requireDate(claimedAt, 'claimedAt');
    const expires = requireDate(expiresAt, 'expiresAt');
    if (expires.getTime() <= claimed.getTime()) throw new TypeError('expiresAt must be after claimedAt');
    const result = await this.database.query(
      `UPDATE review_runs SET collection_claim_token = $3, collection_claim_expires_at = $5
       WHERE organisation_id = $1 AND id = $2 AND status = 'collecting'
         AND (collection_claim_token IS NULL OR collection_claim_expires_at <= $4)`,
      [organisationId, reviewRunId, token, claimed, expires],
    );
    if (result.rowCount !== 1) throw new Error('review collection already in progress or run is not collecting');
  }

  async requireCollectionClaim(organisationId: string, reviewRunId: string, claimToken: string): Promise<void> {
    const result = await this.database.query(
      `SELECT 1 FROM review_runs WHERE organisation_id = $1 AND id = $2
         AND status = 'collecting' AND collection_claim_token = $3`,
      [organisationId, reviewRunId, requireStableIdentifier(claimToken, 'claimToken')],
    );
    if (result.rowCount !== 1) throw new Error('review collection claim is stale');
  }

  async releaseCollectionClaim(organisationId: string, reviewRunId: string, claimToken: string): Promise<void> {
    await this.database.query(
      `UPDATE review_runs SET collection_claim_token = NULL, collection_claim_expires_at = NULL
       WHERE organisation_id = $1 AND id = $2 AND status = 'collecting' AND collection_claim_token = $3`,
      [organisationId, reviewRunId, requireStableIdentifier(claimToken, 'claimToken')],
    );
  }

  async markAdjudicating(organisationId: string, reviewRunId: string, claimToken: string): Promise<ReviewRun> {
    const result = await this.database.query<ReviewRunRow>(
      `UPDATE review_runs SET status = 'adjudicating', collection_claim_token = NULL,
         collection_claim_expires_at = NULL WHERE organisation_id = $1 AND id = $2
         AND status = 'collecting' AND collection_claim_token = $3 RETURNING ${RUN_COLUMNS}`,
      [organisationId, reviewRunId, requireStableIdentifier(claimToken, 'claimToken')],
    );
    if (!result.rows[0]) throw new Error('review run is not collecting or collection claim is stale');
    return mapRun(result.rows[0]);
  }

  async markBlocked(organisationId: string, reviewRunId: string): Promise<ReviewRun> {
    const result = await this.database.query<ReviewRunRow>(
      `UPDATE review_runs SET status = 'blocked'
       WHERE organisation_id = $1 AND id = $2 AND status = 'adjudicating'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, reviewRunId],
    );
    if (!result.rows[0]) throw new Error('review run is not adjudicating');
    return mapRun(result.rows[0]);
  }

  async markAccepted(organisationId: string, reviewRunId: string): Promise<ReviewRun> {
    const result = await this.database.query<ReviewRunRow>(
      `UPDATE review_runs SET status = 'accepted'
       WHERE organisation_id = $1 AND id = $2 AND status = 'adjudicating'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, reviewRunId],
    );
    if (!result.rows[0]) throw new Error('review run is not adjudicating');
    return mapRun(result.rows[0]);
  }

  async createReviewerAssignment(input: CreateReviewerAssignmentInput): Promise<ReviewerAssignmentRecord> {
    const assignment = normalizeAssignment(input);
    const run = await this.database.query<{ packet_digest: string; status: ReviewRun['status'] }>(
      `SELECT packet_digest, status FROM review_runs WHERE organisation_id = $1 AND id = $2`,
      [assignment.organisationId, assignment.reviewRunId],
    );
    if (!run.rows[0]) throw new Error('review run not found');
    if (run.rows[0].status !== 'collecting') throw new Error('review run is not collecting');
    if (run.rows[0].packet_digest !== assignment.packetDigest) {
      throw new Error('reviewer assignment packet digest does not match review run packet');
    }
    const result = await this.database.query<AssignmentRow>(
      `INSERT INTO review_reviewer_assignments
        (id, organisation_id, review_run_id, role, route_id, model_id, model_version,
         packet_digest, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'assigned',$9)
       RETURNING ${ASSIGNMENT_COLUMNS}`,
      [assignment.id, assignment.organisationId, assignment.reviewRunId, assignment.role,
       assignment.routeId, assignment.modelId, assignment.modelVersion,
       assignment.packetDigest, assignment.createdAt],
    );
    return mapAssignment(result.rows[0]!);
  }

  async listReviewerAssignments(
    organisationId: string,
    reviewRunId: string,
  ): Promise<ReviewerAssignmentRecord[]> {
    const result = await this.database.query<AssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM review_reviewer_assignments
       WHERE organisation_id = $1 AND review_run_id = $2
       ORDER BY id ASC`,
      [organisationId, reviewRunId],
    );
    return result.rows.map(mapAssignment);
  }

  async getReviewerAssignment(
    organisationId: string,
    reviewRunId: string,
    assignmentId: string,
  ): Promise<ReviewerAssignmentRecord | null> {
    const result = await this.database.query<AssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM review_reviewer_assignments
       WHERE organisation_id = $1 AND review_run_id = $2 AND id = $3`,
      [organisationId, reviewRunId, assignmentId],
    );
    return result.rows[0] ? mapAssignment(result.rows[0]) : null;
  }

  async recordReviewerAvailabilityFailure(
    organisationId: string,
    assignmentId: string,
    reason: ReviewerAvailabilityReason,
    resolvedAt: Date,
  ): Promise<ReviewerAssignmentRecord> {
    if (!['empty_output','timeout','malformed_output'].includes(reason)) {
      throw new TypeError('unknown reviewer availability reason');
    }
    const result = await this.database.query<AssignmentRow>(
      `UPDATE review_reviewer_assignments
       SET status = 'availability_failure', availability_reason = $3,
           content_digest = NULL, resolved_at = $4
       WHERE organisation_id = $1 AND id = $2 AND status = 'assigned'
       RETURNING ${ASSIGNMENT_COLUMNS}`,
      [organisationId, assignmentId, reason, requireDate(resolvedAt, 'resolvedAt')],
    );
    if (!result.rows[0]) throw new Error('reviewer assignment not found or already resolved');
    return mapAssignment(result.rows[0]);
  }
  async recordReviewerCompleted(
    organisationId: string,
    assignmentId: string,
    contentDigest: string,
    resolvedAt: Date,
  ): Promise<ReviewerAssignmentRecord> {
    const result = await this.database.query<AssignmentRow>(
      `UPDATE review_reviewer_assignments
       SET status = 'completed', availability_reason = NULL,
           content_digest = $3, resolved_at = $4
       WHERE organisation_id = $1 AND id = $2 AND status = 'assigned'
       RETURNING ${ASSIGNMENT_COLUMNS}`,
      [organisationId, assignmentId, requireDigest(contentDigest, 'contentDigest'),
       requireDate(resolvedAt, 'resolvedAt')],
    );
    if (!result.rows[0]) throw new Error('reviewer assignment not found or already resolved');
    return mapAssignment(result.rows[0]);
  }

  async createFinding(organisationId: string, input: ReviewFinding): Promise<void> {
    const finding = createReviewFinding(input);
    await this.database.query(
      `INSERT INTO review_findings
        (id, organisation_id, review_run_id, reviewer_assignment_id, severity,
         category, summary, evidence_references, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [finding.id, organisationId, finding.reviewRunId, finding.reviewerAssignmentId,
       finding.severity, finding.category, finding.summary, finding.evidenceReferences,
       finding.createdAt],
    );
  }

  async listFindings(organisationId: string, reviewRunId: string): Promise<ReviewFinding[]> {
    const result = await this.database.query<FindingRow>(
      `SELECT id, review_run_id, reviewer_assignment_id, severity, category, summary,
              evidence_references, created_at
       FROM review_findings
       WHERE organisation_id = $1 AND review_run_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, reviewRunId],
    );
    return result.rows.map(mapFinding);
  }
  async getFinding(
    organisationId: string,
    reviewRunId: string,
    findingId: string,
  ): Promise<ReviewFinding | null> {
    const result = await this.database.query<FindingRow>(
      `SELECT id, review_run_id, reviewer_assignment_id, severity, category, summary,
              evidence_references, created_at
       FROM review_findings
       WHERE organisation_id = $1 AND review_run_id = $2 AND id = $3`,
      [organisationId, reviewRunId, findingId],
    );
    return result.rows[0] ? mapFinding(result.rows[0]) : null;
  }

  async createAdjudication(organisationId: string, input: FindingAdjudication): Promise<void> {
    const adjudication = createFindingAdjudication(input);
    await this.database.query(
      `INSERT INTO review_finding_adjudications
        (id, organisation_id, review_run_id, finding_id, status, rationale,
         evidence_references, adjudicated_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [adjudication.id, organisationId, adjudication.reviewRunId, adjudication.findingId,
       adjudication.status, adjudication.rationale, adjudication.evidenceReferences,
       adjudication.adjudicatedBy, adjudication.createdAt],
    );
  }

  async listAdjudications(
    organisationId: string,
    reviewRunId: string,
  ): Promise<FindingAdjudication[]> {
    const result = await this.database.query<AdjudicationRow>(
      `SELECT id, finding_id, review_run_id, status, rationale,
              evidence_references, adjudicated_by, created_at
       FROM review_finding_adjudications
       WHERE organisation_id = $1 AND review_run_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, reviewRunId],
    );
    return result.rows.map(mapAdjudication);
  }

  async createRechallenge(organisationId: string, input: ReviewerRechallenge): Promise<void> {
    const rechallenge = createReviewerRechallenge(input);
    const finding = await this.database.query<{ reviewer_assignment_id: string }>(
      `SELECT reviewer_assignment_id FROM review_findings
       WHERE organisation_id = $1 AND review_run_id = $2 AND id = $3`,
      [organisationId, rechallenge.reviewRunId, rechallenge.findingId],
    );
    if (!finding.rows[0] || finding.rows[0].reviewer_assignment_id !== rechallenge.reviewerAssignmentId) {
      throw new Error('rechallenge must target the original reviewer assignment');
    }
    const adjudication = await this.database.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM review_finding_adjudications
         WHERE organisation_id = $1 AND review_run_id = $2 AND finding_id = $3 AND status = $4
       ) AS exists`,
      [organisationId, rechallenge.reviewRunId, rechallenge.findingId, rechallenge.adjudicationStatus],
    );
    if (!adjudication.rows[0]?.exists) {
      throw new Error('rechallenge requires a matching rejected or partially-valid adjudication');
    }
    await this.database.query(
      `INSERT INTO review_rechallenges
        (id, organisation_id, review_run_id, finding_id, reviewer_assignment_id,
         adjudication_status, prompt_digest, visibility, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [rechallenge.id, organisationId, rechallenge.reviewRunId, rechallenge.findingId,
       rechallenge.reviewerAssignmentId, rechallenge.adjudicationStatus,
       rechallenge.promptDigest, rechallenge.visibility, rechallenge.createdAt],
    );
  }

  async listRechallenges(
    organisationId: string,
    reviewRunId: string,
  ): Promise<ReviewerRechallenge[]> {
    const result = await this.database.query<RechallengeRow>(
      `SELECT id, review_run_id, finding_id, reviewer_assignment_id,
              adjudication_status, prompt_digest, created_at
       FROM review_rechallenges
       WHERE organisation_id = $1 AND review_run_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, reviewRunId],
    );
    return result.rows.map(mapRechallenge);
  }
  async createCalibrationSnapshot(input: CalibrationSnapshot): Promise<void> {
    const snapshot = createCalibrationSnapshot(input);
    await this.database.query(
      `INSERT INTO review_calibration_snapshots
        (id, organisation_id, route_id, model_id, model_version, sample_size,
         useful_finding_rate, false_positive_rate, availability_rate,
         median_latency_ms, average_cost_usd, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [snapshot.id, snapshot.organisationId, snapshot.routeId, snapshot.modelId,
       snapshot.modelVersion, snapshot.sampleSize, snapshot.usefulFindingRate,
       snapshot.falsePositiveRate, snapshot.availabilityRate, snapshot.medianLatencyMs,
       snapshot.averageCostUsd, snapshot.createdAt],
    );
  }

  async listCalibrationSnapshots(
    organisationId: string,
    routeId: string,
  ): Promise<CalibrationSnapshot[]> {
    const result = await this.database.query<CalibrationRow>(
      `SELECT id, organisation_id, route_id, model_id, model_version, sample_size,
              useful_finding_rate, false_positive_rate, availability_rate,
              median_latency_ms, average_cost_usd, created_at
       FROM review_calibration_snapshots
       WHERE organisation_id = $1 AND route_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, routeId],
    );
    return result.rows.map(mapCalibration);
  }

  async createArchitectureInvariant(input: ArchitectureInvariant): Promise<void> {
    const invariant = createArchitectureInvariant(input);
    await this.database.query(
      `INSERT INTO review_architecture_invariants
        (id, key, description, severity, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [invariant.id, invariant.key, invariant.description, invariant.severity, invariant.createdAt],
    );
  }
  async listArchitectureInvariants(): Promise<ArchitectureInvariant[]> {
    const result = await this.database.query<InvariantRow>(
      `SELECT id, key, description, severity, created_at
       FROM review_architecture_invariants
       ORDER BY created_at ASC, id ASC`,
    );
    return result.rows.map(mapInvariant);
  }

  async invalidateRunForSource(
    organisationId: string,
    reviewRunId: string,
    replacementSourceDigest: string,
    invalidatedAt: Date,
  ): Promise<ReviewRun> {
    const existing = await this.getRun(organisationId, reviewRunId);
    if (!existing) throw new Error('review run not found');
    const invalidated = invalidateReviewRunForSource(
      existing,
      replacementSourceDigest,
      invalidatedAt,
    );
    const result = await this.database.query<ReviewRunRow>(
      `UPDATE review_runs
       SET status = 'invalidated', invalidated_at = $3, invalidated_by_source_digest = $4,
           collection_claim_token = NULL, collection_claim_expires_at = NULL
       WHERE organisation_id = $1 AND id = $2 AND status <> 'invalidated'
       RETURNING ${RUN_COLUMNS}`,
      [organisationId, reviewRunId, invalidated.invalidatedAt!, invalidated.invalidatedBySourceDigest!],
    );
    if (!result.rows[0]) throw new Error('review run already invalidated');
    return mapRun(result.rows[0]);
  }
}
