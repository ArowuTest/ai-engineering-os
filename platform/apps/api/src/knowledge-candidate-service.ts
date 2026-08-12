import {
  createAuditEvent,
  createKnowledgeExtractionRun,
  createKnowledgeRecord,
  createPendingKnowledgeCandidate,
  dedupeCandidateProposals,
  fingerprintKnowledgeCandidate,
  parseKnowledgeCandidateProposals,
  type Project,
  type ProductKnowledge,
} from '@engineering-os/domain';
import type {
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeCandidateRepository,
  StoredKnowledgeCandidate,
} from '@engineering-os/database';
import { ProviderExecutionError, type ModelGateway } from '@engineering-os/model-gateway';
import { buildCandidateOnlyExtractionRequest } from './product-partner-context.js';

const RETRY_RESPONSE_CONTRACT_VERSION = 'candidate_only_v1';

export class KnowledgeCandidateServiceError extends Error {
  constructor(readonly statusCode: 404 | 409, message: string) {
    super(message);
    this.name = 'KnowledgeCandidateServiceError';
  }
}

export interface AcceptCandidateInput {
  organisationId: string;
  projectId: string;
  candidateId: string;
  reviewerId: string;
  category?: string;
  title?: string;
  content?: string;
}

export interface AcceptCandidateResult {
  candidate: StoredKnowledgeCandidate;
  knowledge: ProductKnowledge;
}

export interface RejectCandidateInput {
  organisationId: string;
  projectId: string;
  candidateId: string;
  reviewerId: string;
  reason?: string;
}

export interface RejectCandidateResult {
  candidate: StoredKnowledgeCandidate;
}

export interface RetryExtractionRunInput {
  organisationId: string;
  projectId: string;
  runId: string;
  requestedBy: string;
  project: Project;
  knowledge: ProductKnowledge[];
  modelGateway: ModelGateway;
  conversations: ConversationRepository;
  candidates: KnowledgeCandidateRepository;
}

export interface RetryExtractionRunResult {
  originalRunId: string;
  retryRunId: string;
  status: 'succeeded' | 'failed';
  candidateCount: number;
}

export async function acceptCandidate(
  unitOfWork: DatabaseUnitOfWork,
  input: AcceptCandidateInput,
): Promise<AcceptCandidateResult> {
  return unitOfWork.run(async ({ knowledgeCandidates, knowledge, audit }) => {
    const locked = await knowledgeCandidates.getCandidateForUpdate(
      input.organisationId, input.projectId, input.candidateId,
    );
    if (!locked) throw new KnowledgeCandidateServiceError(404, 'candidate not found');
    if (locked.status !== 'pending') {
      throw new KnowledgeCandidateServiceError(409, 'candidate is not pending');
    }

    const now = new Date();
    // Accepted canonical revision 1 is always confirmed. Governance-critical: the client
    // cannot override the acceptance status via the API.
    const knowledgeRecord = createKnowledgeRecord({
      organisationId: input.organisationId,
      projectId: input.projectId,
      category: input.category ?? locked.category,
      title: input.title ?? locked.title,
      content: input.content ?? locked.content,
      source: 'extraction_candidate',
      status: 'confirmed',
      createdBy: input.reviewerId,
    });

    await knowledge.create(knowledgeRecord);

    // Explicit provenance is preserved via existing migration-005 state + append-only audit:
    //   - candidate.accepted_knowledge_id (set below) links the candidate to canonical revision 1
    //   - candidate.extraction_run_id already links to the source extraction run (immutable trigger)
    //   - The audits below carry the full three-way linkage.
    await knowledgeCandidates.acceptCandidateDecision(
      input.organisationId, input.projectId, input.candidateId,
      input.reviewerId, now, knowledgeRecord.id,
    );

    await audit.append(createAuditEvent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: 'knowledge_candidate.accepted',
      actorType: 'user',
      actorId: input.reviewerId,
      subjectType: 'knowledge_candidate',
      subjectId: locked.id,
      metadata: {
        extractionRunId: locked.extractionRunId,
        acceptedKnowledgeId: knowledgeRecord.id,
        category: knowledgeRecord.category,
      },
    }));
    await audit.append(createAuditEvent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: 'product_knowledge.created',
      actorType: 'user',
      actorId: input.reviewerId,
      subjectType: 'product_knowledge',
      subjectId: knowledgeRecord.id,
      metadata: {
        revision: knowledgeRecord.revision,
        status: knowledgeRecord.status,
        source: knowledgeRecord.source,
        candidateId: locked.id,
        extractionRunId: locked.extractionRunId,
      },
    }));

    const acceptedCandidate: StoredKnowledgeCandidate = {
      ...locked,
      status: 'accepted',
      reviewerId: input.reviewerId,
      reviewedAt: now,
      acceptedKnowledgeId: knowledgeRecord.id,
    };
    return { candidate: acceptedCandidate, knowledge: knowledgeRecord };
  });
}

export async function rejectCandidate(
  unitOfWork: DatabaseUnitOfWork,
  input: RejectCandidateInput,
): Promise<RejectCandidateResult> {
  return unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
    const locked = await knowledgeCandidates.getCandidateForUpdate(
      input.organisationId, input.projectId, input.candidateId,
    );
    if (!locked) throw new KnowledgeCandidateServiceError(404, 'candidate not found');
    if (locked.status !== 'pending') {
      throw new KnowledgeCandidateServiceError(409, 'candidate is not pending');
    }

    const now = new Date();
    await knowledgeCandidates.rejectCandidateDecision(
      input.organisationId, input.projectId, input.candidateId,
      input.reviewerId, now, input.reason,
    );

    await audit.append(createAuditEvent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: 'knowledge_candidate.rejected',
      actorType: 'user',
      actorId: input.reviewerId,
      subjectType: 'knowledge_candidate',
      subjectId: locked.id,
      metadata: {
        extractionRunId: locked.extractionRunId,
        reason: input.reason ?? null,
      },
    }));

    const rejected: StoredKnowledgeCandidate = {
      ...locked,
      status: 'rejected',
      reviewerId: input.reviewerId,
      reviewedAt: now,
    };
    if (input.reason && input.reason.trim().length > 0) {
      rejected.rejectionReason = input.reason.trim();
    }
    return { candidate: rejected };
  });
}

export async function retryExtractionRun(
  unitOfWork: DatabaseUnitOfWork,
  input: RetryExtractionRunInput,
): Promise<RetryExtractionRunResult> {
  // Per-request timestamp captured before any external work. Used to gate concurrent retries:
  // a `retry_completed` audit that committed AFTER `requestedAt` proves an originally-concurrent
  // request won the write race while this request was still in flight → return 409.
  const requestedAt = new Date();

  const original = await input.candidates.getRunById(
    input.organisationId, input.projectId, input.runId,
  );
  if (!original) throw new KnowledgeCandidateServiceError(404, 'extraction run not found');
  if (original.status !== 'failed') {
    throw new KnowledgeCandidateServiceError(409, 'extraction run is not failed');
  }

  const messages = await input.conversations.listMessages(
    input.organisationId, input.projectId, original.conversationId,
  );
  const userMessage = messages.find((m) => m.id === original.sourceUserMessageId);
  const assistantMessage = messages.find((m) => m.id === original.sourceAssistantMessageId);
  if (!userMessage || !assistantMessage) {
    throw new KnowledgeCandidateServiceError(404, 'source messages not found');
  }

  // Preflight audit: emit BEFORE the provider call so a provider throw still leaves a trace.
  await unitOfWork.run(async ({ audit }) => {
    await audit.append(createAuditEvent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: 'knowledge_extraction_run.retry_requested',
      actorType: 'user',
      actorId: input.requestedBy,
      subjectType: 'knowledge_extraction_run',
      subjectId: original.id,
      metadata: {
        originalRunId: original.id,
        phase: 'preflight',
        requestedAt: requestedAt.toISOString(),
        responseContractVersion: RETRY_RESPONSE_CONTRACT_VERSION,
      },
    }));
  });

  const request = buildCandidateOnlyExtractionRequest({
    project: input.project,
    knowledge: input.knowledge,
    userMessage,
    assistantMessage,
    taskId: `candidate-only-retry:${input.projectId}:${original.id}`,
  });

  // NOTE: no DB transaction is held across this network call.
  let response;
  try {
    response = await input.modelGateway.execute(request);
  } catch (error) {
    const failureCode = error instanceof ProviderExecutionError
      ? 'provider_execution_error'
      : 'provider_error';
    await auditRetryFailedStrict(
      unitOfWork,
      input.organisationId,
      input.projectId,
      original.id,
      input.requestedBy,
      {
        originalRunId: original.id,
        failureCode,
        phase: 'preflight',
        requestedAt: requestedAt.toISOString(),
      },
    );
    throw error;
  }

  const retryRun = createKnowledgeExtractionRun({
    organisationId: input.organisationId,
    projectId: input.projectId,
    conversationId: original.conversationId,
    sourceUserMessageId: original.sourceUserMessageId,
    sourceAssistantMessageId: original.sourceAssistantMessageId,
    provider: response.provider,
    model: response.model,
    routeId: response.routeId,
    responseContractVersion: RETRY_RESPONSE_CONTRACT_VERSION,
  });

  const agentId = `product-partner:${response.provider}`;

  let proposals;
  try {
    const parsed = JSON.parse(response.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('candidate-only response must be an object');
    }
    proposals = parseKnowledgeCandidateProposals((parsed as { candidates: unknown }).candidates);
  } catch {
    await persistFailedRetryRunStrict(
      unitOfWork, input, retryRun, original.id, requestedAt, 'candidate_validation_failed',
    );
    return {
      originalRunId: original.id,
      retryRunId: retryRun.id,
      status: 'failed',
      candidateCount: 0,
    };
  }

  // Compute dedup outside the main UoW so the write transaction stays short.
  const pendingFingerprints = await unitOfWork.run(async ({ knowledgeCandidates }) =>
    knowledgeCandidates.listPendingFingerprintsByProject(input.organisationId, input.projectId),
  );
  const canonicalFingerprints = input.knowledge.map((record) => fingerprintKnowledgeCandidate({
    category: record.category, title: record.title, content: record.content,
  }));
  const blocked = new Set<string>([...pendingFingerprints, ...canonicalFingerprints]);
  const candidates = dedupeCandidateProposals(proposals, blocked).map((proposal) =>
    createPendingKnowledgeCandidate({
      organisationId: input.organisationId,
      projectId: input.projectId,
      extractionRunId: retryRun.id,
      ...proposal,
    }),
  );

  try {
    await unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
      // Serialize concurrent retries via a transaction-scoped advisory lock keyed to
      // (organisationId, projectId, originalRunId). Released automatically at COMMIT/ROLLBACK.
      await knowledgeCandidates.acquireRetryAdvisoryLock(
        input.organisationId, input.projectId, original.id,
      );
      // After acquiring the lock: reject if an originally-concurrent retry already committed
      // (its retry_completed audit occurred after this request began).
      const raced = await knowledgeCandidates.hasRetryCompletedSince(
        input.organisationId, input.projectId, original.id, requestedAt,
      );
      if (raced) {
        throw new KnowledgeCandidateServiceError(409, 'a retry for this run has already completed');
      }
      // Re-validate the original run is still failed (immutable-transition trigger enforces this;
      // this check keeps the 409 semantics explicit).
      const still = await knowledgeCandidates.getRunById(
        input.organisationId, input.projectId, original.id,
      );
      if (!still || still.status !== 'failed') {
        throw new KnowledgeCandidateServiceError(409, 'extraction run is not failed');
      }
      // Atomically: create retry run, insert candidates, mark succeeded, emit attempt+completed audits.
      await knowledgeCandidates.createRun(retryRun);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'knowledge_extraction_run.retry_requested',
        actorType: 'user',
        actorId: input.requestedBy,
        subjectType: 'knowledge_extraction_run',
        subjectId: retryRun.id,
        metadata: {
          originalRunId: original.id,
          phase: 'attempt',
          requestedAt: requestedAt.toISOString(),
          responseContractVersion: RETRY_RESPONSE_CONTRACT_VERSION,
        },
      }));
      for (const candidate of candidates) {
        await knowledgeCandidates.insertCandidate(candidate);
        await audit.append(createAuditEvent({
          organisationId: input.organisationId,
          projectId: input.projectId,
          eventType: 'knowledge_candidate.created',
          actorType: 'agent',
          actorId: agentId,
          subjectType: 'knowledge_candidate',
          subjectId: candidate.id,
          metadata: {
            extractionRunId: retryRun.id,
            category: candidate.category,
            basis: candidate.basis,
          },
        }));
      }
      await knowledgeCandidates.markRunSucceeded(
        input.organisationId, input.projectId, retryRun.id, new Date(),
      );
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'knowledge_extraction_run.retry_completed',
        actorType: 'user',
        actorId: input.requestedBy,
        subjectType: 'knowledge_extraction_run',
        subjectId: retryRun.id,
        metadata: {
          originalRunId: original.id,
          retryRunId: retryRun.id,
          requestedBy: input.requestedBy,
          requestedAt: requestedAt.toISOString(),
          candidateCount: candidates.length,
        },
      }));
    });
  } catch (error) {
    // Concurrency rejection must propagate as 409 without persisting a failed retry run.
    if (error instanceof KnowledgeCandidateServiceError) throw error;
    await persistFailedRetryRunStrict(
      unitOfWork, input, retryRun, original.id, requestedAt, 'candidate_insert_failed',
    );
    return {
      originalRunId: original.id,
      retryRunId: retryRun.id,
      status: 'failed',
      candidateCount: 0,
    };
  }

  return {
    originalRunId: original.id,
    retryRunId: retryRun.id,
    status: 'succeeded',
    candidateCount: candidates.length,
  };
}

// Persists a failed retry run + retry_failed audit atomically in one UoW. Deliberately not
// wrapped in try/catch: an audit-side failure must surface as 500 rather than a silent swallow.
async function persistFailedRetryRunStrict(
  unitOfWork: DatabaseUnitOfWork,
  input: RetryExtractionRunInput,
  retryRun: ReturnType<typeof createKnowledgeExtractionRun>,
  originalRunId: string,
  requestedAt: Date,
  failureCode: string,
): Promise<void> {
  await unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
    await knowledgeCandidates.createRun(retryRun);
    await knowledgeCandidates.markRunFailed(
      input.organisationId, input.projectId, retryRun.id, failureCode, null, new Date(),
    );
    await audit.append(createAuditEvent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: 'knowledge_extraction_run.retry_failed',
      actorType: 'user',
      actorId: input.requestedBy,
      subjectType: 'knowledge_extraction_run',
      subjectId: retryRun.id,
      metadata: {
        originalRunId,
        retryRunId: retryRun.id,
        failureCode,
        requestedAt: requestedAt.toISOString(),
      },
    }));
  });
}

// Emits retry_failed audit when no retry run row has been created yet (subject = original run).
async function auditRetryFailedStrict(
  unitOfWork: DatabaseUnitOfWork,
  organisationId: string,
  projectId: string,
  originalRunId: string,
  requestedBy: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await unitOfWork.run(async ({ audit }) => {
    await audit.append(createAuditEvent({
      organisationId,
      projectId,
      eventType: 'knowledge_extraction_run.retry_failed',
      actorType: 'user',
      actorId: requestedBy,
      subjectType: 'knowledge_extraction_run',
      subjectId: originalRunId,
      metadata,
    }));
  });
}
