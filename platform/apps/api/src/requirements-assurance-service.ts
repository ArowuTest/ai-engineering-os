import { randomUUID } from 'node:crypto';
import {
  createAssuranceFinding,
  createAssuranceRun,
  createAuditEvent,
  evaluateAssuranceReadiness,
  type AssuranceAvailabilityReason,
  type AssuranceFinding,
  type AssuranceReadiness,
  type AssuranceRun,
} from '@engineering-os/domain';
import type {
  AssuranceRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeRepository,
  ProjectRepository,
} from '@engineering-os/database';
import type { ModelGateway, ModelRequest, ModelResponse } from '@engineering-os/model-gateway';
import { CapabilityEstateService, CapabilityEstateServiceError } from './capability-estate-service.js';
import {
  buildProductRequirementsAssuranceSnapshot,
  buildRequirementsAssuranceRequest,
  parseRequirementsAssuranceOutput,
  PRODUCT_REQUIREMENTS_ASSURANCE_PROFILE_ID,
  PRODUCT_REQUIREMENTS_ASSURANCE_TARGET_TYPE,
  REQUIREMENTS_REVIEWER_AGENT_CAPABILITY_ID,
} from './requirements-assurance-profile.js';
export interface RequirementsAssuranceServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  projects: ProjectRepository;
  conversations: ConversationRepository;
  knowledge: KnowledgeRepository;
  assurance: AssuranceRepository;
  capabilityEstateService: CapabilityEstateService;
  modelGateway: ModelGateway;
  reviewExecutionTimeoutMs?: number;
}

export interface RequirementsAssuranceResult {
  run: AssuranceRun;
  findings: AssuranceFinding[];
  readiness: AssuranceReadiness;
  execution?: {
    provider: string;
    model: string;
    routeId: string;
  };
}

const DEFAULT_REVIEW_EXECUTION_TIMEOUT_MS = 120_000;
const MAX_REVIEW_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

function generatedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
type ReviewExecutionOutcome =
  | { status: 'completed'; response: ModelResponse }
  | { status: 'availability_failure'; reason: AssuranceAvailabilityReason };

async function executeWithTimeout(
  modelGateway: ModelGateway,
  request: ModelRequest,
  timeoutMs: number,
): Promise<ReviewExecutionOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const execution = Promise.resolve()
    .then(() => modelGateway.execute(request))
    .then(
      (response) => ({ status: 'completed' as const, response }),
      () => ({ status: 'availability_failure' as const, reason: 'provider_failure' as const }),
    );
  const timeout = new Promise<ReviewExecutionOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'availability_failure', reason: 'timeout' }), timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([execution, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

export class RequirementsAssuranceService {
  private readonly reviewExecutionTimeoutMs: number;

  constructor(private readonly dependencies: RequirementsAssuranceServiceDependencies) {
    const timeout = dependencies.reviewExecutionTimeoutMs ?? DEFAULT_REVIEW_EXECUTION_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_REVIEW_EXECUTION_TIMEOUT_MS) {
      throw new TypeError(`reviewExecutionTimeoutMs must be between 1 and ${MAX_REVIEW_EXECUTION_TIMEOUT_MS}`);
    }
    this.reviewExecutionTimeoutMs = timeout;
  }
  private async resolveReviewerRoute(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewerRouteId?: string;
  }): Promise<string> {
    const eligibleAgents = await this.dependencies.capabilityEstateService.listEligibleForProject({
      organisationId: input.organisationId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      kind: 'agent',
    });
    if (!eligibleAgents.some((agent) => agent.id === REQUIREMENTS_REVIEWER_AGENT_CAPABILITY_ID)) {
      throw new CapabilityEstateServiceError('not_found', 'Eligible Requirements Reviewer is not available');
    }
    if (input.reviewerRouteId !== undefined) {
      const routes = await this.dependencies.capabilityEstateService.listEligibleModelRoutesForProject({
        organisationId: input.organisationId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
      });
      if (!routes.some((route) => route.id === input.reviewerRouteId)) {
        throw new CapabilityEstateServiceError('not_found', 'Eligible Requirements Reviewer route is not available');
      }
      return input.reviewerRouteId;
    }
    const automatic = await this.dependencies.capabilityEstateService.resolveAutoForProject({
      organisationId: input.organisationId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      kind: 'model_route',
    });
    return automatic.sourceRef;
  }
  private async recordAvailabilityFailure(
    run: AssuranceRun,
    reason: AssuranceAvailabilityReason,
  ): Promise<RequirementsAssuranceResult> {
    const failedAt = new Date();
    const failed = await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
      const updated = await assurance.markAvailabilityFailure(
        run.organisationId, run.projectId, run.id, reason, failedAt,
      );
      await audit.append(createAuditEvent({
        organisationId: run.organisationId,
        projectId: run.projectId,
        eventType: 'assurance.review.availability_failure',
        actorType: 'agent',
        actorId: run.reviewerAgentCapabilityId,
        subjectType: 'assurance_run',
        subjectId: run.id,
        metadata: { profileId: run.profileId, reviewerRouteId: run.reviewerRouteId, reason },
      }));
      return updated;
    });
    return {
      run: failed,
      findings: [],
      readiness: evaluateAssuranceReadiness(failed, [], { reviewerCompleted: false }),
    };
  }

  async runProductRequirementsReview(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewerRouteId?: string;
  }): Promise<RequirementsAssuranceResult> {
    const reviewerRouteId = await this.resolveReviewerRoute(input);
    const project = await this.dependencies.projects.getById(input.organisationId, input.projectId);
    if (!project) throw new CapabilityEstateServiceError('not_found', 'Project not found');
    const conversation = await this.dependencies.conversations.getByProject(
      input.organisationId, input.projectId,
    );
    const [knowledge, messages] = await Promise.all([
      this.dependencies.knowledge.listByProject(input.organisationId, input.projectId),
      conversation
        ? this.dependencies.conversations.listMessages(input.organisationId, input.projectId, conversation.id)
        : Promise.resolve([]),
    ]);
    const snapshot = buildProductRequirementsAssuranceSnapshot({ project, knowledge, messages });

    const latest = await this.dependencies.assurance.getLatestRun(
      input.organisationId, input.projectId, PRODUCT_REQUIREMENTS_ASSURANCE_PROFILE_ID,
    );
    if (latest && latest.status !== 'invalidated' && latest.targetDigest !== snapshot.digestSha256) {
      await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
        await assurance.invalidateRunForTarget(
          input.organisationId, input.projectId, latest.id, snapshot.digestSha256, new Date(),
        );
        await audit.append(createAuditEvent({
          organisationId: input.organisationId,
          projectId: input.projectId,
          eventType: 'assurance.review.invalidated',
          actorType: 'system',
          actorId: 'assurance',
          subjectType: 'assurance_run',
          subjectId: latest.id,
          metadata: { profileId: latest.profileId, replacementTargetDigest: snapshot.digestSha256 },
        }));
      });
    }

    const run = createAssuranceRun({
      id: generatedId('assurance'),
      organisationId: input.organisationId,
      projectId: input.projectId,
      profileId: PRODUCT_REQUIREMENTS_ASSURANCE_PROFILE_ID,
      targetType: PRODUCT_REQUIREMENTS_ASSURANCE_TARGET_TYPE,
      targetDigest: snapshot.digestSha256,
      reviewerAgentCapabilityId: REQUIREMENTS_REVIEWER_AGENT_CAPABILITY_ID,
      reviewerRouteId,
      createdBy: input.actorUserId,
      createdAt: new Date(),
    });
    await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
      await assurance.createRun(run);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'assurance.review.created',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'assurance_run',
        subjectId: run.id,
        metadata: {
          profileId: run.profileId,
          targetDigest: run.targetDigest,
          reviewerAgentCapabilityId: run.reviewerAgentCapabilityId,
          reviewerRouteId: run.reviewerRouteId,
        },
      }));
    });

    const request = buildRequirementsAssuranceRequest({
      projectId: input.projectId,
      snapshot,
      reviewerRouteId,
      sequence: messages.length + knowledge.length + 1,
    });
    const execution = await executeWithTimeout(
      this.dependencies.modelGateway, request, this.reviewExecutionTimeoutMs,
    );
    if (execution.status === 'availability_failure') {
      return this.recordAvailabilityFailure(run, execution.reason);
    }
    const content = execution.response.content.trim();
    if (content.length === 0) return this.recordAvailabilityFailure(run, 'empty_output');
    let findings: AssuranceFinding[];
    try {
      const drafts = parseRequirementsAssuranceOutput(content);
      findings = drafts.map((draft) => createAssuranceFinding({
        id: generatedId('assurance_finding'),
        assuranceRunId: run.id,
        severity: draft.severity,
        kind: draft.kind,
        category: draft.category,
        summary: draft.summary,
        rationale: draft.rationale,
        ...(draft.proposedQuestion === undefined ? {} : { proposedQuestion: draft.proposedQuestion }),
        ...(draft.suggestedDirection === undefined ? {} : { suggestedDirection: draft.suggestedDirection }),
        basis: draft.basis,
        evidenceReferences: draft.evidenceReferences,
        createdAt: new Date(),
      }));
    } catch {
      return this.recordAvailabilityFailure(run, 'malformed_output');
    }

    const completed = await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
      for (const finding of findings) {
        await assurance.createFinding(input.organisationId, input.projectId, finding);
      }
      const updated = await assurance.markCompleted(
        input.organisationId, input.projectId, run.id, new Date(),
      );
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'assurance.review.completed',
        actorType: 'agent',
        actorId: run.reviewerAgentCapabilityId,
        subjectType: 'assurance_run',
        subjectId: run.id,
        metadata: {
          profileId: run.profileId, targetDigest: run.targetDigest,
          reviewerRouteId: run.reviewerRouteId, findingCount: findings.length,
          provider: execution.response.provider, model: execution.response.model,
        },
      }));
      return updated;
    });

    return {
      run: completed,
      findings,
      readiness: evaluateAssuranceReadiness(completed, findings, { reviewerCompleted: true }),
      execution: {
        provider: execution.response.provider,
        model: execution.response.model,
        routeId: execution.response.routeId,
      },
    };
  }

  async closeCurrentProductRequirementsFinding(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    findingId: string;
    status: 'resolved' | 'dismissed';
    resolutionNote: string;
  }): Promise<RequirementsAssuranceResult> {
    const current = await this.getCurrentProductRequirementsAssurance(input);
    if (!current.run || current.run.status !== 'completed') {
      throw new CapabilityEstateServiceError('conflict', 'Only a current completed assurance review can be resolved');
    }
    const finding = current.findings.find((candidate) => candidate.id === input.findingId);
    if (!finding || finding.status !== 'open') {
      throw new CapabilityEstateServiceError('not_found', 'Open assurance finding not found');
    }
    const closed = await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
      const updated = await assurance.closeFinding(
        input.organisationId, input.projectId, current.run!.id, input.findingId,
        input.status, input.actorUserId, input.resolutionNote, new Date(),
      );
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'assurance.finding.closed',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'assurance_finding',
        subjectId: input.findingId,
        metadata: { assuranceRunId: current.run!.id, status: input.status },
      }));
      return updated;
    });
    const findings = current.findings.map((candidate) => candidate.id === closed.id ? closed : candidate);
    return {
      run: current.run,
      findings,
      readiness: evaluateAssuranceReadiness(current.run, findings, { reviewerCompleted: true }),
    };
  }

  async getCurrentProductRequirementsAssurance(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
  }) {
    const project = await this.dependencies.projects.getById(input.organisationId, input.projectId);
    if (!project) throw new CapabilityEstateServiceError('not_found', 'Project not found');
    const conversation = await this.dependencies.conversations.getByProject(
      input.organisationId, input.projectId,
    );
    const [knowledge, messages] = await Promise.all([
      this.dependencies.knowledge.listByProject(input.organisationId, input.projectId),
      conversation
        ? this.dependencies.conversations.listMessages(input.organisationId, input.projectId, conversation.id)
        : Promise.resolve([]),
    ]);
    const snapshot = buildProductRequirementsAssuranceSnapshot({ project, knowledge, messages });
    let run = await this.dependencies.assurance.getLatestRun(
      input.organisationId, input.projectId, PRODUCT_REQUIREMENTS_ASSURANCE_PROFILE_ID,
    );
    if (!run) {
      return {
        run: null,
        findings: [] as AssuranceFinding[],
        readiness: { status: 'insufficient_evidence' as const, blockingFindingIds: [] as string[] },
        targetDigest: snapshot.digestSha256,
      };
    }
    if (run.status !== 'invalidated' && run.targetDigest !== snapshot.digestSha256) {
      run = await this.dependencies.unitOfWork.run(async ({ assurance, audit }) => {
        const invalidated = await assurance.invalidateRunForTarget(
          input.organisationId, input.projectId, run!.id, snapshot.digestSha256, new Date(),
        );
        await audit.append(createAuditEvent({
          organisationId: input.organisationId, projectId: input.projectId,
          eventType: 'assurance.review.invalidated', actorType: 'system', actorId: 'assurance',
          subjectType: 'assurance_run', subjectId: run!.id,
          metadata: { profileId: run!.profileId, replacementTargetDigest: snapshot.digestSha256 },
        }));
        return invalidated;
      });
    }
    const findings = await this.dependencies.assurance.listFindings(
      input.organisationId, input.projectId, run.id,
    );
    return {
      run,
      findings,
      readiness: evaluateAssuranceReadiness(run, findings, { reviewerCompleted: run.status === 'completed' }),
      targetDigest: snapshot.digestSha256,
    };
  }
}
