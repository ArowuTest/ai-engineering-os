import type { DatabaseQueryable } from './queryable.js';

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function mapSession(row: SessionRow): AuthSessionRecord {
  const session: AuthSessionRecord = {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
  if (row.revoked_at) session.revokedAt = new Date(row.revoked_at);
  return session;
}

export class SessionRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(session: AuthSessionRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sessions
        (id, user_id, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.id, session.userId, session.tokenHash, session.createdAt,
       session.expiresAt, session.revokedAt ?? null],
    );
  }

  async getActiveByTokenHash(tokenHash: string, now = new Date()): Promise<AuthSessionRecord | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE auth_sessions SET revoked_at = $2
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, revokedAt],
    );
  }

  async hasActiveForUser(userId: string, now = new Date()): Promise<boolean> {
    const result = await this.database.query<{ present: number }>(
      `SELECT 1 AS present
       FROM auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
       LIMIT 1`,
      [userId, now],
    );
    return result.rows.length > 0;
  }

  async revokeById(id: string, revokedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE auth_sessions SET revoked_at = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [id, revokedAt],
    );
  }
}
