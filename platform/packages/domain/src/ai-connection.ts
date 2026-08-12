import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const AI_CONNECTION_OWNERSHIPS = ['personal', 'organisation'] as const;
export type AIConnectionOwnership = (typeof AI_CONNECTION_OWNERSHIPS)[number];

export const AI_CONNECTION_STATUSES = [
  'configured',
  'available',
  'reauth_required',
  'disabled',
  'revoked',
] as const;
export type AIConnectionStatus = (typeof AI_CONNECTION_STATUSES)[number];

export const AI_CONNECTION_SHARE_MODES = ['online_only', 'persistent'] as const;
export type AIConnectionShareMode = (typeof AI_CONNECTION_SHARE_MODES)[number];

export const AI_CONNECTION_CREDENTIAL_STRATEGIES = [
  'runner_managed',
  'environment',
  'external_secret_ref',
  'none',
] as const;
export type AIConnectionCredentialStrategy = (typeof AI_CONNECTION_CREDENTIAL_STRATEGIES)[number];

export interface AIConnectionUsagePolicy {
  availableFrom?: Date;
  availableUntil?: Date;
}

export interface AIConnectionRecord {
  id: string;
  organisationId: string;
  ownership: AIConnectionOwnership;
  ownerUserId?: string;
  providerId: string;
  connectionFamilyId: string;
  credentialStrategy: AIConnectionCredentialStrategy;
  secretRefId?: string;
  status: AIConnectionStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}

export interface CreateAIConnectionRecordInput {
  id?: string;
  organisationId: string;
  ownership: AIConnectionOwnership;
  ownerUserId?: string;
  providerId: string;
  connectionFamilyId: string;
  credentialStrategy: AIConnectionCredentialStrategy;
  secretRefId?: string;
  status?: AIConnectionStatus;
  createdBy: string;
  createdAt?: Date;
}

function requireOwnership(value: unknown): AIConnectionOwnership {
  if (typeof value !== 'string' || !AI_CONNECTION_OWNERSHIPS.includes(value as AIConnectionOwnership)) {
    throw new DomainValidationError('ownership', 'ownership must be personal or organisation');
  }
  return value as AIConnectionOwnership;
}

function requireCredentialStrategy(value: unknown): AIConnectionCredentialStrategy {
  if (
    typeof value !== 'string' ||
    !AI_CONNECTION_CREDENTIAL_STRATEGIES.includes(value as AIConnectionCredentialStrategy)
  ) {
    throw new DomainValidationError(
      'credentialStrategy',
      'credentialStrategy must be runner_managed, environment, external_secret_ref, or none',
    );
  }
  return value as AIConnectionCredentialStrategy;
}

function requireStatus(value: unknown): AIConnectionStatus {
  if (typeof value !== 'string' || !AI_CONNECTION_STATUSES.includes(value as AIConnectionStatus)) {
    throw new DomainValidationError('status', 'status must be a known AI connection status');
  }
  return value as AIConnectionStatus;
}

export function isAIConnectionShareMode(value: unknown): value is AIConnectionShareMode {
  return typeof value === 'string' && AI_CONNECTION_SHARE_MODES.includes(value as AIConnectionShareMode);
}

export function validateAIConnectionUsagePolicy(policy: AIConnectionUsagePolicy): void {
  const { availableFrom, availableUntil } = policy;
  if (availableFrom !== undefined && !(availableFrom instanceof Date)) {
    throw new DomainValidationError('availableFrom', 'availableFrom must be a Date');
  }
  if (availableUntil !== undefined && !(availableUntil instanceof Date)) {
    throw new DomainValidationError('availableUntil', 'availableUntil must be a Date');
  }
  if (availableFrom && availableUntil && availableUntil.getTime() <= availableFrom.getTime()) {
    throw new DomainValidationError(
      'availableUntil',
      'availableUntil must be strictly after availableFrom',
    );
  }
}

export function createAIConnectionRecord(input: CreateAIConnectionRecordInput): AIConnectionRecord {
  const organisationId = requireNonBlank(input.organisationId, 'organisationId');
  const ownership = requireOwnership(input.ownership);
  const providerId = requireStableIdentifier(input.providerId, 'providerId');
  const connectionFamilyId = requireStableIdentifier(input.connectionFamilyId, 'connectionFamilyId');
  const credentialStrategy = requireCredentialStrategy(input.credentialStrategy);
  const createdBy = requireNonBlank(input.createdBy, 'createdBy');

  if (ownership === 'personal') {
    if (input.ownerUserId === undefined || input.ownerUserId === null) {
      throw new DomainValidationError('ownerUserId', 'personal ownership requires ownerUserId');
    }
  } else if (input.ownerUserId !== undefined) {
    throw new DomainValidationError('ownerUserId', 'organisation ownership forbids ownerUserId');
  }

  const now = input.createdAt ?? new Date();
  const record: AIConnectionRecord = {
    id: input.id ?? randomUUID(),
    organisationId,
    ownership,
    providerId,
    connectionFamilyId,
    credentialStrategy,
    status: input.status ? requireStatus(input.status) : 'configured',
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  if (ownership === 'personal') {
    record.ownerUserId = requireNonBlank(input.ownerUserId, 'ownerUserId');
  }
  if (input.secretRefId !== undefined) {
    record.secretRefId = requireNonBlank(input.secretRefId, 'secretRefId');
  }

  return record;
}
