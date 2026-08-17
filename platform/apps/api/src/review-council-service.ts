import { randomUUID } from 'node:crypto';
import {
  buildBlindReviewPacket,
  classifyReviewerOutcome,
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
}

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
function normalizeReviewerExecutionResult(
  value: unknown,
  reviewRunId: string,
  reviewerAssignmentId: string,
  resolvedAt: Date,
): { outcome: ReviewerOutcome; findings: ReviewFinding[] } {
  try {
    if (value === null || typeof value !== 'object') throw new TypeError('review result must be an object');
    const result = value as { outcome?: unknown; findings?: unknown };
    const outcome = classifyReviewerOutcome(result.outcome as ReviewerOutcomeInput);
    if (outcome.status === 'availability_failure') return { outcome, findings: [] };
    if (!Array.isArray(result.findings)) throw new TypeError('review findings must be an array');
    const findings = result.findings.map((draft) => {
      if (draft === null || typeof draft !== 'object') throw new TypeError('review finding must be an object');
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
  } catch {
    return { outcome: { status: 'availability_failure', reason: 'malformed_output' }, findings: [] };
  }
}

async function requireActiveProjectUser(
  users: UserRepository,
  memberships: MembershipRepository,
  organisationId: string,
  projectId: string,
  actorUserId: string,
  lockOrganisation = false,
): Promise<void> {
  const user = await users.getById(actorUserId);
  const organisationMembership = lockOrganisation
    ? await memberships.getOrganisationForUpdate(organisationId, actorUserId)
    : await memberships.getOrganisation(organisationId, actorUserId);
  const projectMembership = await memberships.getProject(organisationId, projectId, actorUserId);
  if (
    !user || user.status !== 'active' ||
    !organisationMembership || organisationMembership.status !== 'active' ||
    !projectMembership || projectMembership.status !== 'active'
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
  constructor(private readonly dependencies: ReviewCouncilServiceDependencies) {}

  private async requireActiveProjectUser(
    organisationId: string,
    projectId: string,
    actorUserId: string,
  ): Promise<void> {
    await requireActiveProjectUser(
      this.dependencies.users,
      this.dependencies.memberships,
      organisationId,
      projectId,
      actorUserId,
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
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
      );
      await reviewCouncil.createRun(run);
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
  async collectBlindReviews(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    reviewRunId: string;
    source: string;
    evidence: string;
    invariantIds: string[];
    maxMemoryItems: number;
    maxMemoryBytes: number;
  }): Promise<Array<{
    assignment: ReviewerAssignmentRecord;
    outcome: ReviewerOutcome;
    findings: ReviewFinding[];
  }>> {
    await this.requireActiveProjectUser(input.organisationId, input.projectId, input.actorUserId);
    const run = await this.requireRunForProject(input.organisationId, input.projectId, input.reviewRunId);
    if (run.status !== 'collecting') throw new Error(`review run is ${run.status}, not collecting`);
    const packet = buildBlindReviewPacket(run, {
      source: input.source,
      evidence: input.evidence,
      invariantIds: input.invariantIds,
    });
    const assignments = (await this.dependencies.reviewCouncil.listReviewerAssignments(
      input.organisationId,
      input.reviewRunId,
    )).filter((assignment) => assignment.status === 'assigned');
    const candidates = await this.dependencies.collaborativeMemory.listProjectMemoriesForUser(
      input.organisationId,
      input.projectId,
      input.actorUserId,
    );

    const executions = await Promise.all(assignments.map(async (assignment) => {
      const memory = selectCollaborativeContext(candidates, {
        organisationId: input.organisationId,
        projectId: input.projectId,
        userId: input.actorUserId,
        reviewerAssignmentId: assignment.id,
        reviewPhase: 'blind_collecting',
        projectAuthorized: true,
        organisationAuthorized: true,
      }, {
        maxItems: input.maxMemoryItems,
        maxBytes: input.maxMemoryBytes,
      });
      try {
        return { assignment, memory, result: await this.dependencies.executor.review({ assignment, packet, memory }) };
      } catch {
        return {
          assignment,
          memory,
          result: { outcome: { kind: 'malformed', detail: 'executor_failure' }, findings: [] } satisfies ReviewExecutionResult,
        };
      }
    }));
    const collected: Array<{
      assignment: ReviewerAssignmentRecord;
      outcome: ReviewerOutcome;
      findings: ReviewFinding[];
    }> = [];

    for (const execution of executions) {
      const resolvedAt = new Date();
      const normalized = normalizeReviewerExecutionResult(
        execution.result, input.reviewRunId, execution.assignment.id, resolvedAt,
      );
      const outcome = normalized.outcome;
      const persisted = await this.dependencies.unitOfWork.run(async ({
        users, memberships, reviewCouncil, audit,
      }) => {
        await requireActiveProjectUser(
          users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
        );
        await requireCollectingRun(
          reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
        );
        if (outcome.status === 'availability_failure') {
          const assignment = await reviewCouncil.recordReviewerAvailabilityFailure(
            input.organisationId,
            execution.assignment.id,
            outcome.reason,
            resolvedAt,
          );
          await audit.append(createAuditEvent({
            organisationId: input.organisationId,
            projectId: input.projectId,
            eventType: 'review.assignment.availability_failure',
            actorType: 'user',
            actorId: input.actorUserId,
            subjectType: 'reviewer_assignment',
            subjectId: assignment.id,
            metadata: { reason: outcome.reason },
          }));
          return { assignment, findings: [] as ReviewFinding[] };
        }

        const assignment = await reviewCouncil.recordReviewerCompleted(
          input.organisationId,
          execution.assignment.id,
          digestReviewMaterial(outcome.content),
          resolvedAt,
        );
        const findings = normalized.findings;
        for (const finding of findings) {
          await reviewCouncil.createFinding(input.organisationId, finding);
        }
        await audit.append(createAuditEvent({
          organisationId: input.organisationId,
          projectId: input.projectId,
          eventType: 'review.assignment.completed',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'reviewer_assignment',
          subjectId: assignment.id,
          metadata: { findingCount: findings.length, contentDigest: assignment.contentDigest ?? null },
        }));
        return { assignment, findings };
      });
      collected.push({ assignment: persisted.assignment, outcome, findings: persisted.findings });
    }

    await this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
      );
      await reviewCouncil.markAdjudicating(input.organisationId, input.reviewRunId);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'review.run.adjudicating', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'review_run', subjectId: input.reviewRunId,
        metadata: { resolvedAssignments: collected.length },
      }));
    });
    return collected;
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
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
      );
      await requireAdjudicatingRun(
        reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
      );
      const finding = await reviewCouncil.getFinding(
        input.organisationId, input.reviewRunId, input.findingId,
      );
      if (!finding) throw new Error('review finding not found');
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
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
      );
      await requireAdjudicatingRun(
        reviewCouncil, input.organisationId, input.projectId, input.reviewRunId, true,
      );
      const findings = await reviewCouncil.listFindings(input.organisationId, input.reviewRunId);
      const adjudications = await reviewCouncil.listAdjudications(
        input.organisationId, input.reviewRunId,
      );
      const gate = evaluateReviewGate(findings, adjudications);
      if (gate.status === 'blocked') {
        await reviewCouncil.markBlocked(input.organisationId, input.reviewRunId);
        await audit.append(createAuditEvent({
          organisationId: input.organisationId, projectId: input.projectId,
          eventType: 'review.run.blocked', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'review_run', subjectId: input.reviewRunId,
          metadata: { blockingFindingIds: gate.blockingFindingIds },
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
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
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
    await this.requireActiveProjectUser(input.organisationId, input.projectId, input.actorUserId);
    await this.requireRunForProject(input.organisationId, input.projectId, input.reviewRunId);
    const replacementSourceDigest = digestReviewMaterial(input.replacementSource);
    const invalidatedAt = validDate(input.now);
    return this.dependencies.unitOfWork.run(async ({ users, memberships, reviewCouncil, audit }) => {
      await requireActiveProjectUser(
        users, memberships, input.organisationId, input.projectId, input.actorUserId, true,
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
