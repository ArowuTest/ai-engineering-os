import type { Project } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface ProjectRow {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Date;
}

function mapProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
  if (row.description !== null) project.description = row.description;
  return project;
}

export class ProjectRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(project: Project): Promise<void> {
    await this.database.query(
      `INSERT INTO projects
        (id, organisation_id, name, description, created_by, created_at)       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        project.id,
        project.organisationId,
        project.name,
        project.description ?? null,
        project.createdBy,
        project.createdAt,
      ],
    );
  }

  async getById(organisationId: string, projectId: string): Promise<Project | null> {
    const result = await this.database.query<ProjectRow>(
      `SELECT id, organisation_id, name, description, created_by, created_at
       FROM projects
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, projectId],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }
}
