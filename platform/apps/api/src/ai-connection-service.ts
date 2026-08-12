import { randomUUID } from 'node:crypto';
import {
  createAuditEvent,
  type AIConnectionCredentialStrategy,
  type AIConnectionOwnership,
  type AIConnectionRecord,
  type AIConnectionStatus,
} from '@engineering-os/domain';
import type {
  AIConnectionRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
} from '@engineering-os/database';
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

const PERSONAL_STRATEGY_PRIORITY: AIConnectionCredentialStrategy[] = [
  'runner_managed',
  'none',
  'environment',
];

function pickPersonalStrategy(
  policy: TrustedConnectionFamilyPolicy,
): AIConnectionCredentialStrategy | null {
  for (const candidate of PERSONAL_STRATEGY_PRIORITY) {
    if (policy.credentialStrategies.includes(candidate)) return candidate;
  }
  return null;
}

function pickOrganisationStrategy(
  policy: TrustedConnectionFamilyPolicy,
  hasSecretRef: boolean,
): AIConnectionCredentialStrategy | null {
  if (hasSecretRef && policy.credentialStrategies.includes('external_secret_ref')) {
    return 'external_secret_ref';
  }
  if (!hasSecretRef) {
    for (const candidate of ['none', 'environment', 'runner_managed'] as const) {
      if (policy.credentialStrategies.includes(candidate)) return candidate;
    }
  }
  return null;
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
}
