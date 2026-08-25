import type { AuditEvent, PlatformAuditEvent } from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

type PersistedAuditEvent = AuditEvent | PlatformAuditEvent;

interface AuditRow {
  id: string;
  organisation_id: string | null;
  project_id: string | null;
  event_type: string;
  actor_type: AuditEvent['actorType'];
  actor_id: string;
  subject_type: string;
  subject_id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

function base(row: AuditRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    metadata: row.metadata,
    occurredAt: new Date(row.occurred_at),
  };
}

function mapAuditEvent(row: AuditRow): PersistedAuditEvent {
  if (row.organisation_id === null) return base(row);
  const event: AuditEvent = { ...base(row), organisationId: row.organisation_id };
  if (row.project_id !== null) event.projectId = row.project_id;
  return event;
}

const COLUMNS = `id, organisation_id, project_id, event_type, actor_type, actor_id,
  subject_type, subject_id, metadata, occurred_at`;

export class AuditRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async append(event: PersistedAuditEvent): Promise<void> {
    const organisationId = 'organisationId' in event ? event.organisationId : null;
    const projectId = 'projectId' in event ? event.projectId ?? null : null;
    await this.database.query(
      `INSERT INTO audit_events
       (id, organisation_id, project_id, event_type, actor_type, actor_id,
        subject_type, subject_id, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.id, organisationId, projectId, event.eventType, event.actorType,
       event.actorId, event.subjectType, event.subjectId, event.metadata, event.occurredAt],
    );
  }

  async listByProject(organisationId: string, projectId: string): Promise<AuditEvent[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT ${COLUMNS} FROM audit_events
       WHERE organisation_id=$1 AND project_id=$2 ORDER BY sequence ASC`,
      [organisationId, projectId],
    );
    return result.rows.map(mapAuditEvent) as AuditEvent[];
  }

  async listByOrganisation(organisationId: string): Promise<AuditEvent[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT ${COLUMNS} FROM audit_events
       WHERE organisation_id=$1 ORDER BY sequence ASC`,
      [organisationId],
    );
    return result.rows.map(mapAuditEvent) as AuditEvent[];
  }

  async listPlatform(): Promise<PlatformAuditEvent[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT ${COLUMNS} FROM audit_events
       WHERE organisation_id IS NULL AND project_id IS NULL ORDER BY sequence ASC`,
    );
    return result.rows.map(mapAuditEvent) as PlatformAuditEvent[];
  }
}
