import type {
  AIConnectionCredentialStrategy,
  AIConnectionOwnership,
  AIConnectionRecord,
  AIConnectionShareMode,
  AIConnectionStatus,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

export interface AIConnectionProjectShareRecord {
  id: string;
  organisationId: string;
  projectId: string;
  connectionId: string;
  mode: AIConnectionShareMode;
  availableFrom?: Date;
  availableUntil?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

interface AIConnectionRow {
  id: string;
  organisation_id: string;
  ownership: AIConnectionOwnership;
  owner_user_id: string | null;
  provider_id: string;
  connection_family_id: string;
  credential_strategy: AIConnectionCredentialStrategy;
  secret_ref_id: string | null;
  status: AIConnectionStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

interface AIConnectionShareRow {
  id: string;
  organisation_id: string;
  project_id: string;
  connection_id: string;
  mode: AIConnectionShareMode;
  available_from: Date | null;
  available_until: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

const CONNECTION_COLUMNS = `
  id, organisation_id, ownership, owner_user_id, provider_id,
  connection_family_id, credential_strategy, secret_ref_id, status,
  created_by, created_at, updated_at, revoked_at`;

const SHARE_COLUMNS = `
  id, organisation_id, project_id, connection_id, mode,
  available_from, available_until, created_by, created_at, updated_at, revoked_at`;

function mapConnection(row: AIConnectionRow): AIConnectionRecord {
  const record: AIConnectionRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    ownership: row.ownership,
    providerId: row.provider_id,
    connectionFamilyId: row.connection_family_id,
    credentialStrategy: row.credential_strategy,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (row.owner_user_id !== null) record.ownerUserId = row.owner_user_id;
  if (row.secret_ref_id !== null) record.secretRefId = row.secret_ref_id;
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

function mapShare(row: AIConnectionShareRow): AIConnectionProjectShareRecord {
  const record: AIConnectionProjectShareRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    mode: row.mode,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (row.available_from !== null) record.availableFrom = new Date(row.available_from);
  if (row.available_until !== null) record.availableUntil = new Date(row.available_until);
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

export class AIConnectionRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createConnection(record: AIConnectionRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_connections
        (id, organisation_id, ownership, owner_user_id, provider_id,
         connection_family_id, credential_strategy, secret_ref_id, status,
         created_by, created_at, updated_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        record.id,
        record.organisationId,
        record.ownership,
        record.ownerUserId ?? null,
        record.providerId,
        record.connectionFamilyId,
        record.credentialStrategy,
        record.secretRefId ?? null,
        record.status,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
        record.revokedAt ?? null,
      ],
    );
  }

  async getConnection(organisationId: string, id: string): Promise<AIConnectionRecord | null> {
    const result = await this.database.query<AIConnectionRow>(
      `SELECT ${CONNECTION_COLUMNS}
       FROM ai_connections
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id],
    );
    const row = result.rows[0];
    return row ? mapConnection(row) : null;
  }

  async listForUser(organisationId: string, ownerUserId: string): Promise<AIConnectionRecord[]> {
    const result = await this.database.query<AIConnectionRow>(
      `SELECT ${CONNECTION_COLUMNS}
       FROM ai_connections
       WHERE organisation_id = $1
         AND ownership = 'personal'
         AND owner_user_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organisationId, ownerUserId],
    );
    return result.rows.map(mapConnection);
  }

  async listOrganisationConnections(organisationId: string): Promise<AIConnectionRecord[]> {
    const result = await this.database.query<AIConnectionRow>(
      `SELECT ${CONNECTION_COLUMNS}
       FROM ai_connections
       WHERE organisation_id = $1 AND ownership = 'organisation'
       ORDER BY created_at ASC, id ASC`,
      [organisationId],
    );
    return result.rows.map(mapConnection);
  }

  async setConnectionStatus(
    organisationId: string,
    id: string,
    status: AIConnectionStatus,
    when: Date,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_connections
         SET status = $3,
             updated_at = $4,
             revoked_at = CASE WHEN $3 = 'revoked' THEN $4 ELSE revoked_at END
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id, status, when],
    );
    if (result.rowCount !== 1) throw new Error('ai connection not found for status update');
  }

  async createProjectShare(record: AIConnectionProjectShareRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_connection_project_shares
        (id, organisation_id, project_id, connection_id, connection_ownership,
         mode, available_from, available_until,
         created_by, created_at, updated_at, revoked_at)
       VALUES ($1, $2, $3, $4, 'personal', $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.id,
        record.organisationId,
        record.projectId,
        record.connectionId,
        record.mode,
        record.availableFrom ?? null,
        record.availableUntil ?? null,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
        record.revokedAt ?? null,
      ],
    );
  }

  async getActiveProjectShare(
    organisationId: string,
    projectId: string,
    connectionId: string,
  ): Promise<AIConnectionProjectShareRecord | null> {
    const result = await this.database.query<AIConnectionShareRow>(
      `SELECT ${SHARE_COLUMNS}
       FROM ai_connection_project_shares
       WHERE organisation_id = $1
         AND project_id = $2
         AND connection_id = $3
         AND revoked_at IS NULL`,
      [organisationId, projectId, connectionId],
    );
    const row = result.rows[0];
    return row ? mapShare(row) : null;
  }

  async listActiveProjectShares(
    organisationId: string,
    projectId: string,
  ): Promise<AIConnectionProjectShareRecord[]> {
    const result = await this.database.query<AIConnectionShareRow>(
      `SELECT ${SHARE_COLUMNS}
       FROM ai_connection_project_shares
       WHERE organisation_id = $1
         AND project_id = $2
         AND revoked_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [organisationId, projectId],
    );
    return result.rows.map(mapShare);
  }

  async listActiveProjectSharesForConnection(
    organisationId: string,
    connectionId: string,
  ): Promise<AIConnectionProjectShareRecord[]> {
    const result = await this.database.query<AIConnectionShareRow>(
      `SELECT ${SHARE_COLUMNS}
       FROM ai_connection_project_shares
       WHERE organisation_id = $1
         AND connection_id = $2
         AND revoked_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [organisationId, connectionId],
    );
    return result.rows.map(mapShare);
  }

  async revokeProjectShare(organisationId: string, id: string, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_connection_project_shares
         SET revoked_at = $3, updated_at = $3
       WHERE organisation_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [organisationId, id, when],
    );
    if (result.rowCount !== 1) throw new Error('active ai connection project share not found');
  }
}
