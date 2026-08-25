import {
  assertSensitiveTextSafe,
  DomainValidationError,
  requireNonBlank,
  requireStableIdentifier,
} from './validation.js';

export const ASSURANCE_SEVERITIES = ['critical', 'important', 'minor', 'observation'] as const;
export type AssuranceSeverity = (typeof ASSURANCE_SEVERITIES)[number];

export const ASSURANCE_FINDING_KINDS = [
  'missing_requirement', 'ambiguity', 'contradiction', 'edge_case', 'failure_mode',
  'non_functional_gap', 'security_risk', 'operational_gap', 'unresolved_assumption',
  'research_required', 'recommendation',
] as const;
export type AssuranceFindingKind = (typeof ASSURANCE_FINDING_KINDS)[number];

export const ASSURANCE_FINDING_BASES = ['project_evidence', 'trained_knowledge', 'external_research'] as const;
export type AssuranceFindingBasis = (typeof ASSURANCE_FINDING_BASES)[number];
export type AssuranceFindingStatus = 'open' | 'resolved' | 'dismissed';
export const ASSURANCE_AVAILABILITY_REASONS = [
  'timeout', 'provider_failure', 'empty_output', 'malformed_output',
] as const;
export type AssuranceAvailabilityReason = (typeof ASSURANCE_AVAILABILITY_REASONS)[number];
export type AssuranceRunStatus = 'collecting' | 'completed' | 'availability_failure' | 'invalidated';

export interface AssuranceRun {
  id: string;
  organisationId: string;
  projectId: string;
  profileId: string;
  targetType: string;
  targetDigest: string;
  reviewerAgentCapabilityId: string;
  reviewerRouteId: string;
  status: AssuranceRunStatus;
  createdBy: string;
  createdAt: Date;
  completedAt?: Date;
  availabilityFailedAt?: Date;
  availabilityReason?: AssuranceAvailabilityReason;
  invalidatedAt?: Date;
  invalidatedByTargetDigest?: string;
}

export type CreateAssuranceRunInput = Omit<
  AssuranceRun,
  'status' | 'completedAt' | 'availabilityFailedAt' | 'availabilityReason'
    | 'invalidatedAt' | 'invalidatedByTargetDigest'
>;

export interface AssuranceFinding {
  id: string;
  assuranceRunId: string;
  severity: AssuranceSeverity;
  kind: AssuranceFindingKind;
  category: string;
  summary: string;
  rationale: string;
  proposedQuestion?: string;
  suggestedDirection?: string;
  basis: AssuranceFindingBasis;
  evidenceReferences: string[];
  status: AssuranceFindingStatus;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
}

export type CreateAssuranceFindingInput = Omit<
  AssuranceFinding,
  'status' | 'resolvedAt' | 'resolvedBy' | 'resolutionNote'
>;

export type AssuranceReadiness = {
  status: 'ready' | 'not_ready' | 'insufficient_evidence';
  blockingFindingIds: string[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TEXT_LENGTH = 16_384;
const MAX_EVIDENCE_REFERENCES = 64;

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

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

function requireSafeText(value: unknown, field: string): string {
  const normalized = requireNonBlank(value, field);
  if (normalized.length > MAX_TEXT_LENGTH) throw new DomainValidationError(field, `${field} is too long`);
  assertSensitiveTextSafe(normalized, field);
  return normalized;
}

function requireEvidenceReferences(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFERENCES) {
    throw new DomainValidationError('evidenceReferences', `evidenceReferences must contain at most ${MAX_EVIDENCE_REFERENCES} items`);
  }
  const normalized = value.map((entry, index) => {
    const reference = requireNonBlank(entry, `evidenceReferences[${index}]`);
    if (reference.length > 2048) throw new DomainValidationError(`evidenceReferences[${index}]`, 'evidence reference is too long');
    return reference;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new DomainValidationError('evidenceReferences', 'evidenceReferences must not contain duplicates');
  }
  return normalized;
}

export function createAssuranceRun(input: CreateAssuranceRunInput): AssuranceRun {
  return {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    projectId: requireStableIdentifier(input.projectId, 'projectId'),
    profileId: requireStableIdentifier(input.profileId, 'profileId'),
    targetType: requireStableIdentifier(input.targetType, 'targetType'),
    targetDigest: requireDigest(input.targetDigest, 'targetDigest'),
    reviewerAgentCapabilityId: requireStableIdentifier(input.reviewerAgentCapabilityId, 'reviewerAgentCapabilityId'),
    reviewerRouteId: requireStableIdentifier(input.reviewerRouteId, 'reviewerRouteId'),
    status: 'collecting',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: requireDate(input.createdAt, 'createdAt'),
  };
}

export function createAssuranceFinding(input: CreateAssuranceFindingInput): AssuranceFinding {
  const finding: AssuranceFinding = {
    id: requireStableIdentifier(input.id, 'id'),
    assuranceRunId: requireStableIdentifier(input.assuranceRunId, 'assuranceRunId'),
    severity: requireEnum(input.severity, 'severity', ASSURANCE_SEVERITIES),
    kind: requireEnum(input.kind, 'kind', ASSURANCE_FINDING_KINDS),
    category: requireStableIdentifier(input.category, 'category'),
    summary: requireSafeText(input.summary, 'summary'),
    rationale: requireSafeText(input.rationale, 'rationale'),
    basis: requireEnum(input.basis, 'basis', ASSURANCE_FINDING_BASES),
    evidenceReferences: requireEvidenceReferences(input.evidenceReferences),
    status: 'open',
    createdAt: requireDate(input.createdAt, 'createdAt'),
  };
  if (input.proposedQuestion !== undefined) {
    finding.proposedQuestion = requireSafeText(input.proposedQuestion, 'proposedQuestion');
  }
  if (input.suggestedDirection !== undefined) {
    finding.suggestedDirection = requireSafeText(input.suggestedDirection, 'suggestedDirection');
  }
  return finding;
}

export function closeAssuranceFinding(
  finding: AssuranceFinding,
  input: {
    status: 'resolved' | 'dismissed';
    resolvedBy: string;
    resolutionNote: string;
    resolvedAt: Date;
  },
): AssuranceFinding {
  if (finding.status !== 'open') {
    throw new DomainValidationError('status', 'only an open assurance finding can be closed');
  }
  return {
    ...finding,
    status: requireEnum(input.status, 'status', ['resolved', 'dismissed'] as const),
    resolvedBy: requireNonBlank(input.resolvedBy, 'resolvedBy'),
    resolutionNote: requireSafeText(input.resolutionNote, 'resolutionNote'),
    resolvedAt: requireDate(input.resolvedAt, 'resolvedAt'),
  };
}

export function evaluateAssuranceReadiness(
  run: AssuranceRun,
  findings: AssuranceFinding[],
  evidence: { reviewerCompleted: boolean },
): AssuranceReadiness {
  if (run.status === 'invalidated' || !evidence.reviewerCompleted) {
    return { status: 'insufficient_evidence', blockingFindingIds: [] };
  }
  const blockingFindingIds = findings
    .filter((finding) => finding.assuranceRunId === run.id && finding.status === 'open')
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'important')
    .map((finding) => finding.id)
    .sort();
  return blockingFindingIds.length > 0
    ? { status: 'not_ready', blockingFindingIds }
    : { status: 'ready', blockingFindingIds: [] };
}

export function markAssuranceRunAvailabilityFailure(
  run: AssuranceRun,
  reason: AssuranceAvailabilityReason,
  failedAt: Date,
): AssuranceRun {
  if (run.status !== 'collecting') {
    throw new DomainValidationError('status', 'only a collecting assurance run can record availability failure');
  }
  return {
    ...run,
    status: 'availability_failure',
    availabilityReason: requireEnum(reason, 'availabilityReason', ASSURANCE_AVAILABILITY_REASONS),
    availabilityFailedAt: requireDate(failedAt, 'availabilityFailedAt'),
  };
}

export function invalidateAssuranceRunForTarget(
  run: AssuranceRun,
  replacementTargetDigest: string,
  invalidatedAt: Date,
): AssuranceRun {
  const digest = requireDigest(replacementTargetDigest, 'replacementTargetDigest');
  if (digest === run.targetDigest) {
    throw new DomainValidationError('replacementTargetDigest', 'replacement target digest must differ from reviewed target');
  }
  return {
    ...run,
    status: 'invalidated',
    invalidatedAt: requireDate(invalidatedAt, 'invalidatedAt'),
    invalidatedByTargetDigest: digest,
  };
}
