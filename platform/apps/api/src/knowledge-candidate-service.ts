import { randomUUID } from 'node:crypto';
import {
  createAuditEvent,
  createKnowledgeExtractionRun,
  createKnowledgeRecord,
  createPendingKnowledgeCandidate,
  dedupeCandidateProposals,
  fingerprintKnowledgeCandidate,
  parseKnowledgeCandidateProposals,
  type KnowledgeStatus,
  type Project,
  type ProductKnowledge,
} from '@engineering-os/domain';
import type {
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeCandidateRepository,
  StoredKnowledgeCandidate,
} from '@engineering-os/database';
import type { ModelGateway } from '@engineering-os/model-gateway';
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
  status?: KnowledgeStatus;
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
    const knowledgeRecord = createKnowledgeRecord({
      organisationId: input.organisationId,
      projectId: input.projectId,
      category: input.category ?? locked.category,
      title: input.title ?? locked.title,
      content: input.content ?? locked.content,
      source: 'extraction_candidate',
      status: input.status ?? 'confirmed',
      createdBy: input.reviewerId,
    });

    await knowledge.create(knowledgeRecord);

    await knowledgeCandidates.insertProvenance({
      id: randomUUID(),
      organisationId: input.organisationId,
      projectId: input.projectId,
      knowledgeId: knowledgeRecord.id,
      revision: knowledgeRecord.revision,
      candidateId: locked.id,
      extractionRunId: locked.extractionRunId,
      createdAt: now,
    });

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
  // Load and validate original run.
  const original = await input.candidates.getRunById(
    input.organisationId, input.projectId, input.runId,
  );
  if (!original) throw new KnowledgeCandidateServiceError(404, 'extraction run not found');
  if (original.status !== 'failed') {
    throw new KnowledgeCandidateServiceError(409, 'extraction run is not failed');
  }

  // Fetch source messages from the persisted conversation.
  const messages = await input.conversations.listMessages(
    input.organisationId, input.projectId, original.conversationId,
  );
  const userMessage = messages.find((m) => m.id === original.sourceUserMessageId);
  const assistantMessage = messages.find((m) => m.id === original.sourceAssistantMessageId);
  if (!userMessage || !assistantMessage) {
    throw new KnowledgeCandidateServiceError(404, 'source messages not found');
  }

  // Candidate-only structured request.
  const request = buildCandidateOnlyExtractionRequest({
    project: input.project,
    knowledge: input.knowledge,
    userMessage,
    assistantMessage,
    taskId: `candidate-only-retry:${input.projectId}:${original.id}`,
  });

  const response = await input.modelGateway.execute(request);

  // Retry-requested audit + new run row + retry attempt row in one transaction.
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

  await unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
    await knowledgeCandidates.createRun(retryRun);
    await knowledgeCandidates.insertRetryAttempt({
      id: randomUUID(),
      organisationId: input.organisationId,
      projectId: input.projectId,
      originalRunId: original.id,
      retryRunId: retryRun.id,
      requestedBy: input.requestedBy,
      requestedAt: new Date(),
    });
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
        responseContractVersion: RETRY_RESPONSE_CONTRACT_VERSION,
      },
    }));
  });

  // Parse candidates from candidate-only response.
  let proposals;
  try {
    const parsed = JSON.parse(response.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('candidate-only response must be an object');
    }
    proposals = parseKnowledgeCandidateProposals((parsed as { candidates: unknown }).candidates);
  } catch {
    await markRunFailedSafely(unitOfWork, input.organisationId, input.projectId, retryRun.id, 'candidate_validation_failed', input.requestedBy, agentId, original.id);
    return {
      originalRunId: original.id,
      retryRunId: retryRun.id,
      status: 'failed',
      candidateCount: 0,
    };
  }

  // Dedup against pending fingerprints + current canonical.
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
        metadata: { originalRunId: original.id, candidateCount: candidates.length },
      }));
    });
  } catch {
    await markRunFailedSafely(unitOfWork, input.organisationId, input.projectId, retryRun.id, 'candidate_insert_failed', input.requestedBy, agentId, original.id);
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

async function markRunFailedSafely(
  unitOfWork: DatabaseUnitOfWork,
  organisationId: string,
  projectId: string,
  runId: string,
  failureCode: string,
  requestedBy: string,
  _agentId: string,
  originalRunId: string,
): Promise<void> {
  try {
    await unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
      await knowledgeCandidates.markRunFailed(organisationId, projectId, runId, failureCode, null, new Date());
      await audit.append(createAuditEvent({
        organisationId,
        projectId,
        eventType: 'knowledge_extraction_run.retry_failed',
        actorType: 'user',
        actorId: requestedBy,
        subjectType: 'knowledge_extraction_run',
        subjectId: runId,
        metadata: { originalRunId, failureCode },
      }));
    });
  } catch {
    // best effort
  }
}

