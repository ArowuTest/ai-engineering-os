import { createHash } from 'node:crypto';
import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const REVIEW_SEVERITIES = ['critical', 'important', 'minor', 'observation'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_RUN_STATUSES = ['collecting', 'adjudicating', 'blocked', 'accepted', 'invalidated'] as const;
export type ReviewRunStatus = (typeof REVIEW_RUN_STATUSES)[number];

export const FINDING_ADJUDICATION_STATUSES = [
  'CONFIRMED', 'PARTIALLY_VALID', 'REJECTED', 'INSUFFICIENT_EVIDENCE'
] as const;
export type FindingAdjudicationStatus = (typeof FINDING_ADJUDICATION_STATUSES)[number];

export interface ReviewRun {
  id: string;
  organisationId: string;
  projectId: string;
  sourceDigest: string;
  evidenceDigest: string;
  packetDigest: string;
  status: ReviewRunStatus;
  createdBy: string;
  createdAt: Date;
  invalidatedAt?: Date;
  invalidatedBySourceDigest?: string;
}
export interface CreateReviewRunInput {
  id: string;
  organisationId: string;
  projectId: string;
  sourceDigest: string;
  evidenceDigest: string;
  createdBy: string;
  createdAt: Date;
}

export interface BlindReviewPacket {
  reviewRunId: string;
  packetDigest: string;
  source: string;
  evidence: string;
  invariantIds: string[];
}

export interface ReviewFinding {
  id: string;
  reviewRunId: string;
  reviewerAssignmentId: string;
  severity: ReviewSeverity;
  category: string;
  summary: string;
  evidenceReferences: string[];
  createdAt: Date;
}
export interface CreateReviewFindingInput extends ReviewFinding {}

export interface FindingAdjudication {
  id: string;
  findingId: string;
  reviewRunId: string;
  status: FindingAdjudicationStatus;
  rationale: string;
  evidenceReferences: string[];
  adjudicatedBy: string;
  createdAt: Date;
}

export interface ReviewerRechallenge {
  id: string;
  reviewRunId: string;
  findingId: string;
  reviewerAssignmentId: string;
  adjudicationStatus: Extract<FindingAdjudicationStatus, 'REJECTED' | 'PARTIALLY_VALID'>;
  promptDigest: string;
  visibility: 'private_original_reviewer';
  createdAt: Date;
}

export interface CalibrationSnapshot {
  id: string;
  organisationId: string;
  routeId: string;
  modelId: string;
  modelVersion: string;
  sampleSize: number;
  usefulFindingRate: number;
  falsePositiveRate: number;
  availabilityRate: number;
  medianLatencyMs: number;
  averageCostUsd: number;
  createdAt: Date;
}

export interface ArchitectureInvariant {
  id: string;
  key: string;
  description: string;
  severity: Extract<ReviewSeverity, 'critical' | 'important'>;
  createdAt: Date;
}

export interface ReviewGateResult {
  status: 'clear' | 'blocked';
  blockingFindingIds: string[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError(field, `${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}
function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new DomainValidationError(field, `${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireSeverity(value: unknown): ReviewSeverity {
  if (typeof value !== 'string' || !REVIEW_SEVERITIES.includes(value as ReviewSeverity)) {
    throw new DomainValidationError('severity', 'severity must be a known review severity');
  }
  return value as ReviewSeverity;
}

function requireAdjudicationStatus(value: unknown): FindingAdjudicationStatus {
  if (typeof value !== 'string' || !FINDING_ADJUDICATION_STATUSES.includes(value as FindingAdjudicationStatus)) {
    throw new DomainValidationError('status', 'status must be a known finding adjudication status');
  }
  return value as FindingAdjudicationStatus;
}

function requireStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(field, `${field} must be an array`);
  const normalized = value.map((entry, index) => requireNonBlank(entry, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new DomainValidationError(field, `${field} must not contain duplicates`);
  }
  return normalized;
}
function requireRatio(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(field, `${field} must be between 0 and 1`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(field, `${field} must be a finite non-negative number`);
  }
  return value;
}

export function digestReviewMaterial(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function createReviewRun(input: CreateReviewRunInput): ReviewRun {
  const sourceDigest = requireDigest(input.sourceDigest, 'sourceDigest');
  const evidenceDigest = requireDigest(input.evidenceDigest, 'evidenceDigest');
  return {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    projectId: requireStableIdentifier(input.projectId, 'projectId'),
    sourceDigest,
    evidenceDigest,
    packetDigest: digestReviewMaterial(`${sourceDigest}:${evidenceDigest}`),
    status: 'collecting',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}

export function buildBlindReviewPacket(
  run: ReviewRun,
  material: { source: string; evidence: string; invariantIds: string[] }
): BlindReviewPacket {
  if (digestReviewMaterial(material.source) !== run.sourceDigest) {
    throw new DomainValidationError('source', 'source material does not match run sourceDigest');
  }
  if (digestReviewMaterial(material.evidence) !== run.evidenceDigest) {
    throw new DomainValidationError('evidence', 'evidence material does not match run evidenceDigest');
  }
  return {
    reviewRunId: requireStableIdentifier(run.id, 'reviewRunId'),
    packetDigest: requireDigest(run.packetDigest, 'packetDigest'),
    source: material.source,
    evidence: material.evidence,
    invariantIds: requireStringList(material.invariantIds, 'invariantIds').map((id, index) =>
      requireStableIdentifier(id, `invariantIds[${index}]`)
    )
  };
}
export function createReviewFinding(input: CreateReviewFindingInput): ReviewFinding {
  return {
    id: requireStableIdentifier(input.id, 'id'),
    reviewRunId: requireStableIdentifier(input.reviewRunId, 'reviewRunId'),
    reviewerAssignmentId: requireStableIdentifier(input.reviewerAssignmentId, 'reviewerAssignmentId'),
    severity: requireSeverity(input.severity),
    category: requireStableIdentifier(input.category, 'category'),
    summary: requireNonBlank(input.summary, 'summary'),
    evidenceReferences: requireStringList(input.evidenceReferences, 'evidenceReferences'),
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}

export function createFindingAdjudication(input: FindingAdjudication): FindingAdjudication {
  const evidenceReferences = requireStringList(input.evidenceReferences, 'evidenceReferences');
  if (evidenceReferences.length === 0) {
    throw new DomainValidationError('evidenceReferences', 'adjudication requires evidence');
  }
  return {
    id: requireStableIdentifier(input.id, 'id'),
    findingId: requireStableIdentifier(input.findingId, 'findingId'),
    reviewRunId: requireStableIdentifier(input.reviewRunId, 'reviewRunId'),
    status: requireAdjudicationStatus(input.status),
    rationale: requireNonBlank(input.rationale, 'rationale'),
    evidenceReferences,
    adjudicatedBy: requireNonBlank(input.adjudicatedBy, 'adjudicatedBy'),
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}
export function createReviewerRechallenge(input: {
  id: string;
  reviewRunId: string;
  findingId: string;
  reviewerAssignmentId: string;
  adjudicationStatus: FindingAdjudicationStatus;
  promptDigest: string;
  createdAt: Date;
}): ReviewerRechallenge {
  if (input.adjudicationStatus !== 'REJECTED' && input.adjudicationStatus !== 'PARTIALLY_VALID') {
    throw new DomainValidationError(
      'adjudicationStatus',
      'rechallenge is allowed only for rejected or partially-valid findings'
    );
  }
  return {
    id: requireStableIdentifier(input.id, 'id'),
    reviewRunId: requireStableIdentifier(input.reviewRunId, 'reviewRunId'),
    findingId: requireStableIdentifier(input.findingId, 'findingId'),
    reviewerAssignmentId: requireStableIdentifier(input.reviewerAssignmentId, 'reviewerAssignmentId'),
    adjudicationStatus: input.adjudicationStatus,
    promptDigest: requireDigest(input.promptDigest, 'promptDigest'),
    visibility: 'private_original_reviewer',
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}
export function createCalibrationSnapshot(input: CalibrationSnapshot): CalibrationSnapshot {
  if (!Number.isInteger(input.sampleSize) || input.sampleSize <= 0) {
    throw new DomainValidationError('sampleSize', 'sampleSize must be a positive integer');
  }
  return {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    routeId: requireStableIdentifier(input.routeId, 'routeId'),
    modelId: requireStableIdentifier(input.modelId, 'modelId'),
    modelVersion: requireNonBlank(input.modelVersion, 'modelVersion'),
    sampleSize: input.sampleSize,
    usefulFindingRate: requireRatio(input.usefulFindingRate, 'usefulFindingRate'),
    falsePositiveRate: requireRatio(input.falsePositiveRate, 'falsePositiveRate'),
    availabilityRate: requireRatio(input.availabilityRate, 'availabilityRate'),
    medianLatencyMs: requireNonNegativeNumber(input.medianLatencyMs, 'medianLatencyMs'),
    averageCostUsd: requireNonNegativeNumber(input.averageCostUsd, 'averageCostUsd'),
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}

export function createArchitectureInvariant(input: ArchitectureInvariant): ArchitectureInvariant {
  const severity = requireSeverity(input.severity);
  if (severity !== 'critical' && severity !== 'important') {
    throw new DomainValidationError('severity', 'architecture invariant severity must be critical or important');
  }
  return {
    id: requireStableIdentifier(input.id, 'id'),
    key: requireStableIdentifier(input.key, 'key'),
    description: requireNonBlank(input.description, 'description'),
    severity,
    createdAt: requireDate(input.createdAt, 'createdAt')
  };
}

export function evaluateReviewGate(
  findings: ReviewFinding[],
  adjudications: FindingAdjudication[]
): ReviewGateResult {
  const latestByFinding = new Map<string, FindingAdjudication>();
  for (const adjudication of adjudications) {
    const normalized = createFindingAdjudication(adjudication);
    const existing = latestByFinding.get(normalized.findingId);
    if (!existing || existing.createdAt.getTime() <= normalized.createdAt.getTime()) {
      latestByFinding.set(normalized.findingId, normalized);
    }
  }

  const blockingFindingIds = findings
    .map(createReviewFinding)
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'important')
    .filter((finding) => {
      const adjudication = latestByFinding.get(finding.id);
      return adjudication?.reviewRunId === finding.reviewRunId &&
        (adjudication.status === 'CONFIRMED' || adjudication.status === 'PARTIALLY_VALID');
    })
    .map((finding) => finding.id)
    .sort();

  return { status: blockingFindingIds.length > 0 ? 'blocked' : 'clear', blockingFindingIds };
}
export function invalidateReviewRunForSource(
  run: ReviewRun,
  replacementSourceDigest: string,
  invalidatedAt: Date
): ReviewRun {
  const nextDigest = requireDigest(replacementSourceDigest, 'replacementSourceDigest');
  if (nextDigest === run.sourceDigest) {
    throw new DomainValidationError(
      'replacementSourceDigest',
      'replacement source digest must differ from the reviewed source'
    );
  }
  return {
    ...run,
    status: 'invalidated',
    invalidatedAt: requireDate(invalidatedAt, 'invalidatedAt'),
    invalidatedBySourceDigest: nextDigest
  };
}

export type ReviewerOutcomeInput =
  | { kind: 'completed'; content: string }
  | { kind: 'timeout' }
  | { kind: 'malformed'; detail?: string };

export type ReviewerOutcome =
  | { status: 'completed'; content: string }
  | { status: 'availability_failure'; reason: 'empty_output' | 'timeout' | 'malformed_output' };
export function classifyReviewerOutcome(input: ReviewerOutcomeInput): ReviewerOutcome {
  if (input.kind === 'timeout') {
    return { status: 'availability_failure', reason: 'timeout' };
  }
  if (input.kind === 'malformed') {
    return { status: 'availability_failure', reason: 'malformed_output' };
  }
  const content = requireNonBlankOrEmpty(input.content);
  if (content.length === 0) {
    return { status: 'availability_failure', reason: 'empty_output' };
  }
  return { status: 'completed', content };
}

function requireNonBlankOrEmpty(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError('content', 'content must be a string');
  }
  return value.trim();
}
