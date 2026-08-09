import type { OrganisationRole, ProjectRole } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

export type MembershipStatus = 'active' | 'revoked';

export interface OrganisationMembershipRecord {
  organisationId: string;
  userId: string;
  role: OrganisationRole;
  status: MembershipStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMembershipRecord {
  organisationId: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  status: MembershipStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OrganisationMembershipRow {
  organisation_id: string;
  user_id: string;
  role: OrganisationRole;
  status: MembershipStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface ProjectMembershipRow {
  organisation_id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  status: MembershipStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function mapOrganisation(row: OrganisationMembershipRow): OrganisationMembershipRecord {
  return {
    organisationId: row.organisation_id, userId: row.user_id, role: row.role,
    status: row.status, createdBy: row.created_by,
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
  };
}

function mapProject(row: ProjectMembershipRow): ProjectMembershipRecord {
  return {
    organisationId: row.organisation_id, projectId: row.project_id,
    userId: row.user_id, role: row.role, status: row.status,
    createdBy: row.created_by, createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class MembershipRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async grantOrganisation(input: {
    organisationId: string; userId: string; role: OrganisationRole;
    createdBy: string; now: Date;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO organisation_memberships
        (organisation_id, user_id, role, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $5)
       ON CONFLICT (organisation_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = 'active', updated_at = EXCLUDED.updated_at`,
      [input.organisationId, input.userId, input.role, input.createdBy, input.now],
    );
  }

  async getOrganisation(
    organisationId: string,
    userId: string,
  ): Promise<OrganisationMembershipRecord | null> {
    const result = await this.database.query<OrganisationMembershipRow>(
      `SELECT organisation_id, user_id, role, status, created_by, created_at, updated_at
       FROM organisation_memberships
       WHERE organisation_id = $1 AND user_id = $2`,
      [organisationId, userId],
    );
    const row = result.rows[0];
    return row ? mapOrganisation(row) : null;
  }

  async revokeOrganisation(organisationId: string, userId: string, now: Date): Promise<void> {
    await this.database.query(
      `UPDATE organisation_memberships
       SET status = 'revoked', updated_at = $3
       WHERE organisation_id = $1 AND user_id = $2`,
      [organisationId, userId, now],
    );
  }

  async grantProject(input: {
    organisationId: string; projectId: string; userId: string;
    role: ProjectRole; createdBy: string; now: Date;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO project_memberships
        (organisation_id, project_id, user_id, role, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $6)
       ON CONFLICT (organisation_id, project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = 'active', updated_at = EXCLUDED.updated_at`,
      [input.organisationId, input.projectId, input.userId, input.role, input.createdBy, input.now],
    );
  }

  async getProject(
    organisationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMembershipRecord | null> {
    const result = await this.database.query<ProjectMembershipRow>(
      `SELECT organisation_id, project_id, user_id, role, status,
              created_by, created_at, updated_at
       FROM project_memberships
       WHERE organisation_id = $1 AND project_id = $2 AND user_id = $3`,
      [organisationId, projectId, userId],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async revokeProject(
    organisationId: string,
    projectId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.database.query(
      `UPDATE project_memberships
       SET status = 'revoked', updated_at = $4
       WHERE organisation_id = $1 AND project_id = $2 AND user_id = $3`,
      [organisationId, projectId, userId, now],
    );
  }

  async listActiveProjects(organisationId: string, userId: string): Promise<ProjectMembershipRecord[]> {
    const result = await this.database.query<ProjectMembershipRow>(
      `SELECT organisation_id, project_id, user_id, role, status,
              created_by, created_at, updated_at
       FROM project_memberships
       WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'
       ORDER BY created_at ASC`,
      [organisationId, userId],
    );
    return result.rows.map(mapProject);
  }

  async listOrganisationMembers(organisationId: string): Promise<OrganisationMembershipRecord[]> {
    const result = await this.database.query<OrganisationMembershipRow>(
      `SELECT organisation_id, user_id, role, status, created_by, created_at, updated_at
       FROM organisation_memberships
       WHERE organisation_id = $1
       ORDER BY created_at ASC`,
      [organisationId],
    );
    return result.rows.map(mapOrganisation);
  }

  async revokeAllProjectsForUser(organisationId: string, userId: string, now: Date): Promise<void> {
    await this.database.query(
      `UPDATE project_memberships
       SET status = 'revoked', updated_at = $3
       WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'`,
      [organisationId, userId, now],
    );
  }

  async listActiveOrganisations(userId: string): Promise<OrganisationMembershipRecord[]> {
    const result = await this.database.query<OrganisationMembershipRow>(
      `SELECT organisation_id, user_id, role, status, created_by, created_at, updated_at
       FROM organisation_memberships
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows.map(mapOrganisation);
  }
}
