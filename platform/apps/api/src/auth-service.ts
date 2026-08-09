import { randomUUID } from 'node:crypto';
import {
  calculateInvitationExpiry,
  createAuditEvent,
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isInvitationRedeemable,
  normalizeUserId,
  verifyPassword,
  type AccountStatus,
  type OrganisationRole,
  type ProjectRole,
} from '@engineering-os/domain';
import type {
  AuditRepository,
  DatabaseUnitOfWork,
  InvitationRepository,
  MembershipRepository,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';

export type AuthServiceErrorCode =
  | 'forbidden'
  | 'invitation_invalid'
  | 'invitation_expired'
  | 'user_id_taken'
  | 'invalid_credentials'
  | 'account_suspended';

export class AuthServiceError extends Error {
  constructor(readonly code: AuthServiceErrorCode, message = code) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export interface AuthServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  users: UserRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  sessions: SessionRepository;
  audit: AuditRepository;
}

export interface AuthServiceOptions {
  sessionTtlMinutes?: number;
}

export interface SessionIdentity {
  sessionId: string;
  accountId: string;
  userId: string;
  organisations: Array<{ organisationId: string; role: OrganisationRole }>;
}

export interface ProjectIdentity extends SessionIdentity {
  organisationRole: OrganisationRole;
  projectRole: ProjectRole | null;
}

async function requireAdministrator(
  memberships: MembershipRepository,
  organisationId: string,
  actorUserId: string,
): Promise<OrganisationRole> {
  const membership = await memberships.getOrganisation(organisationId, actorUserId);
  if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    throw new AuthServiceError('forbidden');
  }
  return membership.role;
}

export class AuthService {
  private readonly sessionTtlMinutes: number;

  constructor(
    private readonly dependencies: AuthServiceDependencies,
    options: AuthServiceOptions = {},
  ) {
    this.sessionTtlMinutes = options.sessionTtlMinutes ?? 720;
    if (!Number.isInteger(this.sessionTtlMinutes) || this.sessionTtlMinutes <= 0) {
      throw new Error('sessionTtlMinutes must be a positive integer');
    }
  }

  async createInvitation(input: {
    organisationId: string;
    actorUserId: string;
    organisationRole: OrganisationRole;
    projectGrants: Array<{ projectId: string; role: ProjectRole }>;
    ttlMinutes?: number;
    now?: Date;
  }): Promise<{ invitationId: string; key: string; expiresAt: Date }> {
    const now = input.now ?? new Date();
    const key = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(key);
    const invitationId = randomUUID();

    const expiresAt = await this.dependencies.unitOfWork.run(async ({ memberships, invitations, audit }) => {
      const actorRole = await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      if (input.organisationRole === 'owner' && actorRole !== 'owner') {
        throw new AuthServiceError('forbidden');
      }
      const ttlMinutes = input.ttlMinutes ?? await invitations.getDefaultTtlMinutes(input.organisationId);
      const expires = calculateInvitationExpiry(now, ttlMinutes);
      await invitations.create({
        id: invitationId,
        organisationId: input.organisationId,
        tokenHash,
        organisationRole: input.organisationRole,
        status: 'pending',
        issuedBy: input.actorUserId,
        issuedAt: now,
        expiresAt: expires,
      }, input.projectGrants);

      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'auth.invitation.created',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'invitation',
        subjectId: invitationId,
        metadata: {
          organisationRole: input.organisationRole,
          projectGrants: input.projectGrants,
          expiresAt: expires.toISOString(),
          ttlMinutes,
        },
      }));
      return expires;
    });

    return { invitationId, key, expiresAt };
  }

  async redeemInvitation(input: {
    key: string;
    userId: string;
    password: string;
    now?: Date;
  }): Promise<{ id: string; userId: string; organisationId: string }> {
    const now = input.now ?? new Date();
    const userId = normalizeUserId(input.userId);
    const passwordHash = await hashPassword(input.password);
    const tokenHash = hashOpaqueToken(input.key);
    const newUserId = randomUUID();

    const outcome = await this.dependencies.unitOfWork.run(async ({
      users, memberships, invitations, audit,
    }) => {
      const invitation = await invitations.getByTokenHashForUpdate(tokenHash);
      if (!invitation) throw new AuthServiceError('invitation_invalid');
      if (invitation.status !== 'pending') throw new AuthServiceError('invitation_invalid');

      if (!isInvitationRedeemable(invitation.status, invitation.expiresAt, now)) {
        await invitations.setStatus(invitation.id, 'expired');
        await audit.append(createAuditEvent({
          organisationId: invitation.organisationId,
          eventType: 'auth.invitation.expired',
          actorType: 'system',
          actorId: 'auth-service',
          subjectType: 'invitation',
          subjectId: invitation.id,
          metadata: { expiresAt: invitation.expiresAt.toISOString() },
        }));
        return { kind: 'expired' as const };
      }

      if (await users.getByUserId(userId)) throw new AuthServiceError('user_id_taken');
      const user = {
        id: newUserId,
        userId,
        passwordHash,
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
      };
      await users.create(user);
      await memberships.grantOrganisation({
        organisationId: invitation.organisationId,
        userId: newUserId,
        role: invitation.organisationRole,
        createdBy: invitation.issuedBy,
        now,
      });

      const grants = await invitations.listProjectGrants(invitation.id);
      for (const grant of grants) {
        await memberships.grantProject({
          organisationId: invitation.organisationId,
          projectId: grant.projectId,
          userId: newUserId,
          role: grant.role,
          createdBy: invitation.issuedBy,
          now,
        });
      }

      await invitations.markConsumed(invitation.id, newUserId, now);
      await audit.append(createAuditEvent({
        organisationId: invitation.organisationId,
        eventType: 'auth.invitation.redeemed',
        actorType: 'user',
        actorId: newUserId,
        subjectType: 'invitation',
        subjectId: invitation.id,
        metadata: {
          organisationRole: invitation.organisationRole,
          projectGrants: grants,
        },
      }));
      await audit.append(createAuditEvent({
        organisationId: invitation.organisationId,
        eventType: 'auth.user.created',
        actorType: 'user',
        actorId: newUserId,
        subjectType: 'user',
        subjectId: newUserId,
        metadata: { userId },
      }));

      return {
        kind: 'redeemed' as const,
        user: { id: newUserId, userId, organisationId: invitation.organisationId },
      };
    });

    if (outcome.kind === 'expired') throw new AuthServiceError('invitation_expired');
    return outcome.user;
  }

  async login(input: {
    userId: string;
    password: string;
    now?: Date;
  }): Promise<{ sessionId: string; token: string; expiresAt: Date; userId: string }> {
    const now = input.now ?? new Date();
    const userId = normalizeUserId(input.userId);
    const user = await this.dependencies.users.getByUserId(userId);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AuthServiceError('invalid_credentials');
    }
    if (user.status === 'suspended') throw new AuthServiceError('account_suspended');

    const organisations = await this.dependencies.memberships.listActiveOrganisations(user.id);
    if (organisations.length === 0) throw new AuthServiceError('invalid_credentials');

    const token = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMinutes * 60_000);

    await this.dependencies.unitOfWork.run(async ({ sessions, audit }) => {
      await sessions.create({ id: sessionId, userId: user.id, tokenHash, createdAt: now, expiresAt });
      for (const membership of organisations) {
        await audit.append(createAuditEvent({
          organisationId: membership.organisationId,
          eventType: 'auth.login.succeeded',
          actorType: 'user', actorId: user.id,
          subjectType: 'auth_session', subjectId: sessionId,
          metadata: { expiresAt: expiresAt.toISOString() },
        }));
      }
    });
    return { sessionId, token, expiresAt, userId: user.userId };
  }

  async resolveSession(token: string, now = new Date()): Promise<SessionIdentity | null> {
    const session = await this.dependencies.sessions.getActiveByTokenHash(hashOpaqueToken(token), now);
    if (!session) return null;
    const user = await this.dependencies.users.getById(session.userId);
    if (!user || user.status !== 'active') return null;
    const memberships = await this.dependencies.memberships.listActiveOrganisations(user.id);
    if (memberships.length === 0) return null;
    return {
      sessionId: session.id,
      accountId: user.id,
      userId: user.userId,
      organisations: memberships.map((membership) => ({
        organisationId: membership.organisationId,
        role: membership.role,
      })),
    };
  }

  async logout(token: string, now = new Date()): Promise<void> {
    const session = await this.dependencies.sessions.getActiveByTokenHash(hashOpaqueToken(token), now);
    if (!session) return;
    const memberships = await this.dependencies.memberships.listActiveOrganisations(session.userId);
    await this.dependencies.unitOfWork.run(async ({ sessions, audit }) => {
      await sessions.revokeById(session.id, now);
      for (const membership of memberships) {
        await audit.append(createAuditEvent({
          organisationId: membership.organisationId,
          eventType: 'auth.logout',
          actorType: 'user', actorId: session.userId,
          subjectType: 'auth_session', subjectId: session.id,
          metadata: {},
        }));
      }
    });
  }

  async resolveOrganisation(
    token: string,
    organisationId: string,
    now = new Date(),
  ): Promise<(SessionIdentity & { organisationRole: OrganisationRole }) | null> {
    const identity = await this.resolveSession(token, now);
    if (!identity) return null;
    const organisation = identity.organisations.find((item) => item.organisationId === organisationId);
    if (!organisation) return null;
    return { ...identity, organisationRole: organisation.role };
  }

  async getProjectAccessScope(
    token: string,
    organisationId: string,
    now = new Date(),
  ): Promise<{ organisationRole: OrganisationRole; allProjects: boolean; projectIds: string[] } | null> {
    const identity = await this.resolveOrganisation(token, organisationId, now);
    if (!identity) return null;
    if (identity.organisationRole === 'owner' || identity.organisationRole === 'admin') {
      return { organisationRole: identity.organisationRole, allProjects: true, projectIds: [] };
    }
    const projects = await this.dependencies.memberships.listActiveProjects(organisationId, identity.accountId);
    return {
      organisationRole: identity.organisationRole,
      allProjects: false,
      projectIds: projects.map((project) => project.projectId),
    };
  }

  async authorizeProject(
    token: string,
    organisationId: string,
    projectId: string,
    now = new Date(),
  ): Promise<ProjectIdentity | null> {
    const identity = await this.resolveSession(token, now);
    if (!identity) return null;
    const organisation = identity.organisations.find((item) => item.organisationId === organisationId);
    if (!organisation) return null;
    const projectMembership = await this.dependencies.memberships.getProject(
      organisationId, projectId, identity.accountId,
    );
    if (projectMembership?.status === 'active') {
      return { ...identity, organisationRole: organisation.role, projectRole: projectMembership.role };
    }
    if (organisation.role === 'owner' || organisation.role === 'admin') {
      return { ...identity, organisationRole: organisation.role, projectRole: null };
    }
    return null;
  }

  async grantProjectAccess(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    targetUserId: string;
    role: ProjectRole;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, audit }) => {
      await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const organisationMembership = await memberships.getOrganisation(
        input.organisationId, input.targetUserId,
      );
      if (!organisationMembership || organisationMembership.status !== 'active') {
        throw new AuthServiceError('forbidden');
      }
      const previous = await memberships.getProject(
        input.organisationId, input.projectId, input.targetUserId,
      );
      await memberships.grantProject({
        organisationId: input.organisationId,
        projectId: input.projectId,
        userId: input.targetUserId,
        role: input.role,
        createdBy: input.actorUserId,
        now,
      });
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: previous?.status === 'active' ? 'auth.project_access.changed' : 'auth.project_access.granted',
        actorType: 'user', actorId: input.actorUserId,
        subjectType: 'user', subjectId: input.targetUserId,
        metadata: { previousRole: previous?.role ?? null, role: input.role },
      }));
    });
  }

  async revokeProjectAccess(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    targetUserId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, audit }) => {
      await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const target = await memberships.getProject(
        input.organisationId, input.projectId, input.targetUserId,
      );
      if (!target || target.status !== 'active') return;
      await memberships.revokeProject(input.organisationId, input.projectId, input.targetUserId, now);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        projectId: input.projectId,
        eventType: 'auth.project_access.revoked',
        actorType: 'user', actorId: input.actorUserId,
        subjectType: 'user', subjectId: input.targetUserId,
        metadata: { previousRole: target.role },
      }));
    });
  }

  async listPeople(input: { organisationId: string; actorUserId: string }) {
    await requireAdministrator(this.dependencies.memberships, input.organisationId, input.actorUserId);
    const memberships = await this.dependencies.memberships.listOrganisationMembers(input.organisationId);
    const people = [];
    for (const membership of memberships) {
      const user = await this.dependencies.users.getById(membership.userId);
      if (!user) continue;
      const projects = await this.dependencies.memberships.listActiveProjects(input.organisationId, user.id);
      people.push({
        id: user.id,
        userId: user.userId,
        accountStatus: user.status,
        organisationRole: membership.role,
        membershipStatus: membership.status,
        projects: projects.map((project) => ({ projectId: project.projectId, role: project.role })),
      });
    }
    return people;
  }

  async getInvitationPolicy(input: { organisationId: string; actorUserId: string }) {
    await requireAdministrator(this.dependencies.memberships, input.organisationId, input.actorUserId);
    return { ttlMinutes: await this.dependencies.invitations.getDefaultTtlMinutes(input.organisationId) };
  }

  async listInvitations(input: { organisationId: string; actorUserId: string }) {
    await requireAdministrator(this.dependencies.memberships, input.organisationId, input.actorUserId);
    const invitations = await this.dependencies.invitations.listByOrganisation(input.organisationId);
    return Promise.all(invitations.map(async (invitation) => ({
      id: invitation.id,
      organisationRole: invitation.organisationRole,
      status: invitation.status,
      issuedBy: invitation.issuedBy,
      issuedAt: invitation.issuedAt,
      expiresAt: invitation.expiresAt,
      consumedAt: invitation.consumedAt,
      consumedByUserId: invitation.consumedByUserId,
      projectGrants: await this.dependencies.invitations.listProjectGrants(invitation.id),
    })));
  }

  async setInvitationPolicy(input: {
    organisationId: string;
    actorUserId: string;
    ttlMinutes: number;
  }): Promise<void> {
    calculateInvitationExpiry(new Date(0), input.ttlMinutes);
    await this.dependencies.unitOfWork.run(async ({ memberships, invitations, audit }) => {
      await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const previous = await invitations.getDefaultTtlMinutes(input.organisationId);
      await invitations.setDefaultTtlMinutes(input.organisationId, input.ttlMinutes);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'auth.invitation_policy.changed', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'organisation', subjectId: input.organisationId,
        metadata: { previousTtlMinutes: previous, ttlMinutes: input.ttlMinutes },
      }));
    });
  }

  async cancelInvitation(input: {
    organisationId: string;
    actorUserId: string;
    invitationId: string;
  }): Promise<void> {
    await this.dependencies.unitOfWork.run(async ({ memberships, invitations, audit }) => {
      await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const invitation = await invitations.getById(input.invitationId);
      if (!invitation || invitation.organisationId !== input.organisationId || invitation.status !== 'pending') return;
      await invitations.setStatus(invitation.id, 'revoked');
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'auth.invitation.revoked', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'invitation', subjectId: invitation.id, metadata: {},
      }));
    });
  }

  async revokeOrganisationAccess(input: {
    organisationId: string;
    actorUserId: string;
    targetUserId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    if (input.actorUserId === input.targetUserId) throw new AuthServiceError('forbidden');
    await this.dependencies.unitOfWork.run(async ({ memberships, audit }) => {
      const actorRole = await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const target = await memberships.getOrganisation(input.organisationId, input.targetUserId);
      if (!target || target.status !== 'active') return;
      if (target.role === 'owner' && actorRole !== 'owner') throw new AuthServiceError('forbidden');
      await memberships.revokeAllProjectsForUser(input.organisationId, input.targetUserId, now);
      await memberships.revokeOrganisation(input.organisationId, input.targetUserId, now);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'auth.organisation_access.revoked', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'user', subjectId: input.targetUserId,
        metadata: { previousRole: target.role },
      }));
    });
  }

  async setUserStatus(input: {
    organisationId: string;
    actorUserId: string;
    targetUserId: string;
    status: AccountStatus;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    if (input.actorUserId === input.targetUserId && input.status === 'suspended') {
      throw new AuthServiceError('forbidden');
    }

    await this.dependencies.unitOfWork.run(async ({ users, memberships, sessions, audit }) => {
      const actorRole = await requireAdministrator(memberships, input.organisationId, input.actorUserId);
      const targetMembership = await memberships.getOrganisation(input.organisationId, input.targetUserId);
      if (!targetMembership || targetMembership.status !== 'active') throw new AuthServiceError('forbidden');
      if (targetMembership.role === 'owner' && actorRole !== 'owner') {
        throw new AuthServiceError('forbidden');
      }
      const user = await users.getById(input.targetUserId);
      if (!user) throw new AuthServiceError('forbidden');

      await users.setStatus(input.targetUserId, input.status, now);
      if (input.status === 'suspended') await sessions.revokeAllForUser(input.targetUserId, now);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: input.status === 'suspended' ? 'auth.user.suspended' : 'auth.user.reactivated',
        actorType: 'user', actorId: input.actorUserId,
        subjectType: 'user', subjectId: input.targetUserId,
        metadata: { previousStatus: user.status, status: input.status },
      }));
    });
  }
}
