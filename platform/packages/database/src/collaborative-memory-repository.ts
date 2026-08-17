import {
  createAgentHandoff,
  createCollaborativeMemoryRecord,
  createEngineeringSession,
  createMemoryLink,
  rebindEngineeringSessionExecution,
  type AgentHandoff,
  type CollaborativeMemoryRecord,
  type EngineeringSession,
  type MemoryLink,
  type MemoryKind,
  type MemoryScope,
  type MemorySourceType,
  type MemoryTrustState,
  type MemoryVisibility,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface MemoryRow {
  id: string; organisation_id: string | null; project_id: string | null; workstream_id: string | null;
  scope: MemoryScope; visibility: MemoryVisibility; kind: MemoryKind; trust: MemoryTrustState;
  title: string; content: string; content_digest: string; owner_user_id: string | null;
  created_by: string; source_type: MemorySourceType; source_agent_id: string | null;
  source_session_id: string | null; source_harness_id: string | null; source_schema: string | null;
  source_document_digest: string | null; source_reference: string | null; tags: string[]; reviewer_assignment_id: string | null;
  target_agent_ids: string[]; target_session_ids: string[]; target_harness_ids: string[]; created_at: Date;
}

const MEMORY_COLUMNS = `id, organisation_id, project_id, workstream_id, scope, visibility, kind, trust,
  title, content, content_digest, owner_user_id, created_by, source_type, source_agent_id,
  source_session_id, source_harness_id, source_schema, source_document_digest, source_reference, tags,
  reviewer_assignment_id, target_agent_ids, target_session_ids, target_harness_ids, created_at`;
const MEMORY_COLUMNS_FROM_M = MEMORY_COLUMNS.split(',').map((column) => `m.${column.trim()}`).join(', ');
function mapMemory(row: MemoryRow): CollaborativeMemoryRecord {
  const input = {
    id: row.id, scope: row.scope, visibility: row.visibility, kind: row.kind, trust: row.trust,
    title: row.title, content: row.content, createdBy: row.created_by, sourceType: row.source_type,
    createdAt: new Date(row.created_at),
    ...(row.organisation_id === null ? {} : { organisationId: row.organisation_id }),
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ...(row.workstream_id === null ? {} : { workstreamId: row.workstream_id }),
    ...(row.owner_user_id === null ? {} : { ownerUserId: row.owner_user_id }),
    ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }),
    ...(row.source_session_id === null ? {} : { sourceSessionId: row.source_session_id }),
    ...(row.source_harness_id === null ? {} : { sourceHarnessId: row.source_harness_id }),
    ...(row.source_schema === null ? {} : { sourceSchema: row.source_schema }),
    ...(row.source_document_digest === null ? {} : { sourceDocumentDigest: row.source_document_digest }),
    ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
    ...(row.tags.length === 0 ? {} : { tags: [...row.tags] }),
    ...(row.reviewer_assignment_id === null ? {} : { reviewerAssignmentId: row.reviewer_assignment_id }),
    ...(row.target_agent_ids.length === 0 ? {} : { targetAgentIds: [...row.target_agent_ids] }),
    ...(row.target_session_ids.length === 0 ? {} : { targetSessionIds: [...row.target_session_ids] }),
    ...(row.target_harness_ids.length === 0 ? {} : { targetHarnessIds: [...row.target_harness_ids] }),
  };
  const record = createCollaborativeMemoryRecord(input);
  if (record.contentDigest !== row.content_digest) {
    throw new Error(`collaborative memory ${row.id} content digest mismatch`);
  }
  return record;
}

interface SessionRow {
  id: string; organisation_id: string; project_id: string; workstream_id: string | null;
  task_id: string; agent_id: string; status: EngineeringSession['status']; harness_id: string | null;
  model_route_id: string | null; runner_id: string | null; environment_id: string | null;
  workspace_reference: string | null; created_by: string; created_at: Date; updated_at: Date;
}
function mapSession(row: SessionRow): EngineeringSession {
  return {
    id: row.id, organisationId: row.organisation_id, projectId: row.project_id,
    taskId: row.task_id, agentId: row.agent_id, status: row.status,
    createdBy: row.created_by, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    ...(row.workstream_id === null ? {} : { workstreamId: row.workstream_id }),
    ...(row.harness_id === null ? {} : { harnessId: row.harness_id }),
    ...(row.model_route_id === null ? {} : { modelRouteId: row.model_route_id }),
    ...(row.runner_id === null ? {} : { runnerId: row.runner_id }),
    ...(row.environment_id === null ? {} : { environmentId: row.environment_id }),
    ...(row.workspace_reference === null ? {} : { workspaceReference: row.workspace_reference }),
  };
}

interface HandoffRow {
  id: string; organisation_id: string; project_id: string; source_session_id: string;
  source_agent_id: string; target_session_ids: string[]; target_agent_ids: string[];
  summary: string; evidence_references: string[]; blockers: string[]; source_commit: string | null;
  workspace_reference: string | null; created_by: string; created_at: Date;
}

function mapHandoff(row: HandoffRow): AgentHandoff {
  return createAgentHandoff({
    id: row.id, organisationId: row.organisation_id, projectId: row.project_id,
    sourceSessionId: row.source_session_id, sourceAgentId: row.source_agent_id,
    targetSessionIds: [...row.target_session_ids], targetAgentIds: [...row.target_agent_ids],
    summary: row.summary, evidenceReferences: [...row.evidence_references], blockers: [...row.blockers],
    createdBy: row.created_by, createdAt: new Date(row.created_at),
    ...(row.source_commit === null ? {} : { sourceCommit: row.source_commit }),
    ...(row.workspace_reference === null ? {} : { workspaceReference: row.workspace_reference }),
  });
}
export class CollaborativeMemoryRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createMemory(input: CollaborativeMemoryRecord): Promise<void> {
    const memory = createCollaborativeMemoryRecord(input);
    await this.database.query(
      `INSERT INTO collaborative_memories
        (${MEMORY_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        memory.id, memory.organisationId ?? null, memory.projectId ?? null, memory.workstreamId ?? null,
        memory.scope, memory.visibility, memory.kind, memory.trust, memory.title, memory.content,
        memory.contentDigest, memory.ownerUserId ?? null, memory.createdBy, memory.sourceType,
        memory.sourceAgentId ?? null, memory.sourceSessionId ?? null, memory.sourceHarnessId ?? null,
        memory.sourceSchema ?? null, memory.sourceDocumentDigest ?? null, memory.sourceReference ?? null, memory.tags ?? [],
        memory.reviewerAssignmentId ?? null, memory.targetAgentIds ?? [], memory.targetSessionIds ?? [],
        memory.targetHarnessIds ?? [], memory.createdAt,
      ],
    );
  }

  async getProjectMemory(organisationId: string, projectId: string, memoryId: string): Promise<CollaborativeMemoryRecord | null> {
    const result = await this.database.query<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM collaborative_memories
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
      [organisationId, projectId, memoryId],
    );
    return result.rows[0] ? mapMemory(result.rows[0]) : null;
  }

  async getUserMemory(ownerUserId: string, memoryId: string): Promise<CollaborativeMemoryRecord | null> {
    const result = await this.database.query<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM collaborative_memories
       WHERE scope = 'user' AND owner_user_id = $1 AND id = $2`,
      [ownerUserId, memoryId],
    );
    return result.rows[0] ? mapMemory(result.rows[0]) : null;
  }
  async listProjectMemoriesForUser(
    organisationId: string,
    projectId: string,
    userId: string,
  ): Promise<CollaborativeMemoryRecord[]> {
    const result = await this.database.query<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS_FROM_M}
       FROM collaborative_memories m
       JOIN project_memberships pm
         ON pm.organisation_id = m.organisation_id AND pm.project_id = m.project_id
       JOIN organisation_memberships om
         ON om.organisation_id = pm.organisation_id AND om.user_id = pm.user_id
       JOIN users u ON u.id = pm.user_id
       WHERE m.organisation_id = $1 AND m.project_id = $2 AND pm.user_id = $3
         AND pm.status = 'active' AND om.status = 'active' AND u.status = 'active'
       ORDER BY m.created_at ASC, m.id ASC`,
      [organisationId, projectId, userId],
    );
    return result.rows.map(mapMemory);
  }

  async addLink(organisationId: string, projectId: string, input: MemoryLink): Promise<void> {
    const link = createMemoryLink(input);
    await this.database.query(
      `INSERT INTO collaborative_memory_links
        (organisation_id, project_id, source_memory_id, target_memory_id, relation)
       VALUES ($1,$2,$3,$4,$5)`,
      [organisationId, projectId, link.sourceMemoryId, link.targetMemoryId, link.relation],
    );
  }

  async listLinks(organisationId: string, projectId: string, sourceMemoryId: string): Promise<MemoryLink[]> {
    const result = await this.database.query<{ source_memory_id: string; target_memory_id: string; relation: MemoryLink['relation'] }>(
      `SELECT source_memory_id, target_memory_id, relation FROM collaborative_memory_links
       WHERE organisation_id = $1 AND project_id = $2 AND source_memory_id = $3
       ORDER BY target_memory_id, relation`,
      [organisationId, projectId, sourceMemoryId],
    );
    return result.rows.map((row) => createMemoryLink({
      sourceMemoryId: row.source_memory_id, targetMemoryId: row.target_memory_id, relation: row.relation,
    }));
  }
  async createHandoff(input: AgentHandoff): Promise<void> {
    const handoff = createAgentHandoff(input);
    await this.database.query(
      `INSERT INTO agent_handoffs
        (id, organisation_id, project_id, source_session_id, source_agent_id,
         target_session_ids, target_agent_ids, summary, evidence_references, blockers,
         source_commit, workspace_reference, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        handoff.id, handoff.organisationId, handoff.projectId, handoff.sourceSessionId,
        handoff.sourceAgentId, handoff.targetSessionIds, handoff.targetAgentIds, handoff.summary,
        handoff.evidenceReferences, handoff.blockers, handoff.sourceCommit ?? null,
        handoff.workspaceReference ?? null, handoff.createdBy, handoff.createdAt,
      ],
    );
  }

  async getHandoff(organisationId: string, projectId: string, handoffId: string): Promise<AgentHandoff | null> {
    const result = await this.database.query<HandoffRow>(
      `SELECT id, organisation_id, project_id, source_session_id, source_agent_id,
              target_session_ids, target_agent_ids, summary, evidence_references, blockers,
              source_commit, workspace_reference, created_by, created_at
       FROM agent_handoffs
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
      [organisationId, projectId, handoffId],
    );
    return result.rows[0] ? mapHandoff(result.rows[0]) : null;
  }
}

const SESSION_COLUMNS = `id, organisation_id, project_id, workstream_id, task_id, agent_id,
  status, harness_id, model_route_id, runner_id, environment_id, workspace_reference,
  created_by, created_at, updated_at`;

export class EngineeringSessionRepository {
  constructor(private readonly database: DatabaseQueryable) {}
  async create(input: EngineeringSession): Promise<void> {
    const session = createEngineeringSession(input);
    await this.database.query(
      `INSERT INTO engineering_sessions (${SESSION_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        session.id, session.organisationId, session.projectId, session.workstreamId ?? null,
        session.taskId, session.agentId, session.status, session.harnessId ?? null,
        session.modelRouteId ?? null, session.runnerId ?? null, session.environmentId ?? null,
        session.workspaceReference ?? null, session.createdBy, session.createdAt, session.updatedAt,
      ],
    );
  }

  async get(organisationId: string, projectId: string, sessionId: string): Promise<EngineeringSession | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM engineering_sessions
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
      [organisationId, projectId, sessionId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async rebindExecution(input: EngineeringSession): Promise<void> {
    const session = rebindEngineeringSessionExecution(input, {
      ...(input.harnessId === undefined ? {} : { harnessId: input.harnessId }),
      ...(input.modelRouteId === undefined ? {} : { modelRouteId: input.modelRouteId }),
      ...(input.runnerId === undefined ? {} : { runnerId: input.runnerId }),
      ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
      ...(input.workspaceReference === undefined ? {} : { workspaceReference: input.workspaceReference }),
      updatedAt: input.updatedAt,
    });
    const result = await this.database.query(
      `UPDATE engineering_sessions SET
         status = $4, harness_id = $5, model_route_id = $6, runner_id = $7,
         environment_id = $8, workspace_reference = $9, updated_at = $10
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
      [
        session.organisationId, session.projectId, session.id, session.status,
        session.harnessId ?? null, session.modelRouteId ?? null, session.runnerId ?? null,
        session.environmentId ?? null, session.workspaceReference ?? null, session.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error('engineering session not found for rebind');
  }
}
