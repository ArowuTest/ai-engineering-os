import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const ENGINEERING_RECOVERY_CHECKPOINT_SCHEMA = 'engineering_recovery_checkpoint_v1' as const;

export const ENGINEERING_RECOVERY_REASONS = [
  'source_mutation',
  'verification_gate',
  'accepted_commit',
  'execution_transition',
  'handoff',
  'council',
  'environment_suspend',
  'deployment',
  'manual',
] as const;
export type EngineeringRecoveryReason = (typeof ENGINEERING_RECOVERY_REASONS)[number];

export interface EngineeringSourceRevisionObservation {
  branch?: string;
  commit?: string;
  dirty?: boolean;
  dirtyDigest?: string;
}

export interface EngineeringExecutionSelectionSnapshot {
  agentId: string;
  harnessId?: string;
  modelRouteId?: string;
  runnerId?: string;
  environmentId?: string;
}

export interface EngineeringRecoveryCheckpoint {
  schema: typeof ENGINEERING_RECOVERY_CHECKPOINT_SCHEMA;
  reason: EngineeringRecoveryReason;
  objective: string;
  currentPhase?: string;
  lastAcceptedBoundary?: string;
  evidenceReferences: string[];
  blockers: string[];
  nextActions: string[];
  sourceRevision?: EngineeringSourceRevisionObservation;
  execution: EngineeringExecutionSelectionSnapshot;
  observedAt: Date;
}

export interface ProjectContinuationContext {
  objective: string;
  activeTask: {
    taskId: string;
    sessionId: string;
    agentId: string;
    workstreamId?: string;
  };
  sourceRevision?: EngineeringSourceRevisionObservation;
  execution: EngineeringExecutionSelectionSnapshot;
  acceptanceState: { lastAcceptedBoundary?: string };
  evidenceReferences: string[];
  blockers: string[];
  pendingQuestions: string[];
  nextActions: string[];
  latestRecoveryCheckpointId: string;
  generatedAt: Date;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be supported`);
  }
  return value as T;
}

function safeList(values: readonly string[] | undefined, field: string, maxItems = 64): string[] {
  const result = (values ?? []).map((value, index) => requireNonBlank(value, `${field}[${index}]`));
  if (result.length > maxItems) throw new DomainValidationError(field, `${field} has too many items`);
  return result;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireNonBlank(value, field);
}

function sourceRevision(input: EngineeringSourceRevisionObservation | undefined): EngineeringSourceRevisionObservation | undefined {
  if (input === undefined) return undefined;
  const result: EngineeringSourceRevisionObservation = {};
  if (input.branch !== undefined) result.branch = requireNonBlank(input.branch, 'sourceRevision.branch');
  if (input.commit !== undefined) result.commit = requireNonBlank(input.commit, 'sourceRevision.commit');
  if (input.dirty !== undefined) {
    if (typeof input.dirty !== 'boolean') throw new DomainValidationError('sourceRevision.dirty', 'dirty must be boolean');
    result.dirty = input.dirty;
  }
  if (input.dirtyDigest !== undefined) {
    if (!/^[a-f0-9]{64}$/i.test(input.dirtyDigest)) {
      throw new DomainValidationError('sourceRevision.dirtyDigest', 'dirtyDigest must be a SHA-256 digest');
    }
    result.dirtyDigest = input.dirtyDigest.toLowerCase();
  }
  return result;
}

function execution(input: EngineeringExecutionSelectionSnapshot): EngineeringExecutionSelectionSnapshot {
  const result: EngineeringExecutionSelectionSnapshot = {
    agentId: requireStableIdentifier(input.agentId, 'execution.agentId'),
  };
  for (const [key, value] of [
    ['harnessId', input.harnessId],
    ['modelRouteId', input.modelRouteId],
    ['runnerId', input.runnerId],
    ['environmentId', input.environmentId],
  ] as const) {
    if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = requireStableIdentifier(value, `execution.${key}`);
  }
  return result;
}

export function createEngineeringRecoveryCheckpoint(input: Omit<EngineeringRecoveryCheckpoint, 'schema'>): EngineeringRecoveryCheckpoint {
  if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) {
    throw new DomainValidationError('observedAt', 'observedAt must be a valid Date');
  }
  const result: EngineeringRecoveryCheckpoint = {
    schema: ENGINEERING_RECOVERY_CHECKPOINT_SCHEMA,
    reason: enumValue(input.reason, ENGINEERING_RECOVERY_REASONS, 'reason'),
    objective: requireNonBlank(input.objective, 'objective'),
    evidenceReferences: safeList(input.evidenceReferences, 'evidenceReferences'),
    blockers: safeList(input.blockers, 'blockers'),
    nextActions: safeList(input.nextActions, 'nextActions'),
    execution: execution(input.execution),
    observedAt: new Date(input.observedAt.getTime()),
  };
  const phase = optionalText(input.currentPhase, 'currentPhase');
  if (phase !== undefined) result.currentPhase = phase;
  const boundary = optionalText(input.lastAcceptedBoundary, 'lastAcceptedBoundary');
  if (boundary !== undefined) result.lastAcceptedBoundary = boundary;
  const revision = sourceRevision(input.sourceRevision);
  if (revision !== undefined) result.sourceRevision = revision;
  return result;
}

export function serializeEngineeringRecoveryCheckpoint(checkpoint: EngineeringRecoveryCheckpoint): string {
  return JSON.stringify({ ...checkpoint, observedAt: checkpoint.observedAt.toISOString() });
}

export function parseEngineeringRecoveryCheckpoint(content: string): EngineeringRecoveryCheckpoint {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new DomainValidationError('content', 'recovery checkpoint content must be valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new DomainValidationError('content', 'recovery checkpoint content must be an object');
  const value = raw as Record<string, unknown>;
  if (value.schema !== ENGINEERING_RECOVERY_CHECKPOINT_SCHEMA) throw new DomainValidationError('schema', 'unsupported recovery checkpoint schema');
  const observedAt = new Date(String(value.observedAt ?? ''));
  return createEngineeringRecoveryCheckpoint({
    reason: value.reason as EngineeringRecoveryReason,
    objective: value.objective as string,
    ...(value.currentPhase === undefined ? {} : { currentPhase: value.currentPhase as string }),
    ...(value.lastAcceptedBoundary === undefined ? {} : {
      lastAcceptedBoundary: value.lastAcceptedBoundary as string,
    }),
    evidenceReferences: Array.isArray(value.evidenceReferences) ? value.evidenceReferences as string[] : [],
    blockers: Array.isArray(value.blockers) ? value.blockers as string[] : [],
    nextActions: Array.isArray(value.nextActions) ? value.nextActions as string[] : [],
    ...(value.sourceRevision === undefined ? {} : {
      sourceRevision: value.sourceRevision as EngineeringSourceRevisionObservation,
    }),
    execution: value.execution as EngineeringExecutionSelectionSnapshot,
    observedAt,
  });
}
