import type { DatabaseQueryable } from './queryable.js';

export interface PlatformMembershipRecord {
  userId: string;
  role: 'admin';
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

interface PlatformMembershipRow {
  user_id: string;
  role: 'admin';
  status: 'active' | 'revoked';
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

function mapPlatformMembership(row: PlatformMembershipRow): PlatformMembershipRecord {
  const record: PlatformMembershipRecord = {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

export class PlatformMembershipRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async grantAdmin(input: { userId: string; createdBy: string; now: Date }): Promise<void> {
    await this.database.query(
      `INSERT INTO platform_memberships
       (user_id, role, status, created_by, created_at, updated_at, revoked_at)
       VALUES ($1, 'admin', 'active', $2, $3, $3, NULL)
       ON CONFLICT (user_id) DO UPDATE
       SET role='admin', status='active', updated_at=EXCLUDED.updated_at, revoked_at=NULL`,
      [input.userId, input.createdBy, input.now],
    );
  }

  async get(userId: string): Promise<PlatformMembershipRecord | null> {
    const result = await this.database.query<PlatformMembershipRow>(
      `SELECT user_id, role, status, created_by, created_at, updated_at, revoked_at
       FROM platform_memberships WHERE user_id=$1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? mapPlatformMembership(row) : null;
  }

  async revokeAdmin(userId: string, when: Date): Promise<void> {
    await this.database.query(
      `UPDATE platform_memberships
       SET status='revoked', updated_at=$2, revoked_at=$2
       WHERE user_id=$1 AND status='active'`,
      [userId, when],
    );
  }
}
