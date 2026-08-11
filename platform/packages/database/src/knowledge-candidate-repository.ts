import type {
  KnowledgeCandidate,
  KnowledgeCandidateStatus,
  KnowledgeExtractionRun,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface ExtractionRunRow {
  id: string;
  organisation_id: string;
  project_id: string;
  conversation_id: string;
  source_user_message_id: string;
  source_assistant_message_id: string;
  provider: string;
  model: string;
  route_id: string;
  response_contract_version: string;
  status: KnowledgeExtractionRun['status'];
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface CandidateRow {
  id: string;
  organisation_id: string;
  project_id: string;
  extraction_run_id: string;
  category: KnowledgeCandidate['category'];
  title: string;
  original_content: string;
  basis: KnowledgeCandidate['basis'];
  status: KnowledgeCandidateStatus;
  fingerprint: string;
  reviewer_id: string | null;
  reviewed_at: Date | null;
  accepted_knowledge_id: string | null;
  rejection_reason: string | null;
  created_at: Date;
}

export interface StoredKnowledgeExtractionRun extends KnowledgeExtractionRun {
  failureCode?: string;
  failureMessage?: string;
}

export interface StoredKnowledgeCandidate extends KnowledgeCandidate {
  reviewerId?: string;
  reviewedAt?: Date;
  acceptedKnowledgeId?: string;
  rejectionReason?: string;
}

export interface StoredKnowledgeCandidateWithSourceRun extends StoredKnowledgeCandidate {
  sourceRun: StoredKnowledgeExtractionRun;
}

function mapRun(row: ExtractionRunRow): StoredKnowledgeExtractionRun {
  const run: StoredKnowledgeExtractionRun = {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    sourceUserMessageId: row.source_user_message_id,
    sourceAssistantMessageId: row.source_assistant_message_id,
    provider: row.provider,
    model: row.model,
    routeId: row.route_id,
    responseContractVersion: row.response_contract_version,
    status: row.status,
    createdAt: new Date(row.created_at),
  };
  if (row.completed_at !== null) run.completedAt = new Date(row.completed_at);
  if (row.failure_code !== null) run.failureCode = row.failure_code;
  if (row.failure_message !== null) run.failureMessage = row.failure_message;
  return run;
}

function mapCandidate(row: CandidateRow): StoredKnowledgeCandidate {
  const candidate: StoredKnowledgeCandidate = {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    extractionRunId: row.extraction_run_id,
    category: row.category,
    title: row.title,
    content: row.original_content,
    basis: row.basis,
    status: row.status,
    fingerprint: row.fingerprint,
    createdAt: new Date(row.created_at),
  };
  if (row.reviewer_id !== null) candidate.reviewerId = row.reviewer_id;
  if (row.reviewed_at !== null) candidate.reviewedAt = new Date(row.reviewed_at);
  if (row.accepted_knowledge_id !== null) candidate.acceptedKnowledgeId = row.accepted_knowledge_id;
  if (row.rejection_reason !== null) candidate.rejectionReason = row.rejection_reason;
  return candidate;
}

const runColumns = `
  id, organisation_id, project_id, conversation_id,
  source_user_message_id, source_assistant_message_id,
  provider, model, route_id, response_contract_version, status,
  failure_code, failure_message, created_at, completed_at
`;

const candidateColumns = `
  id, organisation_id, project_id, extraction_run_id, category, title,
  original_content, basis, status, fingerprint, reviewer_id, reviewed_at,
  accepted_knowledge_id, rejection_reason, created_at
`;

export class KnowledgeCandidateRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createRun(run: KnowledgeExtractionRun): Promise<void> {
    await this.database.query(
      `INSERT INTO knowledge_extraction_runs (
         id, organisation_id, project_id, conversation_id,
         source_user_message_id, source_assistant_message_id,
         provider, model, route_id, response_contract_version,
         status, created_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        run.id,
        run.organisationId,
        run.projectId,
        run.conversationId,
        run.sourceUserMessageId,
        run.sourceAssistantMessageId,
        run.provider,
        run.model,
        run.routeId,
        run.responseContractVersion,
        run.status,
        run.createdAt,
        run.completedAt ?? null,
      ],
    );
  }

  async getRunById(
    organisationId: string,
    projectId: string,
    runId: string,
  ): Promise<StoredKnowledgeExtractionRun | null> {
    const result = await this.database.query<ExtractionRunRow>(
      `SELECT ${runColumns}
       FROM knowledge_extraction_runs
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3`,
      [organisationId, projectId, runId],
    );
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  async markRunSucceeded(
    organisationId: string,
    projectId: string,
    runId: string,
    completedAt: Date,
  ): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      `UPDATE knowledge_extraction_runs
       SET status = 'succeeded', completed_at = $4,
           failure_code = NULL, failure_message = NULL
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
         AND status = 'received'
       RETURNING id`,
      [organisationId, projectId, runId, completedAt],
    );
    if (result.rowCount !== 1) throw new Error('extraction run is not received');
  }

  async markRunFailed(
    organisationId: string,
    projectId: string,
    runId: string,
    failureCode: string,
    failureMessage: string | null,
    completedAt: Date,
  ): Promise<void> {
    const code = failureCode.trim();
    if (!code) throw new Error('failure code must be non-blank');
    const message = failureMessage?.trim() || null;
    const result = await this.database.query<{ id: string }>(
      `UPDATE knowledge_extraction_runs
       SET status = 'failed', completed_at = $4,
           failure_code = $5, failure_message = $6
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
         AND status = 'received'
       RETURNING id`,
      [organisationId, projectId, runId, completedAt, code, message],
    );
    if (result.rowCount !== 1) throw new Error('extraction run is not received');
  }

  async insertCandidate(candidate: KnowledgeCandidate): Promise<void> {
    if (candidate.status !== 'pending') {
      throw new Error('new knowledge candidate must be pending');
    }
    await this.database.query(
      `INSERT INTO knowledge_candidates (
         id, organisation_id, project_id, extraction_run_id,
         category, title, original_content, basis, status,
         fingerprint, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        candidate.id,
        candidate.organisationId,
        candidate.projectId,
        candidate.extractionRunId,
        candidate.category,
        candidate.title,
        candidate.content,
        candidate.basis,
        candidate.status,
        candidate.fingerprint,
        candidate.createdAt,
      ],
    );
  }

  async listByProject(
    organisationId: string,
    projectId: string,
    status?: KnowledgeCandidateStatus,
  ): Promise<StoredKnowledgeCandidate[]> {
    const values: unknown[] = [organisationId, projectId];
    const statusClause = status === undefined ? '' : ' AND status = $3';
    if (status !== undefined) values.push(status);
    const result = await this.database.query<CandidateRow>(
      `SELECT ${candidateColumns}
       FROM knowledge_candidates
       WHERE organisation_id = $1 AND project_id = $2${statusClause}
       ORDER BY created_at ASC, id ASC`,
      values,
    );
    return result.rows.map(mapCandidate);
  }

  async listByProjectWithSourceRun(
    organisationId: string,
    projectId: string,
    status?: KnowledgeCandidateStatus,
  ): Promise<StoredKnowledgeCandidateWithSourceRun[]> {
    const values: unknown[] = [organisationId, projectId];
    const statusClause = status === undefined ? '' : ' AND c.status = $3';
    if (status !== undefined) values.push(status);
    const result = await this.database.query<CandidateRow & { run_id: string; run_organisation_id: string; run_project_id: string; run_conversation_id: string; run_source_user_message_id: string; run_source_assistant_message_id: string; run_provider: string; run_model: string; run_route_id: string; run_response_contract_version: string; run_status: KnowledgeExtractionRun['status']; run_failure_code: string | null; run_failure_message: string | null; run_created_at: Date; run_completed_at: Date | null }>(
      `SELECT
         c.id, c.organisation_id, c.project_id, c.extraction_run_id, c.category, c.title,
         c.original_content, c.basis, c.status, c.fingerprint, c.reviewer_id, c.reviewed_at,
         c.accepted_knowledge_id, c.rejection_reason, c.created_at,
         r.id AS run_id, r.organisation_id AS run_organisation_id, r.project_id AS run_project_id,
         r.conversation_id AS run_conversation_id,
         r.source_user_message_id AS run_source_user_message_id,
         r.source_assistant_message_id AS run_source_assistant_message_id,
         r.provider AS run_provider, r.model AS run_model, r.route_id AS run_route_id,
         r.response_contract_version AS run_response_contract_version,
         r.status AS run_status, r.failure_code AS run_failure_code,
         r.failure_message AS run_failure_message,
         r.created_at AS run_created_at, r.completed_at AS run_completed_at
       FROM knowledge_candidates c
       JOIN knowledge_extraction_runs r
         ON r.organisation_id = c.organisation_id
        AND r.project_id = c.project_id
        AND r.id = c.extraction_run_id
       WHERE c.organisation_id = $1 AND c.project_id = $2${statusClause}
       ORDER BY c.created_at ASC, c.id ASC`,
      values,
    );
    return result.rows.map((row) => ({
      ...mapCandidate(row),
      sourceRun: mapRun({
        id: row.run_id,
        organisation_id: row.run_organisation_id,
        project_id: row.run_project_id,
        conversation_id: row.run_conversation_id,
        source_user_message_id: row.run_source_user_message_id,
        source_assistant_message_id: row.run_source_assistant_message_id,
        provider: row.run_provider,
        model: row.run_model,
        route_id: row.run_route_id,
        response_contract_version: row.run_response_contract_version,
        status: row.run_status,
        failure_code: row.run_failure_code,
        failure_message: row.run_failure_message,
        created_at: row.run_created_at,
        completed_at: row.run_completed_at,
      }),
    }));
  }

  // Returns the newest failed extraction run for the project whose SAME source turn lineage
  // (source_user_message_id + source_assistant_message_id) has not since been recovered by a
  // successful run. Retries reuse the original run's source message ids
  // (see retryExtractionRun in knowledge-candidate-service.ts), so this predicate exactly
  // encodes "failed run whose retry has not itself succeeded". An unrelated later Product
  // Partner turn — different source message ids — does not hide a still-retryable failed run.
  async getLatestFailedExtractionRun(
    organisationId: string,
    projectId: string,
  ): Promise<StoredKnowledgeExtractionRun | null> {
    const result = await this.database.query<ExtractionRunRow>(
      `SELECT ${runColumns}
       FROM knowledge_extraction_runs
       WHERE organisation_id = $1 AND project_id = $2 AND status = 'failed'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_extraction_runs recovered
           WHERE recovered.organisation_id = knowledge_extraction_runs.organisation_id
             AND recovered.project_id = knowledge_extraction_runs.project_id
             AND recovered.status = 'succeeded'
             AND recovered.source_user_message_id = knowledge_extraction_runs.source_user_message_id
             AND recovered.source_assistant_message_id = knowledge_extraction_runs.source_assistant_message_id
             AND recovered.created_at > knowledge_extraction_runs.created_at
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [organisationId, projectId],
    );
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  async listPendingFingerprintsByProject(
    organisationId: string,
    projectId: string,
  ): Promise<string[]> {
    const result = await this.database.query<{ fingerprint: string }>(
      `SELECT fingerprint
       FROM knowledge_candidates
       WHERE organisation_id = $1 AND project_id = $2 AND status = 'pending'`,
      [organisationId, projectId],
    );
    return result.rows.map((row) => row.fingerprint);
  }

  async getCandidateForUpdate(
    organisationId: string,
    projectId: string,
    candidateId: string,
  ): Promise<StoredKnowledgeCandidate | null> {
    const result = await this.database.query<CandidateRow>(
      `SELECT ${candidateColumns}
       FROM knowledge_candidates
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
       FOR UPDATE`,
      [organisationId, projectId, candidateId],
    );
    const row = result.rows[0];
    return row ? mapCandidate(row) : null;
  }

  async acceptCandidateDecision(
    organisationId: string,
    projectId: string,
    candidateId: string,
    reviewerId: string,
    reviewedAt: Date,
    acceptedKnowledgeId: string,
  ): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      `UPDATE knowledge_candidates
       SET status = 'accepted', reviewer_id = $4, reviewed_at = $5,
           accepted_knowledge_id = $6, rejection_reason = NULL
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
         AND status = 'pending'
       RETURNING id`,
      [organisationId, projectId, candidateId, reviewerId, reviewedAt, acceptedKnowledgeId],
    );
    if (result.rowCount !== 1) throw new Error('candidate is not pending');
  }

  async getRunForUpdate(
    organisationId: string,
    projectId: string,
    runId: string,
  ): Promise<StoredKnowledgeExtractionRun | null> {
    const result = await this.database.query<ExtractionRunRow>(
      `SELECT ${runColumns}
       FROM knowledge_extraction_runs
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
       FOR UPDATE`,
      [organisationId, projectId, runId],
    );
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  // Acquires a transaction-scoped advisory lock keyed to (organisationId, projectId, originalRunId)
  // to serialize retry writes. The lock is released automatically at COMMIT/ROLLBACK, so callers
  // must invoke this inside a UoW transaction.
  async acquireRetryAdvisoryLock(
    organisationId: string,
    projectId: string,
    originalRunId: string,
  ): Promise<void> {
    await this.database.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('knowledge-extraction-retry:' || $1 || ':' || $2 || ':' || $3, 0)
       )`,
      [organisationId, projectId, originalRunId],
    );
  }

  // Returns true iff a knowledge_extraction_run.retry_completed audit event for the given
  // original run committed after `since`. Used to detect that an originally-concurrent retry
  // won the write race while this request was still in flight.
  async hasRetryCompletedSince(
    organisationId: string,
    projectId: string,
    originalRunId: string,
    since: Date,
  ): Promise<boolean> {
    const result = await this.database.query<{ exists: number }>(
      `SELECT 1 AS exists
         FROM audit_events
        WHERE organisation_id = $1
          AND project_id = $2
          AND event_type = 'knowledge_extraction_run.retry_completed'
          AND metadata ->> 'originalRunId' = $3
          AND occurred_at > $4
        LIMIT 1`,
      [organisationId, projectId, originalRunId, since],
    );
    return result.rowCount === 1;
  }

  async rejectCandidateDecision(
    organisationId: string,
    projectId: string,
    candidateId: string,
    reviewerId: string,
    reviewedAt: Date,
    rejectionReason?: string,
  ): Promise<void> {
    const reason = rejectionReason?.trim() || null;
    const result = await this.database.query<{ id: string }>(
      `UPDATE knowledge_candidates
       SET status = 'rejected', reviewer_id = $4, reviewed_at = $5,
           accepted_knowledge_id = NULL, rejection_reason = $6
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
         AND status = 'pending'
       RETURNING id`,
      [organisationId, projectId, candidateId, reviewerId, reviewedAt, reason],
    );
    if (result.rowCount !== 1) throw new Error('candidate is not pending');
  }
}
