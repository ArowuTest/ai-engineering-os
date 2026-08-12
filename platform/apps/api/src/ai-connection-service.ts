import { randomUUID } from 'node:crypto';
import {
  createAuditEvent,
  isAIConnectionShareMode,
  validateAIConnectionUsagePolicy,
  type AIConnectionCredentialStrategy,
  type AIConnectionOwnership,
  type AIConnectionRecord,
  type AIConnectionShareMode,
  type AIConnectionStatus,
  type AIConnectionUsagePolicy,
} from '@engineering-os/domain';
import type {
  AIConnectionProjectShareRecord,
  AIConnectionRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
} from '@engineering-os/database';
import type { TransactionRepositories } from '@engineering-os/database';
import type {
  ConnectionFamilyPolicyRegistry,
  TrustedConnectionFamilyPolicy,
} from './ai-connection-policy.js';

export type AIConnectionServiceErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'policy_blocked'
  | 'conflict';

export class AIConnectionServiceError extends Error {
  constructor(readonly code: AIConnectionServiceErrorCode, message = code) {
    super(message);
    this.name = 'AIConnectionServiceError';
  }
}

export interface AIConnectionServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  aiConnections: AIConnectionRepository;
  memberships: MembershipRepository;
  policy: ConnectionFamilyPolicyRegistry;
}

export interface AIConnectionSummary {
  id: string;
  organisationId: string;
  ownership: AIConnectionOwnership;
  ownerUserId?: string;
  providerId: string;
  connectionFamilyId: string;
  credentialStrategy: AIConnectionCredentialStrategy;
  status: AIConnectionStatus;
  credentialConfigured: boolean;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

function toSummary(record: AIConnectionRecord): AIConnectionSummary {
  const summary: AIConnectionSummary = {
    id: record.id,
    organisationId: record.organisationId,
    ownership: record.ownership,
    providerId: record.providerId,
    connectionFamilyId: record.connectionFamilyId,
    credentialStrategy: record.credentialStrategy,
    status: record.status,
    credentialConfigured: record.secretRefId !== undefined && record.secretRefId.trim() !== '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.ownerUserId !== undefined) summary.ownerUserId = record.ownerUserId;
  if (record.revokedAt !== undefined) summary.revokedAt = record.revokedAt;
  return summary;
}

const PERSONAL_ALLOWED_STRATEGIES: readonly AIConnectionCredentialStrategy[] = [
  'runner_managed',
  'none',
];

function pickPersonalStrategy(
  policy: TrustedConnectionFamilyPolicy,
): AIConnectionCredentialStrategy | null {
  for (const candidate of PERSONAL_ALLOWED_STRATEGIES) {
    if (policy.credentialStrategies.includes(candidate)) return candidate;
  }
  return null;
}

function pickOrganisationStrategy(
  policy: TrustedConnectionFamilyPolicy,
  hasSecretRef: boolean,
): AIConnectionCredentialStrategy | null {
  if (hasSecretRef) {
    return policy.credentialStrategies.includes('external_secret_ref')
      ? 'external_secret_ref'
      : null;
  }
  const nonSecret = policy.credentialStrategies.filter((s) => s !== 'external_secret_ref');
  if (nonSecret.length !== 1) return null;
  return nonSecret[0] ?? null;
}

export class AIConnectionService {
  constructor(private readonly dependencies: AIConnectionServiceDependencies) {}

  async registerPersonalConnection(input: {
    organisationId: string;
    actorUserId: string;
    connectionFamilyId: string;
    now?: Date;
  }): Promise<AIConnectionSummary> {
    const now = input.now ?? new Date();
    const policy = this.dependencies.policy.get(input.connectionFamilyId);
    if (!policy) throw new AIConnectionServiceError('policy_blocked');
    if (!policy.allowedOwnership.includes('personal')) {
      throw new AIConnectionServiceError('policy_blocked');
    }
    const strategy = pickPersonalStrategy(policy);
    if (!strategy) throw new AIConnectionServiceError('policy_blocked');

    const record: AIConnectionRecord = {
      id: randomUUID(),
      organisationId: input.organisationId,
      ownership: 'personal',
      ownerUserId: input.actorUserId,
      providerId: policy.providerId,
      connectionFamilyId: policy.id,
      credentialStrategy: strategy,
      status: 'configured',
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    await this.dependencies.unitOfWork.run(async ({ memberships, aiConnections, audit }) => {
      const membership = await memberships.getOrganisation(input.organisationId, input.actorUserId);
      if (!membership || membership.status !== 'active') {
        throw new AIConnectionServiceError('forbidden');
      }
      await aiConnections.createConnection(record);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.personal.registered',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection',
        subjectId: record.id,
        metadata: {
          ownership: record.ownership,
          connectionFamilyId: record.connectionFamilyId,
          providerId: record.providerId,
          credentialStrategy: record.credentialStrategy,
          status: record.status,
          ownerUserId: record.ownerUserId,
        },
      }));
    });

    return toSummary(record);
  }

  async registerOrganisationConnection(input: {
    organisationId: string;
    actorUserId: string;
    connectionFamilyId: string;
    secretRefId?: string;
    now?: Date;
  }): Promise<AIConnectionSummary> {
    const now = input.now ?? new Date();
    const policy = this.dependencies.policy.get(input.connectionFamilyId);
    if (!policy) throw new AIConnectionServiceError('policy_blocked');
    if (!policy.allowedOwnership.includes('organisation')) {
      throw new AIConnectionServiceError('policy_blocked');
    }
    const trimmedSecret =
      typeof input.secretRefId === 'string' ? input.secretRefId.trim() : '';
    const hasSecretRef = trimmedSecret.length > 0;
    const strategy = pickOrganisationStrategy(policy, hasSecretRef);
    if (!strategy) throw new AIConnectionServiceError('policy_blocked');
    if (strategy === 'external_secret_ref' && !hasSecretRef) {
      throw new AIConnectionServiceError('policy_blocked');
    }

    const record: AIConnectionRecord = {
      id: randomUUID(),
      organisationId: input.organisationId,
      ownership: 'organisation',
      providerId: policy.providerId,
      connectionFamilyId: policy.id,
      credentialStrategy: strategy,
      status: 'configured',
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    if (strategy === 'external_secret_ref') {
      record.secretRefId = trimmedSecret;
    }

    await this.dependencies.unitOfWork.run(async ({ memberships, aiConnections, audit }) => {
      const membership = await memberships.getOrganisation(input.organisationId, input.actorUserId);
      if (!membership || membership.status !== 'active') {
        throw new AIConnectionServiceError('forbidden');
      }
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        throw new AIConnectionServiceError('forbidden');
      }
      await aiConnections.createConnection(record);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.organisation.registered',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection',
        subjectId: record.id,
        metadata: {
          ownership: record.ownership,
          connectionFamilyId: record.connectionFamilyId,
          providerId: record.providerId,
          credentialStrategy: record.credentialStrategy,
          status: record.status,
          credentialConfigured: hasSecretRef,
        },
      }));
    });

    return toSummary(record);
  }

  async listConnections(input: {
    organisationId: string;
    actorUserId: string;
  }): Promise<AIConnectionSummary[]> {
    const membership = await this.dependencies.memberships.getOrganisation(
      input.organisationId, input.actorUserId,
    );
    if (!membership || membership.status !== 'active') {
      throw new AIConnectionServiceError('forbidden');
    }
    const [personal, organisation] = await Promise.all([
      this.dependencies.aiConnections.listForUser(input.organisationId, input.actorUserId),
      this.dependencies.aiConnections.listOrganisationConnections(input.organisationId),
    ]);
    return [...personal, ...organisation].map(toSummary);
  }

  async revokeConnection(input: {
    organisationId: string;
    actorUserId: string;
    connectionId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, aiConnections, audit }) => {
      const membership = await memberships.getOrganisation(input.organisationId, input.actorUserId);
      if (!membership || membership.status !== 'active') {
        throw new AIConnectionServiceError('forbidden');
      }
      const record = await aiConnections.getConnection(input.organisationId, input.connectionId);
      if (!record) throw new AIConnectionServiceError('not_found');
      if (record.ownership === 'personal') {
        if (record.ownerUserId !== input.actorUserId) {
          throw new AIConnectionServiceError('forbidden');
        }
      } else if (membership.role !== 'owner' && membership.role !== 'admin') {
        throw new AIConnectionServiceError('forbidden');
      }
      if (record.status === 'revoked') throw new AIConnectionServiceError('conflict');

      await aiConnections.setConnectionStatus(input.organisationId, record.id, 'revoked', now);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.revoked',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection',
        subjectId: record.id,
        metadata: {
          ownership: record.ownership,
          connectionFamilyId: record.connectionFamilyId,
          providerId: record.providerId,
          previousStatus: record.status,
        },
      }));
    });
  }

  // -------------------- Project sharing --------------------

  private async loadShareContext(
    txn: TransactionRepositories,
    organisationId: string,
    actorUserId: string,
    projectId: string,
    connectionId: string,
  ): Promise<{
    membershipRole: 'owner' | 'admin' | 'member';
    connection: AIConnectionRecord;
  }> {
    const membership = await txn.memberships.getOrganisation(organisationId, actorUserId);
    if (!membership || membership.status !== 'active') {
      throw new AIConnectionServiceError('forbidden');
    }
    const project = await txn.projects.getById(organisationId, projectId);
    if (!project) throw new AIConnectionServiceError('not_found');
    const connection = await txn.aiConnections.getConnection(organisationId, connectionId);
    if (!connection) throw new AIConnectionServiceError('not_found');
    if (connection.ownership !== 'personal') {
      throw new AIConnectionServiceError('forbidden');
    }
    return { membershipRole: membership.role, connection };
  }

  private async assertProjectAccess(
    txn: TransactionRepositories,
    organisationId: string,
    projectId: string,
    actorUserId: string,
    orgRole: 'owner' | 'admin' | 'member',
  ): Promise<void> {
    if (orgRole === 'owner' || orgRole === 'admin') return;
    const pm = await txn.memberships.getProject(organisationId, projectId, actorUserId);
    if (!pm || pm.status !== 'active') {
      throw new AIConnectionServiceError('forbidden');
    }
  }

  private requireDelegatablePolicy(connectionFamilyId: string) {
    const policy = this.dependencies.policy.get(connectionFamilyId);
    if (!policy || !policy.delegatable) {
      throw new AIConnectionServiceError('policy_blocked');
    }
    return policy;
  }

  async shareConnectionWithProject(input: {
    organisationId: string;
    actorUserId: string;
    projectId: string;
    connectionId: string;
    usagePolicy?: AIConnectionUsagePolicy;
    now?: Date;
  }): Promise<void> {
    const usagePolicy = input.usagePolicy ?? {};
    try {
      validateAIConnectionUsagePolicy(usagePolicy);
    } catch {
      throw new AIConnectionServiceError('policy_blocked');
    }
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async (txn) => {
      const { membershipRole, connection } = await this.loadShareContext(
        txn, input.organisationId, input.actorUserId, input.projectId, input.connectionId,
      );
      if (connection.status === 'revoked') {
        throw new AIConnectionServiceError('conflict');
      }
      if (connection.ownerUserId !== input.actorUserId) {
        throw new AIConnectionServiceError('forbidden');
      }
      this.requireDelegatablePolicy(connection.connectionFamilyId);
      await this.assertProjectAccess(
        txn, input.organisationId, input.projectId, input.actorUserId, membershipRole,
      );
      const existing = await txn.aiConnections.getActiveProjectShare(
        input.organisationId, input.projectId, input.connectionId,
      );
      if (existing) throw new AIConnectionServiceError('conflict');

      const share: AIConnectionProjectShareRecord = {
        id: randomUUID(),
        organisationId: input.organisationId,
        projectId: input.projectId,
        connectionId: input.connectionId,
        mode: 'online_only',
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      };
      if (usagePolicy.availableFrom !== undefined) share.availableFrom = usagePolicy.availableFrom;
      if (usagePolicy.availableUntil !== undefined) share.availableUntil = usagePolicy.availableUntil;
      await txn.aiConnections.createProjectShare(share);

      await txn.audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.project_share.enabled',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection_project_share',
        subjectId: share.id,
        metadata: {
          connectionId: connection.id,
          projectId: input.projectId,
          connectionFamilyId: connection.connectionFamilyId,
          providerId: connection.providerId,
          mode: share.mode,
          availableFrom: share.availableFrom?.toISOString() ?? null,
          availableUntil: share.availableUntil?.toISOString() ?? null,
        },
      }));
    });
  }

  async setProjectShareMode(input: {
    organisationId: string;
    actorUserId: string;
    projectId: string;
    connectionId: string;
    mode: AIConnectionShareMode;
    now?: Date;
  }): Promise<void> {
    if (!isAIConnectionShareMode(input.mode)) {
      throw new AIConnectionServiceError('policy_blocked');
    }
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async (txn) => {
      const { membershipRole, connection } = await this.loadShareContext(
        txn, input.organisationId, input.actorUserId, input.projectId, input.connectionId,
      );
      if (connection.status === 'revoked') {
        throw new AIConnectionServiceError('conflict');
      }
      if (connection.ownerUserId !== input.actorUserId) {
        throw new AIConnectionServiceError('forbidden');
      }
      const policy = this.requireDelegatablePolicy(connection.connectionFamilyId);
      if (input.mode === 'persistent' && !policy.persistentSupported) {
        throw new AIConnectionServiceError('policy_blocked');
      }
      await this.assertProjectAccess(
        txn, input.organisationId, input.projectId, input.actorUserId, membershipRole,
      );
      const existing = await txn.aiConnections.getActiveProjectShare(
        input.organisationId, input.projectId, input.connectionId,
      );
      if (!existing) throw new AIConnectionServiceError('not_found');
      if (existing.mode === input.mode) throw new AIConnectionServiceError('conflict');

      await txn.aiConnections.revokeProjectShare(input.organisationId, existing.id, now);
      const replacement: AIConnectionProjectShareRecord = {
        id: randomUUID(),
        organisationId: input.organisationId,
        projectId: input.projectId,
        connectionId: input.connectionId,
        mode: input.mode,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      };
      if (existing.availableFrom !== undefined) replacement.availableFrom = existing.availableFrom;
      if (existing.availableUntil !== undefined) replacement.availableUntil = existing.availableUntil;
      await txn.aiConnections.createProjectShare(replacement);

      await txn.audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.project_share.mode_changed',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection_project_share',
        subjectId: replacement.id,
        metadata: {
          connectionId: connection.id,
          projectId: input.projectId,
          connectionFamilyId: connection.connectionFamilyId,
          providerId: connection.providerId,
          previousMode: existing.mode,
          newMode: replacement.mode,
          previousShareId: existing.id,
        },
      }));
    });
  }

  async updateProjectShareUsagePolicy(input: {
    organisationId: string;
    actorUserId: string;
    projectId: string;
    connectionId: string;
    usagePolicy: AIConnectionUsagePolicy;
    now?: Date;
  }): Promise<void> {
    try {
      validateAIConnectionUsagePolicy(input.usagePolicy);
    } catch {
      throw new AIConnectionServiceError('policy_blocked');
    }
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async (txn) => {
      const { membershipRole, connection } = await this.loadShareContext(
        txn, input.organisationId, input.actorUserId, input.projectId, input.connectionId,
      );
      if (connection.status === 'revoked') {
        throw new AIConnectionServiceError('conflict');
      }
      this.requireDelegatablePolicy(connection.connectionFamilyId);
      const isConnectionOwner = connection.ownerUserId === input.actorUserId;
      const isOrgAdminOrOwner = membershipRole === 'owner' || membershipRole === 'admin';
      if (!isConnectionOwner && !isOrgAdminOrOwner) {
        throw new AIConnectionServiceError('forbidden');
      }
      await this.assertProjectAccess(
        txn, input.organisationId, input.projectId, input.actorUserId, membershipRole,
      );
      const existing = await txn.aiConnections.getActiveProjectShare(
        input.organisationId, input.projectId, input.connectionId,
      );
      if (!existing) throw new AIConnectionServiceError('not_found');

      const nextFrom = input.usagePolicy.availableFrom;
      const nextUntil = input.usagePolicy.availableUntil;
      if (!isConnectionOwner) {
        // Restrict-only: availableFrom may move later; availableUntil may move earlier.
        // Neither may be cleared once set.
        if (existing.availableFrom !== undefined) {
          if (nextFrom === undefined || nextFrom.getTime() < existing.availableFrom.getTime()) {
            throw new AIConnectionServiceError('forbidden');
          }
        }
        if (existing.availableUntil !== undefined) {
          if (nextUntil === undefined || nextUntil.getTime() > existing.availableUntil.getTime()) {
            throw new AIConnectionServiceError('forbidden');
          }
        }
        // Setting a bound when there was none previously counts as narrowing (allowed).
      }

      await txn.aiConnections.revokeProjectShare(input.organisationId, existing.id, now);
      const replacement: AIConnectionProjectShareRecord = {
        id: randomUUID(),
        organisationId: input.organisationId,
        projectId: input.projectId,
        connectionId: input.connectionId,
        mode: existing.mode,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      };
      if (nextFrom !== undefined) replacement.availableFrom = nextFrom;
      if (nextUntil !== undefined) replacement.availableUntil = nextUntil;
      await txn.aiConnections.createProjectShare(replacement);

      await txn.audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.project_share.policy_changed',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection_project_share',
        subjectId: replacement.id,
        metadata: {
          connectionId: connection.id,
          projectId: input.projectId,
          connectionFamilyId: connection.connectionFamilyId,
          providerId: connection.providerId,
          previousShareId: existing.id,
          previousAvailableFrom: existing.availableFrom?.toISOString() ?? null,
          previousAvailableUntil: existing.availableUntil?.toISOString() ?? null,
          newAvailableFrom: replacement.availableFrom?.toISOString() ?? null,
          newAvailableUntil: replacement.availableUntil?.toISOString() ?? null,
        },
      }));
    });
  }

  async revokeProjectShare(input: {
    organisationId: string;
    actorUserId: string;
    projectId: string;
    connectionId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async (txn) => {
      const { membershipRole, connection } = await this.loadShareContext(
        txn, input.organisationId, input.actorUserId, input.projectId, input.connectionId,
      );
      if (connection.ownerUserId !== input.actorUserId) {
        throw new AIConnectionServiceError('forbidden');
      }
      await this.assertProjectAccess(
        txn, input.organisationId, input.projectId, input.actorUserId, membershipRole,
      );
      const existing = await txn.aiConnections.getActiveProjectShare(
        input.organisationId, input.projectId, input.connectionId,
      );
      if (!existing) throw new AIConnectionServiceError('not_found');
      await txn.aiConnections.revokeProjectShare(input.organisationId, existing.id, now);
      await txn.audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'ai.connection.project_share.revoked',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'ai_connection_project_share',
        subjectId: existing.id,
        metadata: {
          connectionId: connection.id,
          projectId: input.projectId,
          connectionFamilyId: connection.connectionFamilyId,
          providerId: connection.providerId,
          previousMode: existing.mode,
        },
      }));
    });
  }
}
