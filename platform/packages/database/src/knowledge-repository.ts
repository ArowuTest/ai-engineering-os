import type { ProductKnowledge } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface KnowledgeRow {
  id: string;
  revision: number;
  organisation_id: string;
  project_id: string;
  category: string;
  title: string;
  content: string;
  source: string;
  status: ProductKnowledge['status'];
  created_by: string;
  created_at: Date;
}

function mapKnowledge(row: KnowledgeRow): ProductKnowledge {
  return {
    id: row.id,
    revision: row.revision,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
export class KnowledgeRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(record: ProductKnowledge): Promise<void> {
    if (record.revision !== 1) {
      throw new Error('initial knowledge record must use revision 1');
    }
    await this.insert(record);
  }

  async addRevision(record: ProductKnowledge): Promise<void> {
    const latest = await this.database.query<{ revision: number }>(
      `SELECT revision
       FROM product_knowledge
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
       ORDER BY revision DESC
       LIMIT 1`,
      [record.organisationId, record.projectId, record.id],
    );
    const current = latest.rows[0];
    if (!current) throw new Error('knowledge record not found for revision');

    const expected = current.revision + 1;
    if (record.revision !== expected) {
      throw new Error(`expected revision ${expected}, received ${record.revision}`);
    }
    await this.insert(record);
  }
  async getById(
    organisationId: string,
    projectId: string,
    knowledgeId: string,
  ): Promise<ProductKnowledge | null> {
    const result = await this.database.query<KnowledgeRow>(
      `SELECT id, revision, organisation_id, project_id, category, title,
              content, source, status, created_by, created_at
       FROM product_knowledge
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
       ORDER BY revision DESC
       LIMIT 1`,
      [organisationId, projectId, knowledgeId],
    );
    const row = result.rows[0];
    return row ? mapKnowledge(row) : null;
  }

  async listByProject(
    organisationId: string,
    projectId: string,
  ): Promise<ProductKnowledge[]> {
    const result = await this.database.query<KnowledgeRow>(
      `SELECT DISTINCT ON (id)
              id, revision, organisation_id, project_id, category, title,
              content, source, status, created_by, created_at
       FROM product_knowledge
       WHERE organisation_id = $1 AND project_id = $2
       ORDER BY id, revision DESC`,
      [organisationId, projectId],
    );    return result.rows.map(mapKnowledge);
  }

  private async insert(record: ProductKnowledge): Promise<void> {
    await this.database.query(
      `INSERT INTO product_knowledge
        (id, revision, organisation_id, project_id, category, title,
         content, source, status, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.id,
        record.revision,
        record.organisationId,
        record.projectId,
        record.category,
        record.title,
        record.content,
        record.source,
        record.status,
        record.createdBy,
        record.createdAt,
      ],
    );
  }
}
