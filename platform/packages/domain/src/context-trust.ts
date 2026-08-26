import { DomainValidationError, requireNonBlank } from './validation.js';

export const CONTEXT_TRUST_CLASSES = [
  'canonical',
  'authoritative_external',
  'directly_observed',
  'derived',
  'user_asserted',
  'agent_generated',
  'historical',
  'untrusted',
] as const;
export type ContextTrustClass = (typeof CONTEXT_TRUST_CLASSES)[number];

export const CONTEXT_SOURCE_TYPES = [
  'platform', 'repository', 'runtime', 'database', 'ci', 'deployment',
  'memory', 'user', 'agent', 'external', 'document', 'tool',
] as const;
export type ContextSourceType = (typeof CONTEXT_SOURCE_TYPES)[number];

export interface CreateContextProvenanceInput {
  trustClass: ContextTrustClass;
  sourceType: ContextSourceType;
  sourceRef?: string;
  observedAt: Date;
  instructionBearing?: boolean;
}

export interface ContextProvenance {
  trustClass: ContextTrustClass;
  sourceType: ContextSourceType;
  sourceRef?: string;
  observedAt: Date;
  instructionBearing: boolean;
}

export interface ContextObservation<T> {
  value: T;
  provenance: ContextProvenance;
  deterministic: boolean;
  direct: boolean;
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

function requireObservedAt(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError('observedAt', 'observedAt must be a valid Date');
  }
  return new Date(value.getTime());
}

export function createContextProvenance(input: CreateContextProvenanceInput): ContextProvenance {
  const trustClass = requireEnum(input.trustClass, CONTEXT_TRUST_CLASSES, 'trustClass');
  const sourceType = requireEnum(input.sourceType, CONTEXT_SOURCE_TYPES, 'sourceType');
  const instructionBearing = input.instructionBearing ?? false;
  if (typeof instructionBearing !== 'boolean') {
    throw new DomainValidationError('instructionBearing', 'instructionBearing must be boolean');
  }
  if (instructionBearing && trustClass !== 'canonical' && trustClass !== 'user_asserted') {
    throw new DomainValidationError(
      'instructionBearing',
      'only canonical or explicitly user-asserted context may be instruction-bearing',
    );
  }
  if (instructionBearing && sourceType !== 'platform' && sourceType !== 'user') {
    throw new DomainValidationError(
      'instructionBearing',
      'instruction-bearing context must originate from platform or user authority',
    );
  }

  const provenance: ContextProvenance = {
    trustClass,
    sourceType,
    observedAt: requireObservedAt(input.observedAt),
    instructionBearing,
  };
  if (input.sourceRef !== undefined) {
    provenance.sourceRef = requireNonBlank(input.sourceRef, 'sourceRef');
  }
  return provenance;
}

export function contextCanProveCurrentState(provenance: ContextProvenance): boolean {
  return provenance.trustClass === 'canonical'
    || provenance.trustClass === 'authoritative_external'
    || provenance.trustClass === 'directly_observed';
}

const TRUST_SCORE: Record<ContextTrustClass, number> = {
  canonical: 800,
  directly_observed: 760,
  authoritative_external: 720,
  user_asserted: 500,
  derived: 400,
  historical: 250,
  agent_generated: 150,
  untrusted: 0,
};

export function selectBestContextObservation<T>(
  observations: readonly ContextObservation<T>[],
): ContextObservation<T> | undefined {
  if (observations.length === 0) return undefined;
  return [...observations].sort((left, right) => {
    const leftScore = TRUST_SCORE[left.provenance.trustClass]
      + (left.deterministic ? 80 : 0)
      + (left.direct ? 60 : 0);
    const rightScore = TRUST_SCORE[right.provenance.trustClass]
      + (right.deterministic ? 80 : 0)
      + (right.direct ? 60 : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return right.provenance.observedAt.getTime() - left.provenance.observedAt.getTime();
  })[0];
}
