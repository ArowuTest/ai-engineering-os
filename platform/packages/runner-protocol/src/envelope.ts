import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import {
  STABLE_IDENTIFIER_PATTERN,
  validateRunnerTaskEnvelope,
  type RunnerTaskEnvelope,
} from '@engineering-os/domain';

export const RUNNER_TASK_ENVELOPE_VERSION = 'engineering-os.runner-task.v1';

export interface RunnerTaskPayload {
  objective: string;
  contextReferences: string[];
  requiredCapabilities: string[];
}

export interface RunnerTaskDispatch {
  dispatchId: string;
  runnerId: string;
  requesterUserId: string;
  attempt: number;
  idempotencyKey: string;
  taskEnvelope: RunnerTaskEnvelope;
  payload: RunnerTaskPayload;
}

export interface RunnerTaskEnvelopeWire {
  id: string;
  organisationId: string;
  projectId: string;
  taskId: string;
  connectionId: string;
  routeId: string;
  harnessId: string;
  allowedOperations: string[];
  workspaceScope: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface SignedRunnerTaskEnvelope {
  schemaVersion: typeof RUNNER_TASK_ENVELOPE_VERSION;
  dispatchId: string;
  runnerId: string;
  requesterUserId: string;
  attempt: number;
  idempotencyKey: string;
  taskEnvelope: RunnerTaskEnvelopeWire;
  payload: RunnerTaskPayload;
  payloadDigest: string;
  signatureAlgorithm: 'ed25519';
  signature: string;
}

export type RunnerEnvelopeVerificationFailureReason =
  | 'invalid_envelope'
  | 'payload_digest_mismatch'
  | 'invalid_signature'
  | 'not_yet_valid'
  | 'expired'
  | 'runner_mismatch'
  | 'dispatch_mismatch';

export type RunnerEnvelopeVerificationResult =
  | { ok: true; value: RunnerTaskDispatch }
  | { ok: false; reason: RunnerEnvelopeVerificationFailureReason };

export interface VerifyRunnerTaskEnvelopeOptions {
  now?: Date;
  expectedRunnerId?: string;
  expectedDispatchId?: string;
}

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'dispatchId',
  'runnerId',
  'requesterUserId',
  'attempt',
  'idempotencyKey',
  'taskEnvelope',
  'payload',
  'payloadDigest',
  'signatureAlgorithm',
  'signature',
] as const;

const TASK_ENVELOPE_KEYS = [
  'id',
  'organisationId',
  'projectId',
  'taskId',
  'connectionId',
  'routeId',
  'harnessId',
  'allowedOperations',
  'workspaceScope',
  'issuedAt',
  'expiresAt',
  'nonce',
] as const;

const PAYLOAD_KEYS = [
  'objective',
  'contextReferences',
  'requiredCapabilities',
] as const;

function requirePlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid_envelope: ${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`invalid_envelope: ${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`invalid_envelope: ${field} contains unexpected or missing fields`);
  }
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`invalid_envelope: ${field} must be a non-blank string`);
  }
  return value.trim();
}

function requireStableIdentifier(value: unknown, field: string): string {
  const normalized = requireNonBlank(value, field);
  if (!STABLE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`invalid_envelope: ${field} must be a stable identifier`);
  }
  return normalized;
}

function requireEd25519PrivateKey(key: KeyObject): void {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('privateKey must be an Ed25519 private key');
  }
}

function isEd25519PublicKey(key: KeyObject): boolean {
  return key.type === 'public' && key.asymmetricKeyType === 'ed25519';
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`invalid_envelope: ${field} must be a positive integer`);
  }
  return value as number;
}

function sortCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeStringArray(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`invalid_envelope: ${field} must be a${options.allowEmpty ? '' : ' non-empty'} array`);
  }
  const normalized = value.map((item, index) => requireNonBlank(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`invalid_envelope: ${field} must not contain duplicates`);
  }
  return [...normalized].sort(sortCodeUnits);
}

function normalizePayload(value: unknown): RunnerTaskPayload {
  const record = requirePlainRecord(value, 'payload');
  requireExactKeys(record, PAYLOAD_KEYS, 'payload');
  return {
    objective: requireNonBlank(record.objective, 'payload.objective'),
    contextReferences: normalizeStringArray(
      record.contextReferences,
      'payload.contextReferences',
      { allowEmpty: true },
    ),
    requiredCapabilities: normalizeStringArray(
      record.requiredCapabilities,
      'payload.requiredCapabilities',
    ),
  };
}

function normalizeTaskEnvelope(value: unknown): RunnerTaskEnvelopeWire {
  const record = requirePlainRecord(value, 'taskEnvelope');
  requireExactKeys(record, TASK_ENVELOPE_KEYS, 'taskEnvelope');
  const validated = validateRunnerTaskEnvelope(value as RunnerTaskEnvelope);
  return {
    id: validated.id,
    organisationId: validated.organisationId,
    projectId: validated.projectId,
    taskId: validated.taskId,
    connectionId: validated.connectionId,
    routeId: validated.routeId,
    harnessId: validated.harnessId,
    allowedOperations: [...validated.allowedOperations].sort(sortCodeUnits),
    workspaceScope: validated.workspaceScope,
    issuedAt: new Date(validated.issuedAt.getTime()).toISOString(),
    expiresAt: new Date(validated.expiresAt.getTime()).toISOString(),
    nonce: validated.nonce,
  };
}

function wireToDomain(value: RunnerTaskEnvelopeWire): RunnerTaskEnvelope {
  return validateRunnerTaskEnvelope({
    ...value,
    allowedOperations: [...value.allowedOperations],
    issuedAt: new Date(value.issuedAt),
    expiresAt: new Date(value.expiresAt),
  });
}

function normalizeWireTaskEnvelope(value: unknown): RunnerTaskEnvelopeWire {
  const record = requirePlainRecord(value, 'taskEnvelope');
  requireExactKeys(record, TASK_ENVELOPE_KEYS, 'taskEnvelope');
  const issuedAt = new Date(requireNonBlank(record.issuedAt, 'taskEnvelope.issuedAt'));
  const expiresAt = new Date(requireNonBlank(record.expiresAt, 'taskEnvelope.expiresAt'));
  const domain = validateRunnerTaskEnvelope({
    id: record.id,
    organisationId: record.organisationId,
    projectId: record.projectId,
    taskId: record.taskId,
    connectionId: record.connectionId,
    routeId: record.routeId,
    harnessId: record.harnessId,
    allowedOperations: record.allowedOperations,
    workspaceScope: record.workspaceScope,
    issuedAt,
    expiresAt,
    nonce: record.nonce,
  } as RunnerTaskEnvelope);
  return normalizeTaskEnvelope(domain);
}

export function digestRunnerTaskPayload(payload: RunnerTaskPayload): string {
  const normalized = normalizePayload(payload);
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

const DISPATCH_KEYS = [
  'dispatchId',
  'runnerId',
  'requesterUserId',
  'attempt',
  'idempotencyKey',
  'taskEnvelope',
  'payload',
] as const;

interface CanonicalRunnerTaskDispatch {
  dispatchId: string;
  runnerId: string;
  requesterUserId: string;
  attempt: number;
  idempotencyKey: string;
  taskEnvelope: RunnerTaskEnvelopeWire;
  payload: RunnerTaskPayload;
}

function normalizeDispatch(value: unknown): CanonicalRunnerTaskDispatch {
  const record = requirePlainRecord(value, 'dispatch');
  requireExactKeys(record, DISPATCH_KEYS, 'dispatch');
  return {
    dispatchId: requireStableIdentifier(record.dispatchId, 'dispatchId'),
    runnerId: requireStableIdentifier(record.runnerId, 'runnerId'),
    requesterUserId: requireStableIdentifier(record.requesterUserId, 'requesterUserId'),
    attempt: requirePositiveInteger(record.attempt, 'attempt'),
    idempotencyKey: requireStableIdentifier(record.idempotencyKey, 'idempotencyKey'),
    taskEnvelope: normalizeTaskEnvelope(record.taskEnvelope),
    payload: normalizePayload(record.payload),
  };
}

function buildCanonicalBuffer(envelope: Omit<SignedRunnerTaskEnvelope, 'signature'>): Buffer {
  const canonical = {
    schemaVersion: envelope.schemaVersion,
    dispatchId: envelope.dispatchId,
    runnerId: envelope.runnerId,
    requesterUserId: envelope.requesterUserId,
    attempt: envelope.attempt,
    idempotencyKey: envelope.idempotencyKey,
    taskEnvelope: {
      id: envelope.taskEnvelope.id,
      organisationId: envelope.taskEnvelope.organisationId,
      projectId: envelope.taskEnvelope.projectId,
      taskId: envelope.taskEnvelope.taskId,
      connectionId: envelope.taskEnvelope.connectionId,
      routeId: envelope.taskEnvelope.routeId,
      harnessId: envelope.taskEnvelope.harnessId,
      allowedOperations: envelope.taskEnvelope.allowedOperations,
      workspaceScope: envelope.taskEnvelope.workspaceScope,
      issuedAt: envelope.taskEnvelope.issuedAt,
      expiresAt: envelope.taskEnvelope.expiresAt,
      nonce: envelope.taskEnvelope.nonce,
    },
    payload: {
      objective: envelope.payload.objective,
      contextReferences: envelope.payload.contextReferences,
      requiredCapabilities: envelope.payload.requiredCapabilities,
    },
    payloadDigest: envelope.payloadDigest,
    signatureAlgorithm: envelope.signatureAlgorithm,
  };
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}

export function signRunnerTaskEnvelope(
  dispatch: RunnerTaskDispatch,
  privateKey: KeyObject,
): SignedRunnerTaskEnvelope {
  requireEd25519PrivateKey(privateKey);
  const normalized = normalizeDispatch(dispatch);
  const payloadDigest = digestRunnerTaskPayload(normalized.payload);
  const preSigned: Omit<SignedRunnerTaskEnvelope, 'signature'> = {
    schemaVersion: RUNNER_TASK_ENVELOPE_VERSION,
    dispatchId: normalized.dispatchId,
    runnerId: normalized.runnerId,
    requesterUserId: normalized.requesterUserId,
    attempt: normalized.attempt,
    idempotencyKey: normalized.idempotencyKey,
    taskEnvelope: normalized.taskEnvelope,
    payload: normalized.payload,
    payloadDigest,
    signatureAlgorithm: 'ed25519',
  };
  const signature = cryptoSign(null, buildCanonicalBuffer(preSigned), privateKey).toString('base64url');
  return {
    ...preSigned,
    signature,
  };
}

function normalizeSignedEnvelope(value: unknown): SignedRunnerTaskEnvelope {
  const record = requirePlainRecord(value, 'signedEnvelope');
  requireExactKeys(record, TOP_LEVEL_KEYS, 'signedEnvelope');
  if (record.schemaVersion !== RUNNER_TASK_ENVELOPE_VERSION) {
    throw new Error('invalid_envelope: schemaVersion mismatch');
  }
  if (record.signatureAlgorithm !== 'ed25519') {
    throw new Error('invalid_envelope: signatureAlgorithm must be ed25519');
  }
  const payloadDigest = requireNonBlank(record.payloadDigest, 'payloadDigest');
  if (!/^[0-9a-f]{64}$/.test(payloadDigest)) {
    throw new Error('invalid_envelope: payloadDigest must be lowercase SHA-256 hex');
  }
  const signature = requireNonBlank(record.signature, 'signature');
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new Error('invalid_envelope: signature must be base64url');
  }

  return {
    schemaVersion: RUNNER_TASK_ENVELOPE_VERSION,
    dispatchId: requireStableIdentifier(record.dispatchId, 'dispatchId'),
    runnerId: requireStableIdentifier(record.runnerId, 'runnerId'),
    requesterUserId: requireStableIdentifier(record.requesterUserId, 'requesterUserId'),
    attempt: requirePositiveInteger(record.attempt, 'attempt'),
    idempotencyKey: requireStableIdentifier(record.idempotencyKey, 'idempotencyKey'),
    taskEnvelope: normalizeWireTaskEnvelope(record.taskEnvelope),
    payload: normalizePayload(record.payload),
    payloadDigest,
    signatureAlgorithm: 'ed25519',
    signature,
  };
}

function detachedSignedEnvelope(envelope: SignedRunnerTaskEnvelope): SignedRunnerTaskEnvelope {
  return {
    ...envelope,
    taskEnvelope: {
      ...envelope.taskEnvelope,
      allowedOperations: [...envelope.taskEnvelope.allowedOperations],
    },
    payload: {
      objective: envelope.payload.objective,
      contextReferences: [...envelope.payload.contextReferences],
      requiredCapabilities: [...envelope.payload.requiredCapabilities],
    },
  };
}

export function validateSignedRunnerTaskEnvelope(value: unknown): SignedRunnerTaskEnvelope {
  return detachedSignedEnvelope(normalizeSignedEnvelope(value));
}
function detachedDispatch(envelope: SignedRunnerTaskEnvelope): RunnerTaskDispatch {
  const taskEnvelope = wireToDomain(envelope.taskEnvelope);
  return {
    dispatchId: envelope.dispatchId,
    runnerId: envelope.runnerId,
    requesterUserId: envelope.requesterUserId,
    attempt: envelope.attempt,
    idempotencyKey: envelope.idempotencyKey,
    taskEnvelope: {
      ...taskEnvelope,
      allowedOperations: [...taskEnvelope.allowedOperations],
      issuedAt: new Date(taskEnvelope.issuedAt.getTime()),
      expiresAt: new Date(taskEnvelope.expiresAt.getTime()),
    },
    payload: {
      objective: envelope.payload.objective,
      contextReferences: [...envelope.payload.contextReferences],
      requiredCapabilities: [...envelope.payload.requiredCapabilities],
    },
  };
}

export function verifyRunnerTaskEnvelope(
  value: unknown,
  publicKey: KeyObject,
  options: VerifyRunnerTaskEnvelopeOptions = {},
): RunnerEnvelopeVerificationResult {
  if (!isEd25519PublicKey(publicKey)) return { ok: false, reason: 'invalid_signature' };

  let envelope: SignedRunnerTaskEnvelope;
  try {
    envelope = normalizeSignedEnvelope(value);
  } catch {
    return { ok: false, reason: 'invalid_envelope' };
  }

  if (digestRunnerTaskPayload(envelope.payload) !== envelope.payloadDigest) {
    return { ok: false, reason: 'payload_digest_mismatch' };
  }

  const { signature, ...preSigned } = envelope;
  try {
    const signatureBytes = Buffer.from(signature, 'base64url');
    if (!cryptoVerify(null, buildCanonicalBuffer(preSigned), publicKey, signatureBytes)) {
      return { ok: false, reason: 'invalid_signature' };
    }
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }

  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return { ok: false, reason: 'invalid_envelope' };
  }
  const issuedAt = new Date(envelope.taskEnvelope.issuedAt);
  const expiresAt = new Date(envelope.taskEnvelope.expiresAt);
  if (now.getTime() < issuedAt.getTime()) {
    return { ok: false, reason: 'not_yet_valid' };
  }
  if (now.getTime() >= expiresAt.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  if (options.expectedRunnerId !== undefined && envelope.runnerId !== options.expectedRunnerId) {
    return { ok: false, reason: 'runner_mismatch' };
  }
  if (
    options.expectedDispatchId !== undefined &&
    envelope.dispatchId !== options.expectedDispatchId
  ) {
    return { ok: false, reason: 'dispatch_mismatch' };
  }

  return { ok: true, value: detachedDispatch(envelope) };
}
