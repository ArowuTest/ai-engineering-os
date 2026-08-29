import type { EvidenceEnvelope } from './evidence-envelope.js';
import type { RuntimeCapabilityManifest } from './runtime-capability-manifest.js';
import { assertSensitiveTextSafe, DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const REVIEW_GATE_STATUSES = ['pass', 'fail', 'info', 'unknown'] as const;
export type ReviewGateStatus = (typeof REVIEW_GATE_STATUSES)[number];

export interface ReviewGateObservation {
  id: string;
  status: ReviewGateStatus;
  sourceRef?: string;
  summary?: string;
}

export interface ReviewSourceSealObservation {
  commit?: string;
  tree?: string;
  dirty?: boolean;
  diffDigest?: string;
}

export interface ReviewCouncilEvidenceMaterialInput {
  sourceSeal?: ReviewSourceSealObservation;
  gates: readonly ReviewGateObservation[];
  runtimeCapabilities?: readonly RuntimeCapabilityManifest[];
  executionEvidence?: readonly EvidenceEnvelope[];
  requirementsReferences?: readonly string[];
  acceptanceCriteria?: readonly string[];
  collectedAt: Date;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError('collectedAt', 'collectedAt must be a valid Date');
  }
  return new Date(value.getTime());
}

function safeText(value: unknown, field: string, max = 4096): string {
  const normalized = requireNonBlank(value, field);
  if (normalized.length > max) throw new DomainValidationError(field, `${field} is too long`);
  assertSensitiveTextSafe(normalized, field);
  return normalized;
}

function optionalSafe(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : safeText(value, field);
}

function digest(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new DomainValidationError(field, `${field} must be a SHA-256 digest`);
  }
  return value.toLowerCase();
}

function normalizeStringList(values: readonly string[] | undefined, field: string): string[] {
  const items = (values ?? []).map((value, index) => safeText(value, `${field}[${index}]`, 2048));
  return [...new Set(items)].sort();
}

function normalizeGates(gates: readonly ReviewGateObservation[]): ReviewGateObservation[] {
  const seen = new Set<string>();
  return gates.map((gate, index) => {
    const id = requireStableIdentifier(gate.id, `gates[${index}].id`);
    if (seen.has(id)) throw new DomainValidationError('gates', `duplicate gate id: ${id}`);
    seen.add(id);
    if (!REVIEW_GATE_STATUSES.includes(gate.status)) {
      throw new DomainValidationError(`gates[${index}].status`, 'gate status must be supported');
    }
    const result: ReviewGateObservation = { id, status: gate.status };
    const sourceRef = optionalSafe(gate.sourceRef, `gates[${index}].sourceRef`);
    if (sourceRef !== undefined) result.sourceRef = sourceRef;
    const summary = optionalSafe(gate.summary, `gates[${index}].summary`);
    if (summary !== undefined) result.summary = summary;
    return result;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeSourceSeal(input: ReviewSourceSealObservation | undefined) {
  if (input === undefined) return undefined;
  const result: ReviewSourceSealObservation = {};
  if (input.commit !== undefined) result.commit = safeText(input.commit, 'sourceSeal.commit', 256);
  if (input.tree !== undefined) result.tree = safeText(input.tree, 'sourceSeal.tree', 256);
  if (input.dirty !== undefined) {
    if (typeof input.dirty !== 'boolean') throw new DomainValidationError('sourceSeal.dirty', 'dirty must be boolean');
    result.dirty = input.dirty;
  }
  const diffDigest = digest(input.diffDigest, 'sourceSeal.diffDigest');
  if (diffDigest !== undefined) result.diffDigest = diffDigest;
  return result;
}

export function buildReviewCouncilEvidenceMaterial(input: ReviewCouncilEvidenceMaterialInput): string {
  const collectedAt = requireDate(input.collectedAt);
  const sourceSeal = normalizeSourceSeal(input.sourceSeal);
  const gates = normalizeGates(input.gates);
  const runtimeCapabilities = [...(input.runtimeCapabilities ?? [])]
    .sort((left, right) => `${left.runnerId ?? ''}:${left.environmentId ?? ''}:${left.observedAt.toISOString()}`
      .localeCompare(`${right.runnerId ?? ''}:${right.environmentId ?? ''}:${right.observedAt.toISOString()}`));
  const executionEvidence = [...(input.executionEvidence ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  const material = {
    schema: 'review_council_evidence_material_v1',
    collectedAt: collectedAt.toISOString(),
    ...(sourceSeal === undefined ? {} : { sourceSeal }),
    gates,
    runtimeCapabilities,
    executionEvidence,
    requirementsReferences: normalizeStringList(input.requirementsReferences, 'requirementsReferences'),
    acceptanceCriteria: normalizeStringList(input.acceptanceCriteria, 'acceptanceCriteria'),
  };
  const encoded = JSON.stringify(material);
  assertSensitiveTextSafe(encoded, 'reviewCouncilEvidenceMaterial');
  return encoded;
}
