import type { StudioInteractionArtifact } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface ArtifactRow {
  id: string;
  organisation_id: string;
  project_id: string;
  kind: StudioInteractionArtifact['kind'];
  source: StudioInteractionArtifact['source'];
  storage_reference: string;
  digest_sha256: string;
  media_type: string;
  byte_size: string | number;
  context_text: string | null;
  visibility: StudioInteractionArtifact['visibility'];
  retention_policy: StudioInteractionArtifact['retentionPolicy'];
  created_by: string;
  created_at: Date;
}

const COLUMNS = `
  id, organisation_id, project_id, kind, source, storage_reference,
  digest_sha256, media_type, byte_size, context_text, visibility,
  retention_policy, created_by, created_at`;

function mapArtifact(row: ArtifactRow): StudioInteractionArtifact {
  const record: StudioInteractionArtifact = {
    id: row.id, organisationId: row.organisation_id, projectId: row.project_id,
    kind: row.kind, source: row.source, storageReference: row.storage_reference,
    digestSha256: row.digest_sha256, mediaType: row.media_type,
    byteSize: Number(row.byte_size), visibility: row.visibility,
    retentionPolicy: row.retention_policy, createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };  if (row.context_text !== null) record.contextText = row.context_text;
  return record;
}

export class StudioInteractionArtifactRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async create(record: StudioInteractionArtifact): Promise<void> {
    await this.database.query(
      `INSERT INTO studio_interaction_artifacts
       (id, organisation_id, project_id, kind, source, storage_reference,
        digest_sha256, media_type, byte_size, context_text, visibility,
        retention_policy, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        record.id, record.organisationId, record.projectId, record.kind, record.source,
        record.storageReference, record.digestSha256, record.mediaType, record.byteSize,
        record.contextText ?? null, record.visibility, record.retentionPolicy,
        record.createdBy, record.createdAt,
      ],
    );
  }

  async getById(
    organisationId: string,
    projectId: string,
    id: string,
  ): Promise<StudioInteractionArtifact | null> {
    const result = await this.database.query<ArtifactRow>(
      `SELECT ${COLUMNS} FROM studio_interaction_artifacts
       WHERE organisation_id=$1 AND project_id=$2 AND id=$3`,
      [organisationId, projectId, id],
    );
    const row = result.rows[0];
    return row ? mapArtifact(row) : null;
  }

  async listByIds(
    organisationId: string,
    projectId: string,
    ids: string[],
  ): Promise<StudioInteractionArtifact[]> {
    if (ids.length === 0) return [];
    const result = await this.database.query<ArtifactRow>(
      `SELECT ${COLUMNS} FROM studio_interaction_artifacts
       WHERE organisation_id=$1 AND project_id=$2 AND id = ANY($3::uuid[])
       ORDER BY array_position($3::uuid[], id)`,
      [organisationId, projectId, ids],
    );
    return result.rows.map(mapArtifact);
  }
}
