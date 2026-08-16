import { isDeepStrictEqual } from 'node:util';
import {
  validateSignedRunnerTaskEnvelope,
  type SignedRunnerTaskEnvelope,
} from '@engineering-os/runner-protocol';
import type { DatabaseQueryable } from './queryable.js';

export const AI_DISPATCH_STATES = [
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export type AIDispatchState = (typeof AI_DISPATCH_STATES)[number];
export type AIDispatchTerminalOutcome = 'succeeded' | 'failed' | 'cancelled';

export type AIDispatchMetadataValue =
  | null
  | string
  | number
  | boolean
  | AIDispatchMetadataValue[]
  | { [key: string]: AIDispatchMetadataValue };

export interface AIDispatchRecord {
  id: string;
  organisationId: string;
  projectId: string;
  taskId: string;
  requesterUserId: string;
  connectionId: string;
  runnerId: string;
  routeId: string;
  harnessId: string;
  state: AIDispatchState;
  attempt: number;
  idempotencyKey: string;
  signedEnvelope: SignedRunnerTaskEnvelope;
  createdAt: Date;
  updatedAt: Date;
  claimedAt?: Date;
  startedAt?: Date;
  succeededAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  expiredAt?: Date;
}

export interface ClaimedAIDispatchRecord {
  dispatch: AIDispatchRecord;
  replayed: boolean;
}

export interface AIDispatchCheckpointInput {
  id: string;
  attempt: number;
  ordinal: number;
  kind: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AIDispatchCheckpointRecord extends AIDispatchCheckpointInput {
  organisationId: string;
  dispatchId: string;
}

export interface AIDispatchTerminalEvidenceInput {
  id: string;
  metadata: Record<string, unknown>;
  artifactReferences: string[];
  sessionReference?: string;
}

export interface AIDispatchExecutionEvidenceRecord extends AIDispatchTerminalEvidenceInput {
  organisationId: string;
  dispatchId: string;
  projectId: string;
  taskId: string;
  runnerId: string;
  connectionId: string;
  harnessId: string;
  routeId: string;
  attempt: number;
  outcome: AIDispatchTerminalOutcome;
  createdAt: Date;
}

interface AIDispatchRow {
  id: string;
  organisation_id: string;
  project_id: string;
  task_id: string;
  requester_user_id: string;
  connection_id: string;
  runner_id: string;
  route_id: string;
  harness_id: string;
  state: AIDispatchState;
  attempt: number;
  idempotency_key: string;
  signed_envelope: unknown;
  created_at: Date;
  updated_at: Date;
  claimed_at: Date | null;
  started_at: Date | null;
  succeeded_at: Date | null;
  failed_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
}

interface AIDispatchCheckpointRow {
  id: string;
  organisation_id: string;
  dispatch_id: string;
  attempt: number;
  ordinal: number;
  kind: string;
  metadata: Record<string, AIDispatchMetadataValue>;
  created_at: Date;
}

interface AIDispatchEvidenceRow {
  id: string;
  organisation_id: string;
  dispatch_id: string;
  project_id: string;
  task_id: string;
  runner_id: string;
  connection_id: string;
  harness_id: string;
  route_id: string;
  attempt: number;
  outcome: AIDispatchTerminalOutcome;
  metadata: Record<string, AIDispatchMetadataValue>;
  artifact_references: string[];
  session_reference: string | null;
  created_at: Date;
}

const DISPATCH_COLUMNS = `
  id, organisation_id, project_id, task_id, requester_user_id,
  connection_id, runner_id, route_id, harness_id, state, attempt,
  idempotency_key, signed_envelope, created_at, updated_at, claimed_at,
  started_at, succeeded_at, failed_at, cancelled_at, expired_at`;

const MAX_METADATA_BYTES = 16_384;
const MAX_METADATA_DEPTH = 8;
const MAX_ARTIFACT_REFERENCES = 64;

function requireDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function requireNonBlank(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-blank string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new TypeError(`${field} is too long`);
  if (/\r|\n/.test(normalized)) throw new TypeError(`${field} must be single-line`);
  return normalized;
}

function metadataKeyContainsCredential(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (
    normalized.includes('password') ||
    normalized.includes('passwd') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized.includes('authorization') ||
    normalized.includes('bearer') ||
    normalized.includes('cookie')
  ) return true;
  return normalized.endsWith('apikey') || normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') || normalized.endsWith('sessiontoken') ||
    normalized.endsWith('idtoken') || (normalized.endsWith('token') && !normalized.endsWith('tokens'));
}

function safeMetadataValue(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): AIDispatchMetadataValue {
  if (depth > MAX_METADATA_DEPTH) throw new TypeError(`${path} metadata nesting is too deep`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} metadata number must be finite`);
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${path} metadata must be JSON-safe`);
  }
  if (seen.has(value)) throw new TypeError(`${path} metadata must not be cyclic`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 256) throw new TypeError(`${path} metadata array is too large`);
      return value.map((entry, index) => safeMetadataValue(entry, `${path}[${index}]`, depth + 1, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} metadata must use plain objects`);
    }
    const result = Object.create(null) as Record<string, AIDispatchMetadataValue>;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 128) throw new TypeError(`${path} metadata object has too many keys`);
    for (const [key, entry] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (!/^[\x20-\x7E]{1,128}$/.test(key)) {
        throw new TypeError(`${path}.${key} metadata key must use printable ASCII`);
      }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError(`${path}.${key} is not allowed in metadata`);
      }
      if (metadataKeyContainsCredential(key)) {
        throw new TypeError(`${path}.${key} contains credential or secret metadata`);
      }
      result[key] = safeMetadataValue(entry, `${path}.${key}`, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function safeMetadata(value: unknown): Record<string, AIDispatchMetadataValue> {
  const normalized = safeMetadataValue(value, 'metadata', 0, new WeakSet<object>());
  if (Array.isArray(normalized) || normalized === null || typeof normalized !== 'object') {
    throw new TypeError('metadata must be an object');
  }
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (bytes > MAX_METADATA_BYTES) throw new TypeError('metadata is too large');
  return normalized;
}

function safeArtifactReferences(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('artifactReferences must be an array');
  if (value.length > MAX_ARTIFACT_REFERENCES) throw new TypeError('artifactReferences is too large');
  const normalized = value.map((entry, index) => requireNonBlank(entry, `artifactReferences[${index}]`, 1024));
  if (new Set(normalized).size !== normalized.length) throw new TypeError('artifactReferences must not contain duplicates');
  return [...normalized].sort();
}

function mapDispatch(row: AIDispatchRow): AIDispatchRecord {
  const record: AIDispatchRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    taskId: row.task_id,
    requesterUserId: row.requester_user_id,
    connectionId: row.connection_id,
    runnerId: row.runner_id,
    routeId: row.route_id,
    harnessId: row.harness_id,
    state: row.state,
    attempt: row.attempt,
    idempotencyKey: row.idempotency_key,
    signedEnvelope: validateSignedRunnerTaskEnvelope(row.signed_envelope),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (row.claimed_at !== null) record.claimedAt = new Date(row.claimed_at);
  if (row.started_at !== null) record.startedAt = new Date(row.started_at);
  if (row.succeeded_at !== null) record.succeededAt = new Date(row.succeeded_at);
  if (row.failed_at !== null) record.failedAt = new Date(row.failed_at);
  if (row.cancelled_at !== null) record.cancelledAt = new Date(row.cancelled_at);
  if (row.expired_at !== null) record.expiredAt = new Date(row.expired_at);
  return record;
}

function mapCheckpoint(row: AIDispatchCheckpointRow): AIDispatchCheckpointRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    dispatchId: row.dispatch_id,
    attempt: row.attempt,
    ordinal: row.ordinal,
    kind: row.kind,
    metadata: safeMetadata(row.metadata),
    createdAt: new Date(row.created_at),
  };
}

function mapEvidence(row: AIDispatchEvidenceRow): AIDispatchExecutionEvidenceRecord {
  const record: AIDispatchExecutionEvidenceRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    dispatchId: row.dispatch_id,
    projectId: row.project_id,
    taskId: row.task_id,
    runnerId: row.runner_id,
    connectionId: row.connection_id,
    harnessId: row.harness_id,
    routeId: row.route_id,
    attempt: row.attempt,
    outcome: row.outcome,
    metadata: safeMetadata(row.metadata),
    artifactReferences: [...row.artifact_references],
    createdAt: new Date(row.created_at),
  };
  if (row.session_reference !== null) record.sessionReference = row.session_reference;
  return record;
}

function isActiveClaimConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' &&
    candidate.constraint === 'ai_dispatches_runner_active_unique_idx';
}

function sameMetadata(
  left: Record<string, AIDispatchMetadataValue>,
  right: Record<string, AIDispatchMetadataValue>,
): boolean {
  return isDeepStrictEqual(left, right);
}

export class AIDispatchRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(envelopeInput: SignedRunnerTaskEnvelope, createdAtInput: Date): Promise<void> {
    const envelope = validateSignedRunnerTaskEnvelope(envelopeInput);
    const createdAt = requireDate(createdAtInput, 'createdAt');
    const issuedAt = new Date(envelope.taskEnvelope.issuedAt);
    const expiresAt = new Date(envelope.taskEnvelope.expiresAt);
    if (createdAt.getTime() < issuedAt.getTime()) {
      throw new TypeError('createdAt must be on or after task envelope issuedAt');
    }
    if (createdAt.getTime() >= expiresAt.getTime()) {
      throw new TypeError('createdAt must be before task envelope expiresAt');
    }

    await this.database.query(
      `INSERT INTO ai_dispatches
        (id, organisation_id, project_id, task_id, requester_user_id,
         connection_id, runner_id, route_id, harness_id, state, attempt,
         idempotency_key, task_envelope_id, workspace_scope, allowed_operations,
         issued_at, expires_at, nonce, objective, context_references,
         required_capabilities, payload_digest, signature_algorithm, signature,
         signed_envelope, created_at, updated_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$25)`,
      [
        envelope.dispatchId,
        envelope.taskEnvelope.organisationId,
        envelope.taskEnvelope.projectId,
        envelope.taskEnvelope.taskId,
        envelope.requesterUserId,
        envelope.taskEnvelope.connectionId,
        envelope.runnerId,
        envelope.taskEnvelope.routeId,
        envelope.taskEnvelope.harnessId,
        envelope.attempt,
        envelope.idempotencyKey,
        envelope.taskEnvelope.id,
        envelope.taskEnvelope.workspaceScope,
        envelope.taskEnvelope.allowedOperations,
        issuedAt,
        expiresAt,
        envelope.taskEnvelope.nonce,
        envelope.payload.objective,
        envelope.payload.contextReferences,
        envelope.payload.requiredCapabilities,
        envelope.payloadDigest,
        envelope.signatureAlgorithm,
        envelope.signature,
        JSON.stringify(envelope),
        createdAt,
      ],
    );
  }

  async get(organisationId: string, id: string): Promise<AIDispatchRecord | null> {
    const result = await this.database.query<AIDispatchRow>(
      `SELECT ${DISPATCH_COLUMNS}
       FROM ai_dispatches
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id],
    );
    const row = result.rows[0];
    return row ? mapDispatch(row) : null;
  }

  private async getActiveForRunner(
    organisationId: string,
    runnerId: string,
    now: Date,
  ): Promise<AIDispatchRecord | null> {
    const result = await this.database.query<AIDispatchRow>(
      `SELECT ${DISPATCH_COLUMNS.split(',').map((column) => `d.${column.trim()}`).join(', ')}
       FROM ai_dispatches AS d
       JOIN ai_runners AS r
         ON r.organisation_id = d.organisation_id AND r.id = d.runner_id
       WHERE d.organisation_id = $1 AND d.runner_id = $2
         AND d.state IN ('claimed', 'running') AND d.expires_at > $3
         AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
         AND r.heartbeat_expires_at > $3
         AND (
           r.ownership = 'organisation'
           OR EXISTS (
             SELECT 1 FROM organisation_memberships AS om
             WHERE om.organisation_id = r.organisation_id
               AND om.user_id = r.owner_user_id AND om.status = 'active'
           )
         )
       ORDER BY d.claimed_at ASC, d.id ASC
       LIMIT 1`,
      [organisationId, runnerId, now],
    );
    const row = result.rows[0];
    return row ? mapDispatch(row) : null;
  }

  private async hasEligibleQueued(
    organisationId: string,
    runnerId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM ai_dispatches AS d
         JOIN ai_runners AS r
           ON r.organisation_id = d.organisation_id AND r.id = d.runner_id
         WHERE d.organisation_id = $1 AND d.runner_id = $2
           AND d.state = 'queued' AND d.expires_at > $3
           AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
           AND r.heartbeat_expires_at > $3
           AND (
             r.ownership = 'organisation'
             OR EXISTS (
               SELECT 1 FROM organisation_memberships AS om
               WHERE om.organisation_id = r.organisation_id
                 AND om.user_id = r.owner_user_id AND om.status = 'active'
             )
           )
       ) AS exists`,
      [organisationId, runnerId, now],
    );
    return result.rows[0]?.exists === true;
  }

  private async waitForRunnerClaimBarrier(organisationId: string, runnerId: string): Promise<void> {
    await this.database.query(
      `SELECT id FROM ai_runners
       WHERE organisation_id = $1 AND id = $2
       FOR UPDATE`,
      [organisationId, runnerId],
    );
  }

  private async claimQueued(
    organisationId: string,
    runnerId: string,
    now: Date,
  ): Promise<AIDispatchRecord | null> {
    const result = await this.database.query<AIDispatchRow>(
      `WITH candidate AS (
         SELECT d.id
         FROM ai_dispatches AS d
         JOIN ai_runners AS r
           ON r.organisation_id = d.organisation_id AND r.id = d.runner_id
         WHERE d.organisation_id = $1 AND d.runner_id = $2
           AND d.state = 'queued' AND d.expires_at > $3
           AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
           AND r.heartbeat_expires_at > $3
           AND (
             r.ownership = 'organisation'
             OR EXISTS (
               SELECT 1 FROM organisation_memberships AS om
               WHERE om.organisation_id = r.organisation_id
                 AND om.user_id = r.owner_user_id AND om.status = 'active'
             )
           )
         ORDER BY d.created_at ASC, d.id ASC
         FOR UPDATE OF d, r SKIP LOCKED
         LIMIT 1
       )
       UPDATE ai_dispatches AS d
       SET state = 'claimed', claimed_at = $3, updated_at = $3
       FROM candidate
       WHERE d.id = candidate.id
       RETURNING ${DISPATCH_COLUMNS.split(',').map((column) => `d.${column.trim()}`).join(', ')}`,
      [organisationId, runnerId, now],
    );
    const row = result.rows[0];
    return row ? mapDispatch(row) : null;
  }

  async claimNext(
    organisationId: string,
    runnerId: string,
    nowInput: Date,
  ): Promise<ClaimedAIDispatchRecord | null> {
    const now = requireDate(nowInput, 'claim time');
    await this.expireDue(organisationId, runnerId, now);

    for (;;) {
      const existing = await this.getActiveForRunner(organisationId, runnerId, now);
      if (existing) return { dispatch: existing, replayed: true };

      try {
        const claimed = await this.claimQueued(organisationId, runnerId, now);
        if (claimed) return { dispatch: claimed, replayed: false };
      } catch (error) {
        if (!isActiveClaimConflict(error)) throw error;
      }

      // SKIP LOCKED may miss queued work while another transaction owns the
      // runner row. Wait for that authority mutation/claim to finish, then
      // distinguish a committed replay from still-eligible queued work.
      await this.waitForRunnerClaimBarrier(organisationId, runnerId);
      const replay = await this.getActiveForRunner(organisationId, runnerId, now);
      if (replay) return { dispatch: replay, replayed: true };
      if (!(await this.hasEligibleQueued(organisationId, runnerId, now))) return null;
    }
  }
  async markRunning(
    organisationId: string,
    id: string,
    runnerId: string,
    whenInput: Date,
  ): Promise<void> {
    const when = requireDate(whenInput, 'startedAt');
    const result = await this.database.query(
      `WITH authority AS (
         SELECT r.id
         FROM ai_runners AS r
         WHERE r.organisation_id = $1 AND r.id = $3
           AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
           AND r.heartbeat_expires_at > $4
           AND (
             r.ownership = 'organisation'
             OR EXISTS (
               SELECT 1 FROM organisation_memberships AS om
               WHERE om.organisation_id = r.organisation_id
                 AND om.user_id = r.owner_user_id AND om.status = 'active'
               FOR UPDATE
             )
           )
         FOR UPDATE OF r
       )
       UPDATE ai_dispatches AS d
       SET state = 'running', started_at = $4, updated_at = $4
       FROM authority
       WHERE d.organisation_id = $1 AND d.id = $2 AND d.runner_id = $3
         AND d.state = 'claimed' AND d.expires_at > $4`,
      [organisationId, id, runnerId, when],
    );
    if (result.rowCount === 1) return;
    const replay = await this.getActiveForRunner(organisationId, runnerId, when);
    if (replay?.id === id && replay.state === 'running') return;
    throw new Error('claimed ai dispatch not found for running transition');
  }

  async expireDue(
    organisationId: string,
    runnerId: string,
    nowInput: Date,
  ): Promise<number> {
    const now = requireDate(nowInput, 'expiry time');
    const result = await this.database.query(
      `UPDATE ai_dispatches
       SET state = 'expired', expired_at = $3, updated_at = $3
       WHERE organisation_id = $1 AND runner_id = $2
         AND state IN ('queued', 'claimed', 'running') AND expires_at <= $3`,
      [organisationId, runnerId, now],
    );
    return result.rowCount ?? 0;
  }

  async cancel(
    organisationId: string,
    id: string,
    runnerId: string,
    whenInput: Date,
  ): Promise<void> {
    const when = requireDate(whenInput, 'cancelledAt');
    const result = await this.database.query(
      `UPDATE ai_dispatches
       SET state = 'cancelled', cancelled_at = $4, updated_at = $4
       WHERE organisation_id = $1 AND id = $2 AND runner_id = $3
         AND state IN ('queued', 'claimed', 'running')`,
      [organisationId, id, runnerId, when],
    );
    if (result.rowCount === 1) return;
    const existing = await this.get(organisationId, id);
    if (existing?.runnerId === runnerId && existing.state === 'cancelled') return;
    throw new Error('active ai dispatch not found for cancellation');
  }

  async addCheckpoint(
    organisationId: string,
    dispatchId: string,
    checkpoint: AIDispatchCheckpointInput,
  ): Promise<void> {
    const createdAt = requireDate(checkpoint.createdAt, 'checkpoint.createdAt');
    if (!Number.isInteger(checkpoint.attempt) || checkpoint.attempt < 1) {
      throw new TypeError('checkpoint.attempt must be a positive integer');
    }
    if (!Number.isInteger(checkpoint.ordinal) || checkpoint.ordinal < 1) {
      throw new TypeError('checkpoint.ordinal must be a positive integer');
    }
    const kind = requireNonBlank(checkpoint.kind, 'checkpoint.kind', 128);
    const metadata = safeMetadata(checkpoint.metadata);
    const result = await this.database.query(
      `WITH authority AS (
         SELECT r.id
         FROM ai_runners AS r
         JOIN ai_dispatches AS target
           ON target.organisation_id = r.organisation_id AND target.runner_id = r.id
         WHERE r.organisation_id = $1 AND target.id = $2 AND target.attempt = $4
           AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
           AND r.heartbeat_expires_at > $8
           AND (
             r.ownership = 'organisation'
             OR EXISTS (
               SELECT 1 FROM organisation_memberships AS om
               WHERE om.organisation_id = r.organisation_id
                 AND om.user_id = r.owner_user_id AND om.status = 'active'
               FOR UPDATE
             )
           )
         FOR UPDATE OF r
       )
       INSERT INTO ai_dispatch_checkpoints
        (id, organisation_id, dispatch_id, attempt, ordinal, kind, metadata, created_at)
       SELECT $3, d.organisation_id, d.id, $4, $5, $6, $7::jsonb, $8
       FROM ai_dispatches AS d
       JOIN authority AS a ON a.id = d.runner_id
       WHERE d.organisation_id = $1 AND d.id = $2 AND d.attempt = $4
         AND d.state IN ('claimed', 'running')
         AND d.claimed_at IS NOT NULL AND $8 >= d.claimed_at
       ON CONFLICT (organisation_id, dispatch_id, attempt, ordinal) DO NOTHING
       RETURNING id`,
      [
        organisationId,
        dispatchId,
        checkpoint.id,
        checkpoint.attempt,
        checkpoint.ordinal,
        kind,
        JSON.stringify(metadata),
        createdAt,
      ],
    );
    if (result.rowCount === 1) return;

    const existing = (await this.listCheckpoints(organisationId, dispatchId)).find(
      (value) => value.attempt === checkpoint.attempt && value.ordinal === checkpoint.ordinal,
    );
    if (existing
        && existing.kind === kind
        && sameMetadata(existing.metadata as Record<string, AIDispatchMetadataValue>, metadata)) {
      return;
    }
    if (existing) throw new Error('ai dispatch checkpoint replay conflicts with stored evidence');
    throw new Error('active ai dispatch not found for checkpoint');
  }

  async listCheckpoints(
    organisationId: string,
    dispatchId: string,
  ): Promise<AIDispatchCheckpointRecord[]> {
    const result = await this.database.query<AIDispatchCheckpointRow>(
      `SELECT id, organisation_id, dispatch_id, attempt, ordinal, kind, metadata, created_at
       FROM ai_dispatch_checkpoints
       WHERE organisation_id = $1 AND dispatch_id = $2
       ORDER BY attempt ASC, ordinal ASC`,
      [organisationId, dispatchId],
    );
    return result.rows.map(mapCheckpoint);
  }

  private normalizeEvidence(input: AIDispatchTerminalEvidenceInput) {
    const metadata = safeMetadata(input.metadata);
    const artifactReferences = safeArtifactReferences(input.artifactReferences);
    const sessionReference = input.sessionReference === undefined
      ? undefined
      : requireNonBlank(input.sessionReference, 'sessionReference', 1024);
    return {
      id: input.id,
      metadata,
      artifactReferences,
      ...(sessionReference === undefined ? {} : { sessionReference }),
    };
  }

  private async finish(
    organisationId: string,
    id: string,
    runnerId: string,
    whenInput: Date,
    outcome: 'succeeded' | 'failed',
    input: AIDispatchTerminalEvidenceInput,
  ): Promise<void> {
    const when = requireDate(whenInput, `${outcome}At`);
    const evidence = this.normalizeEvidence(input);
    const result = await this.database.query<{ transitioned_count: number; inserted_count: number }>(
      `WITH authority AS (
         SELECT r.id
         FROM ai_runners AS r
         WHERE r.organisation_id = $1 AND r.id = $3
           AND r.status = 'online' AND r.trust_state = 'trusted' AND r.revoked_at IS NULL
           AND r.heartbeat_expires_at > $5
           AND (
             r.ownership = 'organisation'
             OR EXISTS (
               SELECT 1 FROM organisation_memberships AS om
               WHERE om.organisation_id = r.organisation_id
                 AND om.user_id = r.owner_user_id AND om.status = 'active'
               FOR UPDATE
             )
           )
         FOR UPDATE OF r
       ), transitioned AS (
         UPDATE ai_dispatches AS d
         SET state = $4, updated_at = $5,
             succeeded_at = CASE WHEN $4 = 'succeeded' THEN $5 ELSE d.succeeded_at END,
             failed_at = CASE WHEN $4 = 'failed' THEN $5 ELSE d.failed_at END
         FROM authority
         WHERE d.organisation_id = $1 AND d.id = $2 AND d.runner_id = $3
           AND d.state = 'running' AND d.expires_at > $5
         RETURNING d.organisation_id, d.id, d.attempt
       ), inserted AS (
         INSERT INTO ai_dispatch_execution_evidence
           (id, organisation_id, dispatch_id, attempt, outcome, metadata,
            artifact_references, session_reference, created_at)
         SELECT $6, organisation_id, id, attempt, $4, $7::jsonb, $8::text[], $9, $5
         FROM transitioned
         RETURNING id
       )
       SELECT
         (SELECT count(*)::int FROM transitioned) AS transitioned_count,
         (SELECT count(*)::int FROM inserted) AS inserted_count`,
      [
        organisationId,
        id,
        runnerId,
        outcome,
        when,
        evidence.id,
        JSON.stringify(evidence.metadata),
        evidence.artifactReferences,
        evidence.sessionReference ?? null,
      ],
    );
    const counts = result.rows[0];
    if (counts?.transitioned_count === 1 && counts.inserted_count === 1) return;

    const existing = await this.get(organisationId, id);
    if (!existing || existing.runnerId !== runnerId || existing.state !== outcome) {
      throw new Error('ai dispatch terminal transition is invalid or conflicts with existing terminal state');
    }
    const stored = (await this.listExecutionEvidence(organisationId, id))[0];
    if (!stored || stored.outcome !== outcome ||
        !sameMetadata(stored.metadata as Record<string, AIDispatchMetadataValue>, evidence.metadata) ||
        JSON.stringify(stored.artifactReferences) !== JSON.stringify(evidence.artifactReferences) ||
        (stored.sessionReference ?? undefined) !== evidence.sessionReference) {
      throw new Error('ai dispatch terminal replay conflicts with stored evidence');
    }
  }

  async complete(
    organisationId: string,
    id: string,
    runnerId: string,
    when: Date,
    evidence: AIDispatchTerminalEvidenceInput,
  ): Promise<void> {
    await this.finish(organisationId, id, runnerId, when, 'succeeded', evidence);
  }

  async fail(
    organisationId: string,
    id: string,
    runnerId: string,
    when: Date,
    evidence: AIDispatchTerminalEvidenceInput,
  ): Promise<void> {
    await this.finish(organisationId, id, runnerId, when, 'failed', evidence);
  }

  async listExecutionEvidence(
    organisationId: string,
    dispatchId: string,
  ): Promise<AIDispatchExecutionEvidenceRecord[]> {
    const result = await this.database.query<AIDispatchEvidenceRow>(
      `SELECT e.id, e.organisation_id, e.dispatch_id, d.project_id, d.task_id,
              d.runner_id, d.connection_id, d.harness_id, d.route_id,
              e.attempt, e.outcome, e.metadata, e.artifact_references,
              e.session_reference, e.created_at
       FROM ai_dispatch_execution_evidence e
       JOIN ai_dispatches d
         ON d.organisation_id = e.organisation_id
        AND d.id = e.dispatch_id AND d.attempt = e.attempt
       WHERE e.organisation_id = $1 AND e.dispatch_id = $2
       ORDER BY e.attempt ASC, e.created_at ASC, e.id ASC`,
      [organisationId, dispatchId],
    );
    return result.rows.map(mapEvidence);
  }
}
