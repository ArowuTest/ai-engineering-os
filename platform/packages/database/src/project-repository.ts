import type { ProductPartner, Project, ProjectStage } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface ProjectRow {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  stage: ProjectStage;
  preferred_product_partner: ProductPartner;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function mapProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    stage: row.stage,
    preferredProductPartner: row.preferred_product_partner,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (row.description !== null) project.description = row.description;
  return project;
}

const SELECT_COLUMNS = `
  id, organisation_id, name, description, stage, preferred_product_partner,
  created_by, created_at, updated_at`;

export class ProjectRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(project: Project): Promise<void> {
    await this.database.query(
      `INSERT INTO projects
        (id, organisation_id, name, description, stage, preferred_product_partner,
         created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        project.id,
        project.organisationId,
        project.name,
        project.description ?? null,
        project.stage,
        project.preferredProductPartner,
        project.createdBy,
        project.createdAt,
        project.updatedAt,
      ],
    );
  }
  async getById(organisationId: string, projectId: string): Promise<Project | null> {
    const result = await this.database.query<ProjectRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM projects
       WHERE organisation_id = $1 AND id = $2`,
      [organisationId, projectId],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async listByOrganisation(organisationId: string): Promise<Project[]> {
    const result = await this.database.query<ProjectRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM projects
       WHERE organisation_id = $1
       ORDER BY updated_at DESC, created_at DESC`,
      [organisationId],
    );
    return result.rows.map(mapProject);
  }

  async updateProductPartner(project: Project): Promise<void> {
    const result = await this.database.query(
      `UPDATE projects
       SET preferred_product_partner = $3, updated_at = $4
       WHERE organisation_id = $1 AND id = $2`,
      [project.organisationId, project.id, project.preferredProductPartner, project.updatedAt],
    );
    if (result.rowCount !== 1) throw new Error('project not found for Product Partner update');
  }
}
