import type { ContextProvenance } from './context-trust.js';
import { assertSensitiveTextSafe, DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const EVIDENCE_KINDS = [
  'execution', 'state_observation', 'review', 'test', 'security', 'accessibility', 'decision',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_STATUSES = ['pass', 'fail', 'info', 'unknown'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_CONNECTION_OWNER_TYPES = ['platform', 'organisation', 'team', 'user'] as const;
export type EvidenceConnectionOwnerType = (typeof EVIDENCE_CONNECTION_OWNER_TYPES)[number];

export interface EvidenceConnectionAttribution {
  id: string;
  ownerType: EvidenceConnectionOwnerType;
  ownerId?: string;
}

export interface EvidenceUsageAttribution {
  inputTokens?: number;
  outputTokens?: number;
}

export interface EvidenceExecutionAttribution {
  requesterUserId?: string;
  agentId?: string;
  capabilityIds?: string[];
  providerId?: string;
  modelId?: string;
  routeId?: string;
  connection?: EvidenceConnectionAttribution;
  harnessId?: string;
  runnerId?: string;
  environmentId?: string;
  entitlementRef?: string;
  budgetRef?: string;
  usage?: EvidenceUsageAttribution;
  costType?: string;
  costReference?: string;
}

export interface CreateEvidenceEnvelopeInput {
  id: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  source: string;
  summary: string;
  provenance: ContextProvenance;
  organisationId?: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  subjectType: string;
  subjectId: string;
  attribution?: EvidenceExecutionAttribution;
  payloadDigest?: string;
}

export interface EvidenceEnvelope extends CreateEvidenceEnvelopeInput {
  attribution?: EvidenceExecutionAttribution;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

function safeText(value: unknown, field: string, maxLength = 4096): string {
  const normalized = requireNonBlank(value, field);
  if (normalized.length > maxLength) throw new DomainValidationError(field, `${field} is too long`);
  assertSensitiveTextSafe(normalized, field);
  if (/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}/i.test(normalized)) {
    throw new DomainValidationError(field, `${field} must not contain secret or credential material`);
  }
  return normalized;
}

function optionalStable(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireStableIdentifier(value, field);
}

function optionalSafe(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : safeText(value, field, 2048);
}

function usage(input: EvidenceUsageAttribution | undefined): EvidenceUsageAttribution | undefined {
  if (input === undefined) return undefined;
  const result: EvidenceUsageAttribution = {};
  for (const [key, value] of [['inputTokens', input.inputTokens], ['outputTokens', input.outputTokens]] as const) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DomainValidationError(`attribution.usage.${key}`, `${key} must be a non-negative safe integer`);
    }
    result[key] = value;
  }
  return result;
}

function connection(input: EvidenceConnectionAttribution | undefined): EvidenceConnectionAttribution | undefined {
  if (input === undefined) return undefined;
  const result: EvidenceConnectionAttribution = {
    id: requireStableIdentifier(input.id, 'attribution.connection.id'),
    ownerType: requireEnum(input.ownerType, EVIDENCE_CONNECTION_OWNER_TYPES, 'attribution.connection.ownerType'),
  };
  if (input.ownerId !== undefined) result.ownerId = requireStableIdentifier(input.ownerId, 'attribution.connection.ownerId');
  return result;
}

function attribution(input: EvidenceExecutionAttribution | undefined): EvidenceExecutionAttribution | undefined {
  if (input === undefined) return undefined;
  const result: EvidenceExecutionAttribution = {};
  const stableFields = [
    ['requesterUserId', input.requesterUserId],
    ['agentId', input.agentId],
    ['providerId', input.providerId],
    ['routeId', input.routeId],
    ['harnessId', input.harnessId],
    ['runnerId', input.runnerId],
    ['environmentId', input.environmentId],
  ] as const;
  for (const [key, value] of stableFields) {
    const normalized = optionalStable(value, `attribution.${key}`);
    if (normalized !== undefined) (result as unknown as Record<string, unknown>)[key] = normalized;
  }
  const safeFields = [
    ['modelId', input.modelId],
    ['entitlementRef', input.entitlementRef],
    ['budgetRef', input.budgetRef],
    ['costType', input.costType],
    ['costReference', input.costReference],
  ] as const;
  for (const [key, value] of safeFields) {
    const normalized = optionalSafe(value, `attribution.${key}`);
    if (normalized !== undefined) (result as unknown as Record<string, unknown>)[key] = normalized;
  }
  if (input.capabilityIds !== undefined) {
    const ids = input.capabilityIds.map((value, index) => requireStableIdentifier(value, `attribution.capabilityIds[${index}]`));
    if (new Set(ids).size !== ids.length) throw new DomainValidationError('attribution.capabilityIds', 'capabilityIds must not contain duplicates');
    result.capabilityIds = ids;
  }
  const normalizedConnection = connection(input.connection);
  if (normalizedConnection !== undefined) result.connection = normalizedConnection;
  const normalizedUsage = usage(input.usage);
  if (normalizedUsage !== undefined) result.usage = normalizedUsage;
  return result;
}

export function createEvidenceEnvelope(input: CreateEvidenceEnvelopeInput): EvidenceEnvelope {
  if (input.provenance.instructionBearing) {
    throw new DomainValidationError('provenance', 'evidence provenance must never be instruction-bearing');
  }
  const result: EvidenceEnvelope = {
    id: requireStableIdentifier(input.id, 'id'),
    kind: requireEnum(input.kind, EVIDENCE_KINDS, 'kind'),
    status: requireEnum(input.status, EVIDENCE_STATUSES, 'status'),
    source: requireStableIdentifier(input.source, 'source'),
    summary: safeText(input.summary, 'summary'),
    provenance: input.provenance,
    subjectType: requireStableIdentifier(input.subjectType, 'subjectType'),
    subjectId: requireStableIdentifier(input.subjectId, 'subjectId'),
  };
  for (const [key, value] of [
    ['organisationId', input.organisationId], ['projectId', input.projectId],
    ['taskId', input.taskId], ['sessionId', input.sessionId],
  ] as const) {
    const normalized = optionalStable(value, key);
    if (normalized !== undefined) (result as unknown as Record<string, unknown>)[key] = normalized;
  }
  const normalizedAttribution = attribution(input.attribution);
  if (normalizedAttribution !== undefined) result.attribution = normalizedAttribution;
  if (input.payloadDigest !== undefined) {
    if (!SHA256_PATTERN.test(input.payloadDigest)) throw new DomainValidationError('payloadDigest', 'payloadDigest must be a lowercase SHA-256 digest');
    result.payloadDigest = input.payloadDigest;
  }
  return result;
}
