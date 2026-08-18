import { randomUUID } from 'node:crypto';
import {
  createAgentHandoff,
  createAuditEvent,
  createCollaborativeMemoryRecord,
  createEngineeringSession,
  rebindEngineeringSessionExecution,
  type AgentHandoff,
  type CollaborativeMemoryRecord,
  type EngineeringSession,
  type MemoryAccessContext,
} from '@engineering-os/domain';
import type {
  CollaborativeMemoryRepository,
  DatabaseUnitOfWork,
  EngineeringSessionRepository,
  MembershipRepository,
  UserRepository,
} from '@engineering-os/database';
import { selectCollaborativeContext } from './collaborative-memory-policy.js';

export interface EngineeringSessionServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  memberships: MembershipRepository;
  users: UserRepository;
  collaborativeMemory: CollaborativeMemoryRepository;
  engineeringSessions: EngineeringSessionRepository;
}

function newMemoryId(): string {
  return `mem_${randomUUID().replaceAll('-', '')}`;
}

function requireDate(value: Date | undefined): Date {
  const resolved = value ?? new Date();
  if (!(resolved instanceof Date) || !Number.isFinite(resolved.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  return new Date(resolved.getTime());
}
export class EngineeringSessionService {
  constructor(private readonly dependencies: EngineeringSessionServiceDependencies) {}

  private async requireActiveProjectUser(
    organisationId: string,
    projectId: string,
    actorUserId: string,
  ): Promise<void> {
    const [user, organisationMembership, projectMembership] = await Promise.all([
      this.dependencies.users.getById(actorUserId),
      this.dependencies.memberships.getOrganisation(organisationId, actorUserId),
      this.dependencies.memberships.getProject(organisationId, projectId, actorUserId),
    ]);
    if (
      !user || user.status !== 'active' ||
      !organisationMembership || organisationMembership.status !== 'active' ||
      !projectMembership || projectMembership.status !== 'active'
    ) {
      throw new Error('forbidden');
    }
  }

  private async requireOwnedSession(
    organisationId: string,
    projectId: string,
    actorUserId: string,
    sessionId: string,
  ): Promise<EngineeringSession> {
    await this.requireActiveProjectUser(organisationId, projectId, actorUserId);
    const session = await this.dependencies.engineeringSessions.get(organisationId, projectId, sessionId);
    if (!session || session.createdBy !== actorUserId) throw new Error('forbidden');
    return session;
  }

  async startSession(input: {
    organisationId: string; projectId: string; actorUserId: string;
    workstreamId?: string; taskId: string; agentId: string;
    harnessId?: string; modelRouteId?: string; runnerId?: string;
    environmentId?: string; workspaceReference?: string; now?: Date;
  }): Promise<EngineeringSession> {
    const now = requireDate(input.now);    const session = createEngineeringSession({
      id: randomUUID(), organisationId: input.organisationId, projectId: input.projectId,
      ...(input.workstreamId === undefined ? {} : { workstreamId: input.workstreamId }),
      taskId: input.taskId, agentId: input.agentId,
      ...(input.harnessId === undefined ? {} : { harnessId: input.harnessId }),
      ...(input.modelRouteId === undefined ? {} : { modelRouteId: input.modelRouteId }),
      ...(input.runnerId === undefined ? {} : { runnerId: input.runnerId }),
      ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
      ...(input.workspaceReference === undefined ? {} : { workspaceReference: input.workspaceReference }),
      createdBy: input.actorUserId, createdAt: now,
    });

    await this.dependencies.unitOfWork.run(async ({ users, memberships, engineeringSessions, audit }) => {
      const user = await users.getByIdForUpdate(input.actorUserId);
      const organisationMembership = await memberships.getOrganisationForUpdate(
        input.organisationId, input.actorUserId,
      );
      const projectMembership = await memberships.getProjectForUpdate(
        input.organisationId, input.projectId, input.actorUserId,
      );
      if (
        !user || user.status !== 'active' ||
        !organisationMembership || organisationMembership.status !== 'active' ||
        !projectMembership || projectMembership.status !== 'active'
      ) throw new Error('forbidden');
      await engineeringSessions.requireActiveAssignmentForUpdate({
        organisationId: input.organisationId, projectId: input.projectId, userId: input.actorUserId,
        ...(input.workstreamId === undefined ? {} : { workstreamId: input.workstreamId }),
        taskId: input.taskId, agentId: input.agentId,
      });
      await engineeringSessions.create(session);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'engineering.session.started', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'engineering_session', subjectId: session.id,
        metadata: { agentId: session.agentId, harnessId: session.harnessId ?? null },
      }));
    });
    return session;
  }

  async recordCheckpoint(input: {
    organisationId: string; projectId: string; actorUserId: string; sessionId: string;
    title: string; content: string; now?: Date;
  }): Promise<CollaborativeMemoryRecord> {
    const now = requireDate(input.now);    const sourceSession = await this.requireOwnedSession(
      input.organisationId, input.projectId, input.actorUserId, input.sessionId,
    );
    const memory = createCollaborativeMemoryRecord({
      id: newMemoryId(), organisationId: input.organisationId, projectId: input.projectId,
      ...(sourceSession.workstreamId === undefined ? {} : { workstreamId: sourceSession.workstreamId }),
      scope: 'session', visibility: 'session_private', kind: 'checkpoint', trust: 'unreviewed',
      title: input.title, content: input.content, createdBy: input.actorUserId,
      sourceType: 'agent', sourceAgentId: sourceSession.agentId, sourceSessionId: sourceSession.id,
      ...(sourceSession.harnessId === undefined ? {} : { sourceHarnessId: sourceSession.harnessId }),
      createdAt: now,
    });

    await this.dependencies.unitOfWork.run(async ({ users, memberships, collaborativeMemory, audit }) => {
      const user = await users.getByIdForUpdate(input.actorUserId);
      const organisationMembership = await memberships.getOrganisationForUpdate(
        input.organisationId, input.actorUserId,
      );
      const projectMembership = await memberships.getProjectForUpdate(
        input.organisationId, input.projectId, input.actorUserId,
      );
      if (!user || user.status !== 'active' || !organisationMembership || organisationMembership.status !== 'active' ||
          !projectMembership || projectMembership.status !== 'active') throw new Error('forbidden');
      await collaborativeMemory.createMemory(memory);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'engineering.session.checkpointed', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'collaborative_memory', subjectId: memory.id,
        metadata: { sessionId: sourceSession.id, agentId: sourceSession.agentId },
      }));
    });
    return memory;
  }

  async createHandoff(input: {
    organisationId: string; projectId: string; actorUserId: string; sourceSessionId: string;
    targetSessionIds: string[]; targetAgentIds: string[]; summary: string;
    evidenceReferences: string[]; blockers: string[]; now?: Date;
  }): Promise<{ handoff: AgentHandoff; memory: CollaborativeMemoryRecord }> {
    const now = requireDate(input.now);    const sourceSession = await this.requireOwnedSession(
      input.organisationId, input.projectId, input.actorUserId, input.sourceSessionId,
    );
    for (const targetSessionId of input.targetSessionIds) {
      const target = await this.dependencies.engineeringSessions.get(
        input.organisationId, input.projectId, targetSessionId,
      );
      if (!target) throw new Error('invalid_handoff_target');
    }

    const handoff = createAgentHandoff({
      id: randomUUID(), organisationId: input.organisationId, projectId: input.projectId,
      sourceSessionId: sourceSession.id, sourceAgentId: sourceSession.agentId,
      targetSessionIds: input.targetSessionIds, targetAgentIds: input.targetAgentIds,
      summary: input.summary, evidenceReferences: input.evidenceReferences, blockers: input.blockers,
      createdBy: input.actorUserId, createdAt: now,
      ...(sourceSession.workspaceReference === undefined ? {} : { workspaceReference: sourceSession.workspaceReference }),
    });
    const sharedByWorkstream = sourceSession.workstreamId !== undefined;
    const memory = createCollaborativeMemoryRecord({
      id: newMemoryId(), organisationId: input.organisationId, projectId: input.projectId,
      ...(sourceSession.workstreamId === undefined ? {} : { workstreamId: sourceSession.workstreamId }),
      scope: sharedByWorkstream ? 'workstream' : 'project',
      visibility: sharedByWorkstream ? 'workstream_shared' : 'project_shared',
      kind: 'handoff', trust: 'unreviewed', title: `Handoff from ${sourceSession.agentId}`,
      content: input.summary, createdBy: input.actorUserId, sourceType: 'agent',
      sourceAgentId: sourceSession.agentId, sourceSessionId: sourceSession.id,
      ...(sourceSession.harnessId === undefined ? {} : { sourceHarnessId: sourceSession.harnessId }),
      targetAgentIds: input.targetAgentIds, targetSessionIds: input.targetSessionIds, createdAt: now,
    });

    await this.dependencies.unitOfWork.run(async ({ users, memberships, collaborativeMemory, audit }) => {
      const user = await users.getByIdForUpdate(input.actorUserId);
      const organisationMembership = await memberships.getOrganisationForUpdate(
        input.organisationId, input.actorUserId,
      );
      const projectMembership = await memberships.getProjectForUpdate(
        input.organisationId, input.projectId, input.actorUserId,
      );      if (!user || user.status !== 'active' || !organisationMembership || organisationMembership.status !== 'active' ||
          !projectMembership || projectMembership.status !== 'active') throw new Error('forbidden');
      await collaborativeMemory.createHandoff(handoff);
      await collaborativeMemory.createMemory(memory);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'engineering.handoff.created', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'agent_handoff', subjectId: handoff.id,
        metadata: { sourceSessionId: sourceSession.id, memoryId: memory.id },
      }));
    });
    return { handoff, memory };
  }

  async getContext(input: {
    organisationId: string; projectId: string; actorUserId: string; sessionId: string;
    maxItems: number; maxBytes: number;
    reviewerAssignmentId?: string; reviewPhase?: MemoryAccessContext['reviewPhase']; canAdjudicate?: boolean;
  }) {
    const session = await this.requireOwnedSession(
      input.organisationId, input.projectId, input.actorUserId, input.sessionId,
    );
    if (
      input.reviewerAssignmentId !== undefined ||
      input.reviewPhase !== undefined ||
      input.canAdjudicate !== undefined
    ) {
      throw new Error('review_context_requires_review_council_authority');
    }
    const candidates = await this.dependencies.collaborativeMemory.listProjectMemoriesForUser(
      input.organisationId, input.projectId, input.actorUserId, {
        sessionId: session.id,
        ...(session.workstreamId === undefined ? {} : { workstreamId: session.workstreamId }),
        agentId: session.agentId,
        ...(session.harnessId === undefined ? {} : { harnessId: session.harnessId }),
        reviewPhase: 'normal', maxCandidates: input.maxItems,
      },
    );
    const access: MemoryAccessContext = {
      organisationId: input.organisationId, projectId: input.projectId, userId: input.actorUserId,
      sessionId: session.id, agentId: session.agentId,
      ...(session.harnessId === undefined ? {} : { harnessId: session.harnessId }),
      ...(session.workstreamId === undefined ? {} : { workstreamId: session.workstreamId }),
      projectAuthorized: true, organisationAuthorized: true,
      reviewPhase: 'normal',
    };
    return selectCollaborativeContext(candidates, access, {
      maxItems: input.maxItems, maxBytes: input.maxBytes,
    });
  }

  async continueSession(input: {
    organisationId: string; projectId: string; actorUserId: string; sessionId: string;
    harnessId?: string; modelRouteId?: string; runnerId?: string; environmentId?: string;
    workspaceReference?: string; now?: Date;
  }): Promise<EngineeringSession> {
    const requestedAt = requireDate(input.now);    const current = await this.requireOwnedSession(
      input.organisationId, input.projectId, input.actorUserId, input.sessionId,
    );
    const updatedAt = new Date(Math.max(requestedAt.getTime(), current.updatedAt.getTime() + 1));
    const rebound = rebindEngineeringSessionExecution(current, {
      ...(input.harnessId === undefined ? {} : { harnessId: input.harnessId }),
      ...(input.modelRouteId === undefined ? {} : { modelRouteId: input.modelRouteId }),
      ...(input.runnerId === undefined ? {} : { runnerId: input.runnerId }),
      ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
      ...(input.workspaceReference === undefined ? {} : { workspaceReference: input.workspaceReference }),
      updatedAt,
    });

    await this.dependencies.unitOfWork.run(async ({ users, memberships, engineeringSessions, audit }) => {
      const user = await users.getByIdForUpdate(input.actorUserId);
      const organisationMembership = await memberships.getOrganisationForUpdate(
        input.organisationId, input.actorUserId,
      );
      const projectMembership = await memberships.getProjectForUpdate(
        input.organisationId, input.projectId, input.actorUserId,
      );
      if (!user || user.status !== 'active' || !organisationMembership || organisationMembership.status !== 'active' ||
          !projectMembership || projectMembership.status !== 'active') throw new Error('forbidden');
      await engineeringSessions.rebindExecution(rebound, current.updatedAt);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId, projectId: input.projectId,
        eventType: 'engineering.session.execution_rebound', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'engineering_session', subjectId: rebound.id,
        metadata: {
          harnessId: rebound.harnessId ?? null, modelRouteId: rebound.modelRouteId ?? null,
          runnerId: rebound.runnerId ?? null, environmentId: rebound.environmentId ?? null,
        },
      }));
    });
    return rebound;
  }
}
