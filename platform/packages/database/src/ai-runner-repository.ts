import type { AIRunnerConnectionBinding, AIRunnerOwnership, AIRunnerRecord, AIRunnerStatus, AIRunnerTrustState } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

export interface AIRunnerPersistenceRecord extends AIRunnerRecord {
  lastSeenAt?: Date;
  heartbeatExpiresAt?: Date;
}

export interface AIRunnerCredentialRecord {
  id: string;
  organisationId: string;
  runnerId: string;
  credentialHash: string;
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface CreateAIRunnerCredentialHashInput {
  id: string;
  organisationId: string;
  runnerId: string;
  credentialHash: string;
  createdAt: Date;
  expiresAt?: Date;
}
interface AIRunnerRow {
  id: string;
  organisation_id: string;
  ownership: AIRunnerOwnership;
  owner_user_id: string | null;
  harness_id: string;
  status: AIRunnerStatus;
  trust_state: AIRunnerTrustState;
  persistent_supported: boolean;
  capabilities: string[];
  last_seen_at: Date | null;
  heartbeat_expires_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

interface AIRunnerBindingRow {
  id: string;
  organisation_id: string;
  runner_id: string;
  connection_id: string;
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
}

interface AIRunnerCredentialRow {
  id: string;
  organisation_id: string;
  runner_id: string;
  credential_hash: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}
const RUNNER_COLUMNS = `
  id, organisation_id, ownership, owner_user_id, harness_id, status, trust_state,
  persistent_supported, capabilities, last_seen_at, heartbeat_expires_at,
  created_by, created_at, updated_at, revoked_at`;

const BINDING_COLUMNS = `
  id, organisation_id, runner_id, connection_id, created_by, created_at, revoked_at`;

const CREDENTIAL_COLUMNS = `
  id, organisation_id, runner_id, credential_hash, created_at, expires_at, revoked_at`;

function mapRunner(row: AIRunnerRow): AIRunnerPersistenceRecord {
  const record: AIRunnerPersistenceRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    ownership: row.ownership,
    harnessId: row.harness_id,
    status: row.status,
    trustState: row.trust_state,
    persistentSupported: row.persistent_supported,
    capabilities: [...row.capabilities],
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
  if (row.owner_user_id !== null) record.ownerUserId = row.owner_user_id;
  if (row.last_seen_at !== null) record.lastSeenAt = new Date(row.last_seen_at);
  if (row.heartbeat_expires_at !== null) record.heartbeatExpiresAt = new Date(row.heartbeat_expires_at);
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}
function mapBinding(row: AIRunnerBindingRow): AIRunnerConnectionBinding {
  const record: AIRunnerConnectionBinding = {
    id: row.id,
    organisationId: row.organisation_id,
    runnerId: row.runner_id,
    connectionId: row.connection_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at)
  };
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

function mapCredential(row: AIRunnerCredentialRow): AIRunnerCredentialRecord {
  const record: AIRunnerCredentialRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    runnerId: row.runner_id,
    credentialHash: row.credential_hash,
    createdAt: new Date(row.created_at)
  };
  if (row.expires_at !== null) record.expiresAt = new Date(row.expires_at);
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

export class AIRunnerRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createRunner(record: AIRunnerRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_runners
       (id, organisation_id, ownership, owner_user_id, harness_id, status, trust_state,
        persistent_supported, capabilities, created_by, created_at, updated_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        record.id,
        record.organisationId,
        record.ownership,
        record.ownerUserId ?? null,
        record.harnessId,
        record.status,
        record.trustState,
        record.persistentSupported,
        record.capabilities,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
        record.revokedAt ?? null
      ]
    );
  }

  async getRunner(organisationId: string, id: string): Promise<AIRunnerPersistenceRecord | null> {
    const result = await this.database.query<AIRunnerRow>(
      `SELECT ${RUNNER_COLUMNS} FROM ai_runners
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id]
    );
    const row = result.rows[0];
    return row ? mapRunner(row) : null;
  }

  async getRunnerForUpdate(organisationId: string, id: string): Promise<AIRunnerPersistenceRecord | null> {
    const result = await this.database.query<AIRunnerRow>(
      `SELECT ${RUNNER_COLUMNS} FROM ai_runners
       WHERE organisation_id = $1 AND id = $2
       FOR UPDATE`,
      [organisationId, id]
    );
    const row = result.rows[0];
    return row ? mapRunner(row) : null;
  }
  async listForUser(organisationId: string, ownerUserId: string): Promise<AIRunnerPersistenceRecord[]> {
    const result = await this.database.query<AIRunnerRow>(
      `SELECT ${RUNNER_COLUMNS} FROM ai_runners
       WHERE organisation_id = $1 AND ownership = 'personal' AND owner_user_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, ownerUserId]
    );
    return result.rows.map(mapRunner);
  }

  async listOrganisationRunners(organisationId: string): Promise<AIRunnerPersistenceRecord[]> {
    const result = await this.database.query<AIRunnerRow>(
      `SELECT ${RUNNER_COLUMNS} FROM ai_runners
       WHERE organisation_id = $1 AND ownership = 'organisation'
       ORDER BY created_at ASC, id ASC`,
      [organisationId]
    );
    return result.rows.map(mapRunner);
  }

  async setRunnerStatus(organisationId: string, id: string, status: AIRunnerStatus, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_runners
       SET status = $3, updated_at = $4,
           revoked_at = CASE WHEN $3 = 'revoked' THEN $4 ELSE revoked_at END
       WHERE organisation_id = $1 AND id = $2 AND revoked_at IS NULL AND status <> 'revoked'`,
      [organisationId, id, status, when]
    );
    if (result.rowCount !== 1) throw new Error('ai runner not found for status update');
  }

  async setRunnerTrustState(organisationId: string, id: string, trustState: AIRunnerTrustState, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_runners SET trust_state = $3, updated_at = $4
       WHERE organisation_id = $1 AND id = $2 AND revoked_at IS NULL AND trust_state <> 'revoked'`,
      [organisationId, id, trustState, when]
    );
    if (result.rowCount !== 1) throw new Error('active ai runner not found for trust update');
  }

  async createConnectionBinding(record: AIRunnerConnectionBinding): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_runner_connection_bindings
       (id, organisation_id, runner_id, connection_id, created_by, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.id, record.organisationId, record.runnerId, record.connectionId, record.createdBy, record.createdAt, record.revokedAt ?? null]
    );
  }

  async revokeConnectionBinding(organisationId: string, id: string, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_runner_connection_bindings SET revoked_at = $3
       WHERE organisation_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [organisationId, id, when]
    );
    if (result.rowCount !== 1) throw new Error('active ai runner connection binding not found');
  }

  async listActiveBindingsForConnection(organisationId: string, connectionId: string): Promise<AIRunnerConnectionBinding[]> {
    const result = await this.database.query<AIRunnerBindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM ai_runner_connection_bindings
       WHERE organisation_id = $1 AND connection_id = $2 AND revoked_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [organisationId, connectionId]
    );
    return result.rows.map(mapBinding);
  }

  async listActiveBindingsForRunner(organisationId: string, runnerId: string): Promise<AIRunnerConnectionBinding[]> {
    const result = await this.database.query<AIRunnerBindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM ai_runner_connection_bindings
       WHERE organisation_id = $1 AND runner_id = $2 AND revoked_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [organisationId, runnerId]
    );
    return result.rows.map(mapBinding);
  }

  async createCredentialHash(input: CreateAIRunnerCredentialHashInput): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_runner_credentials
       (id, organisation_id, runner_id, credential_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.organisationId, input.runnerId, input.credentialHash, input.createdAt, input.expiresAt ?? null]
    );
  }

  async getActiveCredentialByHash(credentialHash: string, at: Date): Promise<AIRunnerCredentialRecord | null> {
    const result = await this.database.query<AIRunnerCredentialRow>(
      `SELECT c.* FROM ai_runner_credentials c
       JOIN ai_runners r
         ON r.organisation_id = c.organisation_id AND r.id = c.runner_id
       WHERE c.credential_hash = $1 AND c.revoked_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > $2)
         AND r.revoked_at IS NULL AND r.status NOT IN ('disabled', 'revoked') AND r.trust_state <> 'revoked'
         AND (
           r.ownership = 'organisation'
           OR EXISTS (
             SELECT 1 FROM organisation_memberships om
             WHERE om.organisation_id = r.organisation_id
               AND om.user_id = r.owner_user_id
               AND om.status = 'active'
           )
         )`,
      [credentialHash, at]
    );
    const row = result.rows[0];
    return row ? mapCredential(row) : null;
  }

  async revokeCredential(organisationId: string, id: string, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_runner_credentials SET revoked_at = $3
       WHERE organisation_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [organisationId, id, when]
    );
    if (result.rowCount !== 1) throw new Error('active ai runner credential not found');
  }

  async revokeActiveCredentialsForRunner(organisationId: string, runnerId: string, when: Date): Promise<number> {
    const result = await this.database.query(
      `UPDATE ai_runner_credentials SET revoked_at = $3
       WHERE organisation_id = $1 AND runner_id = $2 AND revoked_at IS NULL`,
      [organisationId, runnerId, when]
    );
    return result.rowCount ?? 0;
  }

  async recordHeartbeat(organisationId: string, runnerId: string, seenAt: Date, expiresAt: Date): Promise<void> {
    if (!(seenAt instanceof Date) || !Number.isFinite(seenAt.getTime())) {
      throw new Error('seenAt must be a valid Date');
    }
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= seenAt) {
      throw new Error('heartbeat expiry must be strictly after seenAt');
    }
    const result = await this.database.query(
      `UPDATE ai_runners
       SET status = 'online', last_seen_at = $3, heartbeat_expires_at = $4,
           updated_at = GREATEST(updated_at, $3)
       WHERE organisation_id = $1 AND id = $2
         AND revoked_at IS NULL AND status NOT IN ('disabled', 'revoked')
         AND trust_state <> 'revoked'
         AND (last_seen_at IS NULL OR last_seen_at < $3)`,
      [organisationId, runnerId, seenAt, expiresAt]
    );
    if (result.rowCount !== 1) throw new Error('active ai runner not found for heartbeat');
  }
}
