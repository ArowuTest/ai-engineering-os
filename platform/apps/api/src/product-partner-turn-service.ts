import {
  createAuditEvent,
  createConversationMessage,
  createKnowledgeExtractionRun,
  createPendingKnowledgeCandidate,
  dedupeCandidateProposals,
  fingerprintKnowledgeCandidate,
  parseKnowledgeCandidateProposals,
  parseProductPartnerEnvelope,
  type AssuranceFinding,
  type ConversationMessage,
  type ProductConversation,
  type ProductKnowledge,
  type Project,
  type StudioInteractionArtifact,
} from '@engineering-os/domain';
import {
  ProviderExecutionError,
  type ModelAdapter,
  type ModelGateway,
  type ModelResponse,
  type ModelRouteConnection,
} from '@engineering-os/model-gateway';
import type { DatabaseUnitOfWork } from '@engineering-os/database';
import { buildProductPartnerRequest } from './product-partner-context.js';
import { buildStudioArtifactModelContext } from './studio-artifact-model-context.js';

const RESPONSE_CONTRACT_VERSION = 'product_partner_knowledge_v1';

export interface TurnExecution {
  provider: string;
  model: string;
  routeId: string;
  connection?: ModelRouteConnection;
  executionMode: string;
  costType: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TurnExtraction {
  runId: string;
  status: 'succeeded' | 'failed';
  candidateCount: number;
}

export interface TurnSelection {
  agent: { mode: 'auto' | 'explicit'; capabilityId: string };
  harness: { mode: 'auto' | 'explicit'; capabilityId: string };
  modelRoute: { mode: 'auto' | 'explicit'; routeId: string };
}

export interface TurnResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  execution: TurnExecution;
  extraction: TurnExtraction;
  selection?: TurnSelection;
}

export interface ExecuteTurnInput {
  organisationId: string;
  projectId: string;
  userId: string;
  userContent: string;
  project: Project;
  conversation: ProductConversation;
  history: ConversationMessage[];
  knowledge: ProductKnowledge[];
  modelGateway: ModelGateway;
  unitOfWork: DatabaseUnitOfWork;
  selection?: TurnSelection;
  interactionArtifacts?: StudioInteractionArtifact[];
  requirementsAssuranceFindings?: AssuranceFinding[];
  dynamicAdapterResolver?: (routeId: string) => Promise<ModelAdapter | null>;
}

export async function executeProductPartnerTurn(input: ExecuteTurnInput): Promise<TurnResult> {
  const {
    organisationId, projectId, userId, userContent,
    project, conversation, history, knowledge,
    modelGateway, unitOfWork, selection, interactionArtifacts,
    requirementsAssuranceFindings, dynamicAdapterResolver,
  } = input;

  const structuredRequest = buildProductPartnerRequest({
    project, knowledge, messages: history, newUserContent: userContent,
    ...(requirementsAssuranceFindings === undefined
      ? {} : { assuranceFindings: requirementsAssuranceFindings }),
  });
  if (selection !== undefined) {
    structuredRequest.routing.preferredRouteId = selection.modelRoute.routeId;
  }
  if (interactionArtifacts !== undefined && interactionArtifacts.length > 0) {
    structuredRequest.inputArtifacts = interactionArtifacts.map((artifact) => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      digestSha256: artifact.digestSha256,
      ...(artifact.contextText === undefined ? {} : { contextText: artifact.contextText }),
    }));
    const artifactContextMessages = buildStudioArtifactModelContext(interactionArtifacts);
    if (artifactContextMessages.length > 0) {
      structuredRequest.messages = [
        ...structuredRequest.messages.slice(0, -1),
        ...artifactContextMessages,
        ...structuredRequest.messages.slice(-1),
      ];
    }
  }

  // Step 1: structured call â€” gateway errors (NoEligibleRouteError, ProviderExecutionError) propagate
  const structuredResponse = await modelGateway.execute(
    structuredRequest,
    dynamicAdapterResolver ? { dynamicAdapterResolver } : {},
  );

  let modelResponse: ModelResponse = structuredResponse;
  let answer: string | null = null;
  let candidatesRaw: unknown = null;
  let usedRecovery = false;

  const structuredContent = structuredResponse.content.trim();
  if (structuredContent) {
    try {
      const envelope = parseProductPartnerEnvelope(structuredResponse.content);
      answer = envelope.answer;
      candidatesRaw = envelope.candidates;
    } catch {
      // Envelope parse failed â€” fall through to recovery
    }
  }

  // Step 2: recovery with plain chat when no usable answer from structured call
  if (answer === null) {
    const recoveryResponse = await modelGateway.execute({
      taskId: `product-partner-recovery:${project.id}:${history.length + 1}`,
      role: 'product_partner',
      messages: structuredRequest.messages,
      requiredCapabilities: ['chat'],
      routing: structuredRequest.routing,
      ...(structuredRequest.inputArtifacts === undefined
        ? {} : { inputArtifacts: structuredRequest.inputArtifacts }),
    }, dynamicAdapterResolver ? { dynamicAdapterResolver } : {});
    const recoveryContent = recoveryResponse.content.trim();
    if (!recoveryContent) {
      throw new ProviderExecutionError(recoveryResponse.provider);
    }
    answer = recoveryContent;
    modelResponse = recoveryResponse;
    usedRecovery = true;
  }

  // Step 3: build domain objects
  const agentId = `product-partner:${modelResponse.provider}`;

  const userMessage = createConversationMessage({
    organisationId, projectId,
    conversationId: conversation.id,
    role: 'user',
    content: userContent,
    createdBy: userId,
  });

  const assistantMessage = createConversationMessage({
    organisationId, projectId,
    conversationId: conversation.id,
    role: 'assistant',
    content: answer,
    provider: modelResponse.provider,
    createdBy: agentId,
  });

  const extractionRun = createKnowledgeExtractionRun({
    organisationId, projectId,
    conversationId: conversation.id,
    sourceUserMessageId: userMessage.id,
    sourceAssistantMessageId: assistantMessage.id,
    provider: modelResponse.provider,
    model: modelResponse.model,
    routeId: modelResponse.routeId,
    responseContractVersion: RESPONSE_CONTRACT_VERSION,
  });

  const userEvent = createAuditEvent({
    organisationId, projectId,
    eventType: 'product_partner.user_message.created',
    actorType: 'user',
    actorId: userId,
    subjectType: 'conversation_message',
    subjectId: userMessage.id,
    metadata: { conversationId: conversation.id },
  });

  const assistantEvent = createAuditEvent({
    organisationId, projectId,
    eventType: 'product_partner.assistant_message.created',
    actorType: 'agent',
    actorId: agentId,
    subjectType: 'conversation_message',
    subjectId: assistantMessage.id,
    metadata: {
      conversationId: conversation.id,
      provider: modelResponse.provider,
      model: modelResponse.model,
      routeId: modelResponse.routeId,
      ...(modelResponse.connection === undefined ? {} : { connection: modelResponse.connection }),
      executionMode: modelResponse.executionMode,
      costType: modelResponse.costType,
      usage: modelResponse.usage ?? null,
      ...(selection === undefined ? {} : { selection }),
      ...(interactionArtifacts === undefined || interactionArtifacts.length === 0
        ? {} : { interactionArtifactIds: interactionArtifacts.map((artifact) => artifact.id) }),
    },
  });

  const runReceivedEvent = createAuditEvent({
    organisationId, projectId,
    eventType: 'knowledge_extraction_run.received',
    actorType: 'agent',
    actorId: agentId,
    subjectType: 'knowledge_extraction_run',
    subjectId: extractionRun.id,
    metadata: {
      conversationId: conversation.id,
      provider: modelResponse.provider,
      model: modelResponse.model,
      routeId: modelResponse.routeId,
      responseContractVersion: RESPONSE_CONTRACT_VERSION,
    },
  });

  // Transaction A: messages + mandatory audits + received run marker
  // Messages must be inserted before the run (FK constraints on source message IDs)
  await unitOfWork.run(async ({ conversations, audit, knowledgeCandidates }) => {
    await conversations.appendMessage(userMessage);
    await audit.append(userEvent);
    await conversations.appendMessage(assistantMessage);
    await audit.append(assistantEvent);
    await knowledgeCandidates.createRun(extractionRun);
    await audit.append(runReceivedEvent);
  });

  const execution: TurnExecution = {
    provider: modelResponse.provider,
    model: modelResponse.model,
    routeId: modelResponse.routeId,
    ...(modelResponse.connection === undefined ? {} : { connection: modelResponse.connection }),
    executionMode: modelResponse.executionMode,
    costType: modelResponse.costType,
  };
  if (modelResponse.usage?.inputTokens !== undefined) {
    execution.inputTokens = modelResponse.usage.inputTokens;
  }
  if (modelResponse.usage?.outputTokens !== undefined) {
    execution.outputTokens = modelResponse.usage.outputTokens;
  }
  const selectionResult: Pick<TurnResult, 'selection'> = selection === undefined ? {} : { selection };

  // Recovery path: no structured output available â€” mark run failed
  if (usedRecovery) {
    await markRunFailedSafely(unitOfWork, organisationId, projectId, extractionRun.id, 'structured_output_unavailable');
    return {
      userMessage, assistantMessage, execution,
      extraction: { runId: extractionRun.id, status: 'failed', candidateCount: 0 },
      ...selectionResult,
    };
  }

  // Step 4: validate candidates
  let proposals;
  try {
    proposals = parseKnowledgeCandidateProposals(candidatesRaw);
  } catch {
    await markRunFailedSafely(unitOfWork, organisationId, projectId, extractionRun.id, 'candidate_validation_failed');
    return {
      userMessage, assistantMessage, execution,
      extraction: { runId: extractionRun.id, status: 'failed', candidateCount: 0 },
      ...selectionResult,
    };
  }

  // Step 5: suppress duplicates by category/fingerprint
  // Blocked = current pending candidates for this project + latest canonical Product Knowledge.
  // A rejected historical candidate does not by itself block re-proposal (only pending rows blocked).
  const pendingFingerprints = await unitOfWork.run(async ({ knowledgeCandidates }) =>
    knowledgeCandidates.listPendingFingerprintsByProject(organisationId, projectId),
  );
  const canonicalFingerprints = knowledge.map((record) => fingerprintKnowledgeCandidate({
    category: record.category,
    title: record.title,
    content: record.content,
  }));
  const blocked = new Set<string>([...pendingFingerprints, ...canonicalFingerprints]);

  const candidates = dedupeCandidateProposals(proposals, blocked).map((proposal) =>
    createPendingKnowledgeCandidate({
      organisationId, projectId,
      extractionRunId: extractionRun.id,
      ...proposal,
    }),
  );

  // Transaction B: candidate rows + candidate audit events + run succeeded atomically
  try {
    await unitOfWork.run(async ({ knowledgeCandidates, audit }) => {
      for (const candidate of candidates) {
        await knowledgeCandidates.insertCandidate(candidate);
        await audit.append(createAuditEvent({
          organisationId, projectId,
          eventType: 'knowledge_candidate.created',
          actorType: 'agent',
          actorId: agentId,
          subjectType: 'knowledge_candidate',
          subjectId: candidate.id,
          metadata: {
            extractionRunId: extractionRun.id,
            category: candidate.category,
            basis: candidate.basis,
          },
        }));
      }
      await knowledgeCandidates.markRunSucceeded(organisationId, projectId, extractionRun.id, new Date());
      await audit.append(createAuditEvent({
        organisationId, projectId,
        eventType: 'knowledge_extraction_run.succeeded',
        actorType: 'agent',
        actorId: agentId,
        subjectType: 'knowledge_extraction_run',
        subjectId: extractionRun.id,
        metadata: { candidateCount: candidates.length },
      }));
    });
  } catch {
    await markRunFailedSafely(unitOfWork, organisationId, projectId, extractionRun.id, 'candidate_insert_failed');
    return {
      userMessage, assistantMessage, execution,
      extraction: { runId: extractionRun.id, status: 'failed', candidateCount: 0 },
      ...selectionResult,
    };
  }

  return {
    userMessage, assistantMessage, execution,
    extraction: { runId: extractionRun.id, status: 'succeeded', candidateCount: candidates.length },
    ...selectionResult,
  };
}

async function markRunFailedSafely(
  unitOfWork: DatabaseUnitOfWork,
  organisationId: string,
  projectId: string,
  runId: string,
  failureCode: string,
): Promise<void> {
  try {
    await unitOfWork.run(async ({ knowledgeCandidates }) => {
      await knowledgeCandidates.markRunFailed(organisationId, projectId, runId, failureCode, null, new Date());
    });
  } catch {
    // best-effort: do not let extraction failure mask conversation success
  }
}
