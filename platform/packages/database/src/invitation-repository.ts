import type { InvitationStatus, OrganisationRole, ProjectRole } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

export interface InvitationRecord {
  id: string;
  organisationId: string;
  tokenHash: string;
  organisationRole: OrganisationRole;
  status: InvitationStatus;
  issuedBy: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
  consumedByUserId?: string;
  supersedesInvitationId?: string;
}

export interface InvitationProjectGrant {
  projectId: string;
  role: ProjectRole;
}

interface InvitationRow {
  id: string;
  organisation_id: string;
  token_hash: string;
  organisation_role: OrganisationRole;
  status: InvitationStatus;
  issued_by: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_by_user_id: string | null;
  supersedes_invitation_id: string | null;
}

function mapInvitation(row: InvitationRow): InvitationRecord {
  const invitation: InvitationRecord = {
    id: row.id,
    organisationId: row.organisation_id,
    tokenHash: row.token_hash,
    organisationRole: row.organisation_role,
    status: row.status,
    issuedBy: row.issued_by,
    issuedAt: new Date(row.issued_at),
    expiresAt: new Date(row.expires_at),
  };
  if (row.consumed_at) invitation.consumedAt = new Date(row.consumed_at);
  if (row.consumed_by_user_id) invitation.consumedByUserId = row.consumed_by_user_id;
  if (row.supersedes_invitation_id) invitation.supersedesInvitationId = row.supersedes_invitation_id;
  return invitation;
}

export class InvitationRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(invitation: InvitationRecord, grants: InvitationProjectGrant[]): Promise<void> {
    await this.database.query(
      `INSERT INTO invitations
        (id, organisation_id, token_hash, organisation_role, status,
         issued_by, issued_at, expires_at, supersedes_invitation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [invitation.id, invitation.organisationId, invitation.tokenHash,
       invitation.organisationRole, invitation.status, invitation.issuedBy,
       invitation.issuedAt, invitation.expiresAt, invitation.supersedesInvitationId ?? null],
    );
    for (const grant of grants) {
      await this.database.query(
        `INSERT INTO invitation_project_grants
          (invitation_id, organisation_id, project_id, role)
         VALUES ($1, $2, $3, $4)`,
        [invitation.id, invitation.organisationId, grant.projectId, grant.role],
      );
    }
  }

  async getByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT id, organisation_id, token_hash, organisation_role, status,
              issued_by, issued_at, expires_at, consumed_at,
              consumed_by_user_id, supersedes_invitation_id
       FROM invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? mapInvitation(row) : null;
  }

  async getById(id: string): Promise<InvitationRecord | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT id, organisation_id, token_hash, organisation_role, status,
              issued_by, issued_at, expires_at, consumed_at,
              consumed_by_user_id, supersedes_invitation_id
       FROM invitations WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapInvitation(row) : null;
  }

  async getByTokenHashForUpdate(tokenHash: string): Promise<InvitationRecord | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT id, organisation_id, token_hash, organisation_role, status,
              issued_by, issued_at, expires_at, consumed_at,
              consumed_by_user_id, supersedes_invitation_id
       FROM invitations WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? mapInvitation(row) : null;
  }

  async getDefaultTtlMinutes(organisationId: string): Promise<number> {
    const result = await this.database.query<{ invitation_ttl_minutes: number }>(
      `SELECT invitation_ttl_minutes FROM organisations WHERE id = $1`,
      [organisationId],
    );
    const value = result.rows[0]?.invitation_ttl_minutes;
    if (value === undefined) throw new Error('Organisation not found');
    return value;
  }

  async listProjectGrants(invitationId: string): Promise<InvitationProjectGrant[]> {
    const result = await this.database.query<{ project_id: string; role: ProjectRole }>(
      `SELECT project_id, role
       FROM invitation_project_grants
       WHERE invitation_id = $1
       ORDER BY project_id ASC`,
      [invitationId],
    );
    return result.rows.map((row) => ({ projectId: row.project_id, role: row.role }));
  }

  async markConsumed(id: string, userId: string, consumedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE invitations
       SET status = 'consumed', consumed_at = $2, consumed_by_user_id = $3
       WHERE id = $1 AND status = 'pending'`,
      [id, consumedAt, userId],
    );
  }

  async listByOrganisation(organisationId: string): Promise<InvitationRecord[]> {
    const result = await this.database.query<InvitationRow>(
      `SELECT id, organisation_id, token_hash, organisation_role, status,
              issued_by, issued_at, expires_at, consumed_at,
              consumed_by_user_id, supersedes_invitation_id
       FROM invitations
       WHERE organisation_id = $1
       ORDER BY issued_at DESC`,
      [organisationId],
    );
    return result.rows.map(mapInvitation);
  }

  async setDefaultTtlMinutes(organisationId: string, ttlMinutes: number): Promise<void> {
    await this.database.query(
      `UPDATE organisations SET invitation_ttl_minutes = $2 WHERE id = $1`,
      [organisationId, ttlMinutes],
    );
  }

  async setStatus(id: string, status: Extract<InvitationStatus, 'expired' | 'revoked' | 'replaced'>): Promise<void> {
    await this.database.query(
      `UPDATE invitations SET status = $2 WHERE id = $1 AND status = 'pending'`,
      [id, status],
    );
  }
}
