import type { AuditEvent } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface AuditRow {
  id: string;
  organisation_id: string;
  project_id: string | null;
  event_type: string;
  actor_type: AuditEvent['actorType'];
  actor_id: string;
  subject_type: string;
  subject_id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

function mapAuditEvent(row: AuditRow): AuditEvent {
  const event: AuditEvent = {
    id: row.id,
    organisationId: row.organisation_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    metadata: row.metadata,
    occurredAt: new Date(row.occurred_at),
  };
  if (row.project_id !== null) event.projectId = row.project_id;
  return event;
}
export class AuditRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async append(event: AuditEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events
        (id, organisation_id, project_id, event_type, actor_type, actor_id,
         subject_type, subject_id, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        event.id,
        event.organisationId,
        event.projectId ?? null,
        event.eventType,
        event.actorType,
        event.actorId,
        event.subjectType,
        event.subjectId,
        event.metadata,
        event.occurredAt,
      ],
    );
  }

  async listByProject(organisationId: string, projectId: string): Promise<AuditEvent[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT id, organisation_id, project_id, event_type, actor_type, actor_id,
              subject_type, subject_id, metadata, occurred_at       FROM audit_events
       WHERE organisation_id = $1 AND project_id = $2
       ORDER BY sequence ASC`,
      [organisationId, projectId],
    );
    return result.rows.map(mapAuditEvent);
  }
}
