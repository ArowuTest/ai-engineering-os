import type { AccountStatus } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

export interface UserAccountRecord {
  id: string;
  userId: string;
  passwordHash: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  user_id: string;
  password_hash: string;
  status: AccountStatus;
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: UserRow): UserAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    passwordHash: row.password_hash,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class UserRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(user: UserAccountRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO users
        (id, user_id, password_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.userId, user.passwordHash, user.status, user.createdAt, user.updatedAt],
    );
  }

  async getByUserId(userId: string): Promise<UserAccountRecord | null> {
    const result = await this.database.query<UserRow>(
      `SELECT id, user_id, password_hash, status, created_at, updated_at
       FROM users WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async getById(id: string): Promise<UserAccountRecord | null> {
    const result = await this.database.query<UserRow>(
      `SELECT id, user_id, password_hash, status, created_at, updated_at
       FROM users WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async getByIdForUpdate(id: string): Promise<UserAccountRecord | null> {
    const result = await this.database.query<UserRow>(
      `SELECT id, user_id, password_hash, status, created_at, updated_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async setStatus(id: string, status: AccountStatus, updatedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE users SET status = $2, updated_at = $3 WHERE id = $1`,
      [id, status, updatedAt],
    );
  }
}
