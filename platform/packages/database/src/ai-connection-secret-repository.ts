import type { DatabaseQueryable } from './queryable.js';

export interface AIConnectionSecretRecord {
  id: string;
  organisationId: string;
  connectionId: string;
  keyVersion: string;
  algorithm: 'aes-256-gcm';
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}

interface Row {
  id: string;
  organisation_id: string;
  connection_id: string;
  key_version: string;
  algorithm: 'aes-256-gcm';
  iv: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
}
const COLUMNS = `id, organisation_id, connection_id, key_version, algorithm,
  iv, ciphertext, auth_tag, created_by, created_at, revoked_at`;

function map(row: Row): AIConnectionSecretRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    connectionId: row.connection_id,
    keyVersion: row.key_version,
    algorithm: row.algorithm,
    iv: Buffer.from(row.iv),
    ciphertext: Buffer.from(row.ciphertext),
    authTag: Buffer.from(row.auth_tag),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at) } : {}),
  };
}

export class AIConnectionSecretRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(record: AIConnectionSecretRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_connection_secrets (${COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [record.id, record.organisationId, record.connectionId, record.keyVersion,       record.algorithm, record.iv, record.ciphertext, record.authTag,
       record.createdBy, record.createdAt, record.revokedAt ?? null],
    );
  }

  async get(
    organisationId: string, connectionId: string, id: string,
  ): Promise<AIConnectionSecretRecord | null> {
    const result = await this.database.query<Row>(
      `SELECT ${COLUMNS} FROM ai_connection_secrets
       WHERE organisation_id=$1 AND connection_id=$2 AND id=$3`,
      [organisationId, connectionId, id],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async getActive(
    organisationId: string, connectionId: string, id: string,
  ): Promise<AIConnectionSecretRecord | null> {
    const result = await this.database.query<Row>(
      `SELECT ${COLUMNS} FROM ai_connection_secrets
       WHERE organisation_id=$1 AND connection_id=$2 AND id=$3
         AND revoked_at IS NULL`,
      [organisationId, connectionId, id],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async revoke(
    organisationId: string, connectionId: string, id: string, revokedAt: Date,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE ai_connection_secrets SET revoked_at=$4
       WHERE organisation_id=$1 AND connection_id=$2 AND id=$3
         AND revoked_at IS NULL`,
      [organisationId, connectionId, id, revokedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error('active AI connection secret not found');
    }
  }
}
