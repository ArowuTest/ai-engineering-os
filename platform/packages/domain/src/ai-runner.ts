import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const AI_RUNNER_OWNERSHIPS = ['personal', 'organisation'] as const;
export type AIRunnerOwnership = (typeof AI_RUNNER_OWNERSHIPS)[number];

export const AI_RUNNER_STATUSES = ['registered', 'online', 'offline', 'disabled', 'revoked'] as const;
export type AIRunnerStatus = (typeof AI_RUNNER_STATUSES)[number];

export const AI_RUNNER_TRUST_STATES = ['pending', 'trusted', 'restricted', 'revoked'] as const;
export type AIRunnerTrustState = (typeof AI_RUNNER_TRUST_STATES)[number];
export type AIRunnerCapability = string;

export interface AIRunnerRecord {
  id: string;
  organisationId: string;
  ownership: AIRunnerOwnership;
  ownerUserId?: string;
  harnessId: string;
  status: AIRunnerStatus;
  trustState: AIRunnerTrustState;
  persistentSupported: boolean;
  capabilities: AIRunnerCapability[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

export interface CreateAIRunnerRecordInput {
  id?: string;
  organisationId: string;
  ownership: AIRunnerOwnership;
  ownerUserId?: string;
  harnessId: string;
  status?: AIRunnerStatus;
  trustState?: AIRunnerTrustState;
  persistentSupported: boolean;
  capabilities: AIRunnerCapability[];
  createdBy: string;
  createdAt?: Date;
}

export interface AIRunnerConnectionBinding {
  id: string;
  organisationId: string;
  runnerId: string;
  connectionId: string;
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface RunnerTaskEnvelope {
  id: string;
  organisationId: string;
  projectId: string;
  taskId: string;
  connectionId: string;
  routeId: string;
  harnessId: string;
  allowedOperations: string[];
  workspaceScope: string;
  issuedAt: Date;
  expiresAt: Date;
  nonce: string;
}

function requireOwnership(value: unknown): AIRunnerOwnership {
  if (typeof value !== 'string' || !AI_RUNNER_OWNERSHIPS.includes(value as AIRunnerOwnership)) {
    throw new DomainValidationError('ownership', 'ownership must be personal or organisation');
  }
  return value as AIRunnerOwnership;
}

function requireStatus(value: unknown): AIRunnerStatus {
  if (typeof value !== 'string' || !AI_RUNNER_STATUSES.includes(value as AIRunnerStatus)) {
    throw new DomainValidationError('status', 'status must be a known AI runner status');
  }
  return value as AIRunnerStatus;
}

function requireTrustState(value: unknown): AIRunnerTrustState {
  if (typeof value !== 'string' || !AI_RUNNER_TRUST_STATES.includes(value as AIRunnerTrustState)) {
    throw new DomainValidationError('trustState', 'trustState must be a known AI runner trust state');
  }
  return value as AIRunnerTrustState;
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError(field, `${field} must be a valid Date`);
  }
  return value;
}

export function validateAIRunnerConnectionBinding(binding: AIRunnerConnectionBinding): AIRunnerConnectionBinding {
  const normalized: AIRunnerConnectionBinding = {
    id: requireStableIdentifier(binding.id, 'id'),
    organisationId: requireStableIdentifier(binding.organisationId, 'organisationId'),
    runnerId: requireStableIdentifier(binding.runnerId, 'runnerId'),
    connectionId: requireStableIdentifier(binding.connectionId, 'connectionId'),
    createdBy: requireNonBlank(binding.createdBy, 'createdBy'),
    createdAt: requireDate(binding.createdAt, 'createdAt')
  };
  if (binding.revokedAt !== undefined) {
    const revokedAt = requireDate(binding.revokedAt, 'revokedAt');
    if (revokedAt.getTime() < normalized.createdAt.getTime()) {
      throw new DomainValidationError('revokedAt', 'revokedAt must not precede createdAt');
    }
    normalized.revokedAt = revokedAt;
  }
  return normalized;
}
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DomainValidationError(field, `${field} must be a boolean`);
  }
  return value;
}

export function validateAIRunnerCapabilities(value: unknown): AIRunnerCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError('capabilities', 'capabilities must be a non-empty array');
  }

  const capabilities = value.map((capability, index) => requireStableIdentifier(capability, `capabilities[${index}]`));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new DomainValidationError('capabilities', 'capabilities must not contain duplicates');
  }
  return capabilities;
}

function validateStableIdentifierList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError(field, `${field} must be a non-empty array`);
  }
  const identifiers = value.map((item, index) => requireStableIdentifier(item, `${field}[${index}]`));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new DomainValidationError(field, `${field} must not contain duplicates`);
  }
  return identifiers;
}

export function createAIRunnerRecord(input: CreateAIRunnerRecordInput): AIRunnerRecord {
  const organisationId = requireStableIdentifier(input.organisationId, 'organisationId');
  const ownership = requireOwnership(input.ownership);
  const harnessId = requireStableIdentifier(input.harnessId, 'harnessId');
  const persistentSupported = requireBoolean(input.persistentSupported, 'persistentSupported');
  const capabilities = validateAIRunnerCapabilities(input.capabilities);
  const createdBy = requireNonBlank(input.createdBy, 'createdBy');

  if (ownership === 'personal') {
    if (input.ownerUserId === undefined || input.ownerUserId === null) {
      throw new DomainValidationError('ownerUserId', 'personal ownership requires ownerUserId');
    }
  } else if (input.ownerUserId !== undefined) {
    throw new DomainValidationError('ownerUserId', 'organisation ownership forbids ownerUserId');
  }

  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  const record: AIRunnerRecord = {
    id: input.id === undefined ? randomUUID() : requireStableIdentifier(input.id, 'id'),
    organisationId,
    ownership,
    harnessId,
    status: input.status === undefined ? 'registered' : requireStatus(input.status),
    trustState: input.trustState === undefined ? 'pending' : requireTrustState(input.trustState),
    persistentSupported,
    capabilities,
    createdBy,
    createdAt,
    updatedAt: createdAt
  };

  if (ownership === 'personal') {
    record.ownerUserId = requireStableIdentifier(input.ownerUserId, 'ownerUserId');
  }
  return record;
}

export function validateRunnerTaskEnvelope(envelope: RunnerTaskEnvelope): RunnerTaskEnvelope {
  const issuedAt = requireDate(envelope.issuedAt, 'issuedAt');
  const expiresAt = requireDate(envelope.expiresAt, 'expiresAt');
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new DomainValidationError('expiresAt', 'expiresAt must be strictly after issuedAt');
  }

  return {
    id: requireStableIdentifier(envelope.id, 'id'),
    organisationId: requireStableIdentifier(envelope.organisationId, 'organisationId'),
    projectId: requireStableIdentifier(envelope.projectId, 'projectId'),
    taskId: requireStableIdentifier(envelope.taskId, 'taskId'),
    connectionId: requireStableIdentifier(envelope.connectionId, 'connectionId'),
    routeId: requireStableIdentifier(envelope.routeId, 'routeId'),
    harnessId: requireStableIdentifier(envelope.harnessId, 'harnessId'),
    allowedOperations: validateStableIdentifierList(envelope.allowedOperations, 'allowedOperations'),
    workspaceScope: requireNonBlank(envelope.workspaceScope, 'workspaceScope'),
    issuedAt,
    expiresAt,
    nonce: requireStableIdentifier(envelope.nonce, 'nonce')
  };
}
