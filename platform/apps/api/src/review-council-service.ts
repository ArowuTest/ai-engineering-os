import { randomUUID } from 'node:crypto';
import {
  buildBlindReviewPacket,
  classifyReviewerOutcome,
  DomainValidationError,
  createAuditEvent,
  createFindingAdjudication,
  createReviewFinding,
  createReviewRun,
  createReviewerRechallenge,
  digestReviewMaterial,
  evaluateReviewGate,
  type BlindReviewPacket,
  type FindingAdjudication,
  type FindingAdjudicationStatus,
  type ReviewFinding,
  type ReviewerOutcome,
  type ReviewerOutcomeInput,
  type ReviewerRechallenge,
  type ReviewRun,
  type ReviewSeverity,
} from '@engineering-os/domain';
import type {
  CollaborativeMemoryRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  ReviewCouncilRepository,
  ReviewerAssignmentRecord,
  UserRepository,
} from '@engineering-os/database';
import { selectCollaborativeContext } from './collaborative-memory-policy.js';

export interface ReviewFindingDraft {
  severity: ReviewSeverity;
  category: string;
  summary: string;
  evidenceReferences: string[];
}

export interface ReviewExecutionResult {
  outcome: ReviewerOutcomeInput;
  findings: ReviewFindingDraft[];
}
export interface ReviewExecutionInput {
  assignment: ReviewerAssignmentRecord;
  packet: BlindReviewPacket;
  memory: ReturnType<typeof selectCollaborativeContext>;
  signal: AbortSignal;
}

export interface ReviewCouncilExecutor {
  review(input: ReviewExecutionInput): Promise<ReviewExecutionResult>;
}

export interface ReviewCouncilServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  memberships: MembershipRepository;
  users: UserRepository;
  reviewCouncil: ReviewCouncilRepository;
  collaborativeMemory: CollaborativeMemoryRepository;
  executor: ReviewCouncilExecutor;
  reviewExecutionTimeoutMs?: number;
}

const MAX_REVIEW_COUNCIL_SEATS = 16;
const MAX_REVIEW_EXECUTION_CONCURRENCY = 4;
const MAX_REVIEW_EXECUTION_WAITERS = MAX_REVIEW_EXECUTION_CONCURRENCY;
const MAX_REVIEW_FINDINGS_PER_ASSIGNMENT = 32;
const MAX_REVIEW_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

interface ReviewerConfig {
  id: string;
  role: string;
  routeId: string;
  modelId: string;
  modelVersion: string;
}

function stableGeneratedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function validDate(value: Date | undefined): Date {
  const resolved = value ?? new Date();
  if (!(resolved instanceof Date) || !Number.isFinite(resolved.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  return new Date(resolved.getTime());
}

function nonBlankPrompt(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('prompt must be a non-blank string');
  }
  return value.trim();
}
class MalformedReviewOutputError extends Error {}

function normalizeReviewerExecutionResult(
  value: unknown,
  reviewRunId: string,
  reviewerAssignmentId: string,
  resolvedAt: Date,
): { outcome: ReviewerOutcome; findings: ReviewFinding[] } {
  try {
    if (value === null || typeof value !== 'object') throw new MalformedReviewOutputError('review result must be an object');
    const result = value as { outcome?: unknown; findings?: unknown };
    const outcome = classifyReviewerOutcome(result.outcome as ReviewerOutcomeInput);
    if (outcome.status === 'availability_failure') return { outcome, findings: [] };
    if (!Array.isArray(result.findings)) throw new MalformedReviewOutputError('review findings must be an array');
    if (result.findings.length > MAX_REVIEW_FINDINGS_PER_ASSIGNMENT) {
      throw new MalformedReviewOutputError('review finding count exceeds limit');
    }
    const findings = result.findings.map((draft) => {
      if (draft === null || typeof draft !== 'object') throw new MalformedReviewOutputError('review finding must be an object');
      const candidate = draft as Record<string, unknown>;
      return createReviewFinding({
        id: stableGeneratedId('finding'),
        reviewRunId,
        reviewerAssignmentId,
        severity: candidate.severity as ReviewSeverity,
        category: candidate.category as string,
        summary: candidate.summary as string,
        evidenceReferences: candidate.evidenceReferences as string[],
        createdAt: resolvedAt,
      });
    });
    return { outcome, findings };
  } catch (error) {
    if (error instanceof MalformedReviewOutputError || error instanceof DomainValidationError) {
      return { outcome: { status: 'availability_failure', reason: 'malformed_output' }, findings: [] };
    }
    throw error;
  }
}

async function requireActiveProjectUser(
  users: UserRepository,
  memberships: MembershipRepository,
  organisationId: string,
  projectId: string,
  actorUserId: string,
  lockOrganisation = false,
  allowedProjectRoles?: readonly ('reviewer' | 'product_owner')[],
): Promise<void> {
  const user = lockOrganisation
    ? await users.getByIdForUpdate(actorUserId)
    : await users.getById(actorUserId);
  const organisationMembership = lockOrganisation
    ? await memberships.getOrganisationForUpdate(organisationId, actorUserId)
    : await memberships.getOrganisation(organisationId, actorUserId);
  const projectMembership = lockOrganisation
    ? await memberships.getProjectForUpdate(organisationId, projectId, actorUserId)
    : await memberships.getProject(organisationId, projectId, actorUserId);
  if (
    !user || user.status !== 'active' ||
    !organisationMembership || organisationMembership.status !== 'active' ||
    !projectMembership || projectMembership.status !== 'active' ||
    (allowedProjectRoles !== undefined && !allowedProjectRoles.includes(projectMembership.role as 'reviewer' | 'product_owner'))
  ) {
    throw new Error('forbidden');
  }
}

async function requireCollectingRun(
  reviewCouncil: ReviewCouncilRepository,
  organisationId: string,
  projectId: string,
  reviewRunId: string,
  lock = false,
): Promise<ReviewRun> {
  const run = lock
    ? await reviewCouncil.getRunForUpdate(organisationId, reviewRunId)
    : await reviewCouncil.getRun(organisationId, reviewRunId);
  if (!run || run.projectId !== projectId) throw new Error('review run not found');
  if (run.status !== 'collecting') {
    throw new Error(`review run is ${run.status}, not collecting`);
  }
  return run;
}

async function requireAdjudicatingRun(
  reviewCouncil: ReviewCouncilRepository,
  organisationId: string,
  projectId: string,
  reviewRunId: string,
  lock = false,
): Promise<ReviewRun> {
  const run = lock
    ? await reviewCouncil.getRunForUpdate(organisationId, reviewRunId)
    : await reviewCouncil.getRun(organisationId, reviewRunId);
  if (!run || run.projectId !== projectId) throw new Error('review run not found');
  if (run.status !== 'adjudicating') {
    throw new Error(`review run is ${run.status}, not adjudicating`);
  }
  return run;
}

export class ReviewCouncilService {
  private readonly reviewExecutionTimeoutMs: number;
  private activeReviewExecutions = 0;
  private readonly reviewExecutionWaiters: Array<() => void> = [];
  private readonly liveReviewExecutionsByRun = new Map<string, number>();

  constructor(private readonly dependencies: ReviewCouncilServiceDependencies) {
    const timeout = dependencies.reviewExecutionTimeoutMs ?? MAX_REVIEW_EXECUTION_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_REVIEW_EXECUTION_TIMEOUT_MS) {
      throw new TypeError(`reviewExecutionTimeoutMs must be an integer between 1 and ${MAX_REVIEW_EXECUTION_TIMEOUT_MS}`);
    }
    this.reviewExecutionTimeoutMs = timeout;
  }

  private reviewRunExecutionKey(organisationId: string, reviewRunId: string): string {
    return `${organisationId}:${reviewRunId}`;
  }

  private hasLiveReviewExecution(organisationId: string, reviewRunId: string): boolean {
    return (this.liveReviewExecutionsByRun.get(this.reviewRunExecutionKey(organisationId, reviewRunId)) ?? 0) > 0;
  }
  private trackLiveReviewExecution(organisationId: string, reviewRunId: string, delta: 1 | -1): void {
    const key = this.reviewRunExecutionKey(organisationId, reviewRunId);
    const next = (this.liveReviewExecutionsByRun.get(key) ?? 0) + delta;
    if (next <= 0) this.liveReviewExecutionsByRun.delete(key);
    else this.liveReviewExecutionsByRun.set(key, next);
  }

  private makeReviewExecutionRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeReviewExecutions -= 1;
      const waiter = this.reviewExecutionWaiters.shift();
      if (waiter) waiter();
    };
  }

  private async acquireReviewExecutionPermit(): Promise<(() => void) | null> {
    if (this.activeReviewExecutions < MAX_REVIEW_EXECUTION_CONCURRENCY) {
      this.activeReviewExecutions += 1;
      return this.makeReviewExecutionRelease();
    }
    if (this.reviewExecutionWaiters.length >= MAX_REVIEW_EXECUTION_WAITERS) return null;
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const waiter = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeReviewExecutions += 1;
        resolve(this.makeReviewExecutionRelease());
      };
      this.reviewExecutionWaiters.push(waiter);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.reviewExecutionWaiters.indexOf(waiter);
        if (index >= 0) this.reviewExecutionWaiters.splice(index, 1);
        resolve(null);
      }, this.reviewExecutionTimeoutMs);
      timer.unref?.();
    });
  }

  private async executeReviewWithDeadline(
    input: Omit<ReviewExecutionInput, 'signal'>,
    beforeProviderStart: () => Promise<void>,
    releasePermit: () => void,
  ): Promise<ReviewExecutionResult> {
    const runKey = input.assignment.reviewRunId;
    const organisationId = input.assignment.organisationId;
    this.trackLiveReviewExecution(organisationId, runKey, 1);
    try {
      await beforeProviderStart();
    } catch (error) {
      this.trackLiveReviewExecution(organisationId, runKey, -1);
      releasePermit();
      throw error;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const execution = Promise.resolve()
      .then(() => this.dependencies.executor.review({ ...input, signal: controller.signal }))
      .then(
        (result) => ({ kind: 'result' as const, result }),
        (error) => ({ kind: 'executor_failure' as const, error }),
      )
      .finally(() => {
        this.trackLiveReviewExecution(organisationId, runKey, -1);
        releasePermit();
      });
    const deadline = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve({ kind: 'timeout' }); }, this.reviewExecutionTimeoutMs);
      timer.unref?.();
    });
    const settled = await Promise.race([execution, deadline]);
    if (timer !== undefined) clearTimeout(timer);
    if (settled.kind === 'timeout') return { outcome: { kind: 'timeout' }, findings: [] };
    if (settled.kind === 'executor_failure') {
      return { outcome: { kind: 'executor_failure', detail: settled.error instanceof Error ? settled.error.message : 'executor_failure' }, findings: [] };
    }
    return settled.result;
  }

  private async requireActiveProjectUser(
    organisationId: string,
    projectId: string,
    actorUserId: string,
    allowedProjectRoles?: readonly ('reviewer' | 'product_owner')[],
  ): Promise<void> {
    await requireActiveProjectUser(
      this.dependencies.users,
      this.dependencies.memberships,
      organisationId,
      projectId,
      actorUserId,
      false,
      allowedProjectRoles,
    );
  }

  private async requireRunForProject(
    organisationId: string,
    projectId: string,
    reviewRunId: string,
  ): Promise<ReviewRun> {
    const run = await this.dependencies.reviewCouncil.getRun(organisationId, reviewRunId);
    if (!run || run.projectId !== projectId) throw new Error('review run not found');
    return run;
  }
  async createBlindRun(input: {
    id: string;
    organisationId: string;
    projectId: string;
    actorUserId: string;
    source: string;
    evidence: string;
    invariantIds: string[];
    reviewers: ReviewerConfig[];
    now?: Date;
  }): Promise<{ run: ReviewRun; packet: BlindReviewPacket; assignments: ReviewerAssignmentRecord[] }> {
    if (!Array.isArray(input.reviewers) || input.reviewers.length < 1 || input.reviewers.length > MAX_REVIEW_COUNCIL_SEATS) {
      throw new TypeError(`review council must contain between 1 and ${MAX_REVIEW_COUNCIL_SEATS} seats`);
    }
    if (new Set(input.reviewers.map((reviewer) => reviewer.id)).size !== input.reviewers.length) {
      throw new TypeError('review council assignment IDs must be unique');
    }
    const createdAt = validDate(input.now);
    const run = createReviewRun({
      id: input.id,
      organisationId: input.organisationId,
      projectId: input.projectId,
      sourceDigest: digestReviewMaterial(input.source),
      evidenceDigest: digestReviewMaterial(input.evidence),
      invariantIds: input.invariantIds,
      createdBy: input.actorUserId,
      createdAt,
    });
    const packet = buildBlindReviewPacket(run, {
      source: input.source,
      evidence: input.evidence,
      invariantIds: input.invariantIds,
    });

    const assignments = await this.dependencies.unitOfWork.run(async ({
      users, memberships, reviewCouncil, audit,
    }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      const knownInvariantIds = new Set(
        (await reviewCouncil.listArchitectureInvariants()).map((invariant) => invariant.id),
      );
      const missingInvariantIds = packet.invariantIds.filter((invariantId) => !knownInvariantIds.has(invariantId));
      if (missingInvariantIds.length > 0) {
        throw new Error(`review architecture invariant not found: ${missingInvariantIds.join(', ')}`);
      }
      await reviewCouncil.createRun(run, {
        source: input.source, evidence: input.evidence, invariantIds: input.invariantIds,
      });
      const createdAssignments: ReviewerAssignmentRecord[] = [];
      for (const reviewer of input.reviewers) {
        createdAssignments.push(await reviewCouncil.createReviewerAssignment({
          ...reviewer,
          organisationId: input.organisationId,
          reviewRunId: run.id,
          packetDigest: run.packetDigest,
          createdAt,
        }));
      }
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'review.run.created',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'review_run',
        subjectId: run.id,
        metadata: { reviewerCount: createdAssignments.length, packetDigest: run.packetDigest },
      }));
      return createdAssignments;
    });

    return { run, packet, assignments };
  }
  async recoverExpiredCollectionClaim(input: {
    organisationId: string; projectId: string; actorUserId: string; reviewRunId: string; observedAt?: Date;
  }): Promise<boolean> {
    const observedAt = validDate(input.observedAt);
    if (this.hasLiveReviewExecution(input.organisationId, input.reviewRunId)) return false;
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      await requireCollectingRun(reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true);
      if (this.hasLiveReviewExecution(input.organisationId, input.reviewRunId)) return false;
      const released = await reviewCouncil.releaseExpiredCollectionClaim(
        input.organisationId, input.reviewRunId, observedAt,
      );
      const recoveredAssignments = released
        ? await reviewCouncil.recoverExecutingReviewerAssignments(input.organisationId, input.reviewRunId, observedAt)
        : 0;
      if (released) await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'review.collection_claim.recovered', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'review_run', subjectId: input.reviewRunId,
        metadata: { observedAt: observedAt.toISOString(), recoveredAssignments },
      }));
      return released;
    });
  }

  async collectBlindReviews(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
    source?: string;
    evidence?: string;
    invariantIds?: string[];
    maxMemoryItems: number;
    maxMemoryBytes: number;
  }): Promise<Array<{
    assignment: ReviewerAssignmentRecord;
    outcome: ReviewerOutcome;
    findings: ReviewFinding[];
  }>> {
    await this.requireActiveProjectUser(
      input.organisationId, input.projectId, input.actorUserId, ['reviewer', 'product_owner'],
    );
    const run = await this.requireRunForProject(input.organisationId, input.projectId, input.reviewRunId);
    if (run.status !== 'collecting') throw new Error(`review run is ${run.status}, not collecting`);
    const durableMaterial = await this.dependencies.reviewCouncil.getRunMaterial(
      input.organisationId, input.reviewRunId,
    );
    if (!durableMaterial) throw new Error('review run material not found');
    const packet = buildBlindReviewPacket(run, {
      source: input.source ?? durableMaterial.source,
      evidence: input.evidence ?? durableMaterial.evidence,
      invariantIds: input.invariantIds ?? durableMaterial.invariantIds,
    });
    const collectionClaimToken = stableGeneratedId('reviewclaim');
    const claimedAt = new Date();
    const claimExpiresAt = new Date(claimedAt.getTime() + 30 * 60 * 1000);
    await this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      await reviewCouncil.claimCollection(
        input.organisationId, input.reviewRunId, collectionClaimToken, claimedAt, claimExpiresAt,
      );
    });
    try {
    const assignments = (await this.dependencies.reviewCouncil.listReviewerAssignments(
      input.organisationId,
      input.reviewRunId,
    )).filter((assignment) => assignment.status === 'assigned');
    const collected: Array<{
      assignment: ReviewerAssignmentRecord;
      outcome: ReviewerOutcome;
      findings: ReviewFinding[];
    }> = new Array(assignments.length);

    const executeAndPersist = async (assignment: ReviewerAssignmentRecord, index: number): Promise<void> => {
      await this.dependencies.reviewCouncil.requireCollectionClaim(
        input.organisationId, input.reviewRunId, collectionClaimToken,
      );
      const candidates = await this.dependencies.collaborativeMemory.listProjectMemoriesForUser(
        input.organisationId, input.projectId, input.actorUserId, {
          reviewerAssignmentId: assignment.id, reviewPhase: 'blind_collecting',
          maxCandidates: input.maxMemoryItems,
        },
      );
      const memory = selectCollaborativeContext(candidates, {
        organisationId: input.organisationId,
        projectId: input.projectId,
        userId: input.actorUserId,
        reviewerAssignmentId: assignment.id,
        reviewPhase: 'blind_collecting',
        projectAuthorized: true,
        organisationAuthorized: true,
      }, { maxItems: input.maxMemoryItems, maxBytes: input.maxMemoryBytes });
      const releasePermit = await this.acquireReviewExecutionPermit();
      if (!releasePermit) throw new Error('review execution capacity unavailable');
      const executionStartedAt = new Date();
      let executingAssignment: ReviewerAssignmentRecord;
      try {
        executingAssignment = await this.dependencies.unitOfWork.run(async ({
          users, memberships, reviewCouncil, audit,
        }) => {
          await requireActiveProjectUser(
            users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
            ['reviewer', 'product_owner'],
          );
          await requireCollectingRun(reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true);
          await reviewCouncil.requireCollectionClaim(input.organisationId, input.reviewRunId, collectionClaimToken);
          const executing = await reviewCouncil.beginReviewerExecution(
            input.organisationId, input.reviewRunId, assignment.id, collectionClaimToken, executionStartedAt,
          );
          await audit.append(createAuditEvent({
            organisationId: input.organisationId, projectId: input.projectId,
            eventType: 'review.assignment.executing', actorType: 'user', actorId: input.actorUserId,
            subjectType: 'reviewer_assignment', subjectId: assignment.id,
            metadata: { executionStartedAt: executionStartedAt.toISOString() },
          }));
          return executing;
        });
      } catch (error) {
        releasePermit();
        throw error;
      }
      const result = await this.executeReviewWithDeadline(
          { assignment: executingAssignment, packet, memory },
          () => this.dependencies.reviewCouncil.requireCollectionClaim(
            input.organisationId, input.reviewRunId, collectionClaimToken,
          ),
          releasePermit,
        );
        const resolvedAt = new Date();
        const normalized = normalizeReviewerExecutionResult(
          result, input.reviewRunId, assignment.id, resolvedAt,
        );
        const outcome = normalized.outcome;
        const persisted = await this.dependencies.unitOfWork.run(async ({
          users, memberships, reviewCouncil, audit,
        }) => {
        await requireActiveProjectUser(
          users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
          ['reviewer', 'product_owner'],
        );
        await requireCollectingRun(
          reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
        );
        await reviewCouncil.requireCollectionClaim(
          input.organisationId, input.reviewRunId, collectionClaimToken,
        );
        if (outcome.status === 'availability_failure') {
          const resolved = await reviewCouncil.recordReviewerAvailabilityFailure(
            input.organisationId, assignment.id, outcome.reason, resolvedAt, collectionClaimToken,
          );
          await audit.append(createAuditEvent({
            organisationId: input.organisationId, projectId: input.projectId,
            eventType: 'review.assignment.availability_failure', actorType: 'user', actorId: input.actorUserId,
            subjectType: 'reviewer_assignment', subjectId: resolved.id,
            metadata: { reason: outcome.reason },
          }));
          return { assignment: resolved, findings: [] as ReviewFinding[] };
        }
        const resolved = await reviewCouncil.recordReviewerCompleted(
          input.organisationId, assignment.id, digestReviewMaterial(outcome.content),
          resolvedAt, collectionClaimToken,
        );
        const findings = normalized.findings;
        for (const finding of findings) await reviewCouncil.createFinding(input.organisationId, finding);
        await audit.append(createAuditEvent({
          organisationId: input.organisationId, projectId: input.projectId,
          eventType: 'review.assignment.completed', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'reviewer_assignment', subjectId: resolved.id,
          metadata: { findingCount: findings.length, contentDigest: resolved.contentDigest ?? null },
        }));
        return { assignment: resolved, findings };
      });
      collected[index] = { assignment: persisted.assignment, outcome, findings: persisted.findings };
    };

    let nextAssignmentIndex = 0;
    const workerCount = Math.min(MAX_REVIEW_EXECUTION_CONCURRENCY, assignments.length);
    const workerSettlements = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
      while (nextAssignmentIndex < assignments.length) {
        const index = nextAssignmentIndex;
        nextAssignmentIndex += 1;
        await executeAndPersist(assignments[index]!, index);
      }
    }));
    const failedWorker = workerSettlements.find(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    );
    if (failedWorker) throw failedWorker.reason;

    await this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      await reviewCouncil.markAdjudicating(
        input.organisationId, input.reviewRunId, collectionClaimToken,
      );
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'review.run.adjudicating', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'review_run', subjectId: input.reviewRunId,
        metadata: { resolvedAssignments: collected.length },
      }));
    });
    return collected;
    } catch (error) {
      try {
        await this.dependencies.reviewCouncil.recoverExecutingReviewerAssignments(
          input.organisationId, input.reviewRunId, new Date(), collectionClaimToken,
        );
        await this.dependencies.reviewCouncil.releaseCollectionClaim(
          input.organisationId, input.reviewRunId, collectionClaimToken,
        );
      } catch (cleanupError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        throw new AggregateError(
          [error, cleanupError],
          `review collection failed: ${originalMessage}; collection claim release also failed`,
        );
      }
      throw error;
    }
  }

  async adjudicateFinding(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
    findingId: string;
    status: FindingAdjudicationStatus;
    rationale: string;
    evidenceReferences: string[];
    now?: Date;
  }): Promise<FindingAdjudication> {
    const createdAt = validDate(input.now);
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer'],
      );
      await requireAdjudicatingRun(
        reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
      );
      const finding = await reviewCouncil.getFinding(
        input.organisationId, input.reviewRunId, input.findingId,
      );
      if (!finding) throw new Error('review finding not found');
      const priorAdjudications = (await reviewCouncil.listAdjudications(
        input.organisationId, input.reviewRunId,
      )).filter((entry) => entry.findingId === finding.id);
      if (priorAdjudications.some((entry) => entry.status === 'CONFIRMED' || entry.status === 'PARTIALLY_VALID')) {
        throw new Error('terminal material adjudication cannot be superseded');
      }
      const adjudication = createFindingAdjudication({
        id: stableGeneratedId('adjudication'),
        findingId: finding.id,
        reviewRunId: input.reviewRunId,
        status: input.status,
        rationale: input.rationale,
        evidenceReferences: input.evidenceReferences,
        adjudicatedBy: input.actorUserId,
        createdAt,
      });
      await reviewCouncil.createAdjudication(input.organisationId, adjudication);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'review.finding.adjudicated',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'review_finding',
        subjectId: finding.id,
        metadata: { status: adjudication.status, adjudicationId: adjudication.id },
      }));
      return adjudication;
    });
  }

  async evaluateGate(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
  }) {
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      await requireAdjudicatingRun(
        reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
      );
      const findings = await reviewCouncil.listFindings(input.organisationId, input.reviewRunId);
      const adjudications = await reviewCouncil.listAdjudications(
        input.organisationId, input.reviewRunId,
      );
      const assignments = await reviewCouncil.listReviewerAssignments(
        input.organisationId, input.reviewRunId,
      );
      const gate = evaluateReviewGate(findings, adjudications, {
        assignedReviewers: assignments.length,
        completedReviewers: assignments.filter((assignment) => assignment.status === 'completed').length,
      });
      if (gate.status === 'blocked') {
        await reviewCouncil.markBlocked(input.organisationId, input.reviewRunId);
        await audit.append(createAuditEvent({
          organisationId: input.organisationId, projectId: input.projectId,
          eventType: 'review.run.blocked', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'review_run', subjectId: input.reviewRunId,
          metadata: { blockingFindingIds: gate.blockingFindingIds },
        }));
      } else if (gate.status === 'clear') {
        await reviewCouncil.markAccepted(input.organisationId, input.reviewRunId);
        await audit.append(createAuditEvent({
          organisationId: input.organisationId, projectId: input.projectId,
          eventType: 'review.run.accepted', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'review_run', subjectId: input.reviewRunId,
          metadata: { completedReviewers: assignments.filter((assignment) => assignment.status === 'completed').length },
        }));
      }
      return gate;
    });
  }
  async createPrivateRechallenge(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
    findingId: string;
    prompt: string;
    now?: Date;
  }): Promise<{ rechallenge: ReviewerRechallenge; assignment: ReviewerAssignmentRecord }> {
    const prompt = nonBlankPrompt(input.prompt);
    const createdAt = validDate(input.now);
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer'],
      );
      await requireAdjudicatingRun(
        reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
      );
      const finding = await reviewCouncil.getFinding(
        input.organisationId, input.reviewRunId, input.findingId,
      );
      if (!finding) throw new Error('review finding not found');
      const adjudications = (await reviewCouncil.listAdjudications(
        input.organisationId, input.reviewRunId,
      )).filter((entry) => entry.findingId === finding.id);
      const latest = adjudications.at(-1);
      if (!latest || !['REJECTED', 'PARTIALLY_VALID'].includes(latest.status)) {
        throw new Error('private rechallenge requires a rejected or partially-valid adjudication');
      }
      const assignment = await reviewCouncil.getReviewerAssignment(
        input.organisationId, input.reviewRunId, finding.reviewerAssignmentId,
      );
      if (!assignment) throw new Error('original reviewer assignment not found');
      const rechallenge = createReviewerRechallenge({
        id: stableGeneratedId('rechallenge'),
        reviewRunId: input.reviewRunId,
        findingId: finding.id,
        reviewerAssignmentId: assignment.id,
        adjudicationStatus: latest.status as 'REJECTED' | 'PARTIALLY_VALID',
        promptDigest: digestReviewMaterial(prompt),
        createdAt,
      });
      await reviewCouncil.createRechallenge(input.organisationId, rechallenge);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'review.finding.rechallenged',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'review_rechallenge',
        subjectId: rechallenge.id,
        metadata: { findingId: finding.id, reviewerAssignmentId: assignment.id },
      }));
      return { rechallenge, assignment };
    });
  }
  async invalidateRunForSource(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
    replacementSource: string;
    now?: Date;
  }): Promise<ReviewRun> {
    await this.requireActiveProjectUser(
      input.organisationId, input.projectId, input.actorUserId, ['reviewer', 'product_owner'],
    );
    await this.requireRunForProject(input.organisationId, input.projectId, input.reviewRunId);
    const replacementSourceDigest = digestReviewMaterial(input.replacementSource);
    const invalidatedAt = validDate(input.now);
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true, ['reviewer', 'product_owner'],
      );
      const invalidated = await reviewCouncil.invalidateRunForSource(
        input.organisationId,
        input.reviewRunId,
        replacementSourceDigest,
        invalidatedAt,
      );
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'review.run.invalidated',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'review_run',
        subjectId: input.reviewRunId,
        metadata: { replacementSourceDigest },
      }));
      return invalidated;
    });
  }

  async getCalibrationEvidence(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    routeId: string;
  }): Promise<{
    routeId: string;
    sampleSize: number;
    usefulFindingRate: number;
    falsePositiveRate: number;
    availabilityRate: number;
    medianLatencyMs: number;
    averageCostUsd: number;
    models: Array<{ modelId: string; modelVersion: string }>;
  }> {
    await this.requireActiveProjectUser(input.organisationId, input.projectId, input.actorUserId);
    const snapshots = await this.dependencies.reviewCouncil.listCalibrationSnapshots(
      input.organisationId, input.routeId,
    );
    if (snapshots.length === 0) throw new Error('no calibration evidence for route');
    const sampleSize = snapshots.reduce((sum, snapshot) => sum + snapshot.sampleSize, 0);
    const weighted = (selector: (snapshot: (typeof snapshots)[number]) => number) =>
      snapshots.reduce((sum, snapshot) => sum + selector(snapshot) * snapshot.sampleSize, 0) / sampleSize;
    const models: Array<{ modelId: string; modelVersion: string }> = [];
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      const key = `${snapshot.modelId}\u0000${snapshot.modelVersion}`;
      if (!seen.has(key)) {
        seen.add(key);
        models.push({ modelId: snapshot.modelId, modelVersion: snapshot.modelVersion });
      }
    }
    return {
      routeId: input.routeId,
      sampleSize,
      usefulFindingRate: weighted((snapshot) => snapshot.usefulFindingRate),
      falsePositiveRate: weighted((snapshot) => snapshot.falsePositiveRate),
      availabilityRate: weighted((snapshot) => snapshot.availabilityRate),
      medianLatencyMs: weighted((snapshot) => snapshot.medianLatencyMs),
      averageCostUsd: weighted((snapshot) => snapshot.averageCostUsd),
      models,
    };
  }
}
