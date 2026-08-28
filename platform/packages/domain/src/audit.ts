import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank } from './validation.js';

export const AUDIT_ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

interface AuditEventBase {
  id: string;
  eventType: string;
  actorType: AuditActorType;
  actorId: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface AuditEvent extends AuditEventBase {
  organisationId: string;
  projectId?: string;
}

export interface PlatformAuditEvent extends AuditEventBase {}

export interface CreateAuditEventInput {
  organisationId: string;
  projectId?: string;
  eventType: string;
  actorType: AuditActorType;
  actorId: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePlatformAuditEventInput {
  eventType: string;
  actorType: AuditActorType;
  actorId: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

function requireActorType(value: unknown): AuditActorType {
  if (typeof value !== 'string' || !AUDIT_ACTOR_TYPES.includes(value as AuditActorType)) {
    throw new DomainValidationError('actorType', 'actorType must be user, agent, or system');
  }
  return value as AuditActorType;
}

function createBase(input: CreatePlatformAuditEventInput): AuditEventBase {
  return {
    id: randomUUID(),
    eventType: requireNonBlank(input.eventType, 'eventType'),
    actorType: requireActorType(input.actorType),
    actorId: requireNonBlank(input.actorId, 'actorId'),
    subjectType: requireNonBlank(input.subjectType, 'subjectType'),
    subjectId: requireNonBlank(input.subjectId, 'subjectId'),
    metadata: { ...(input.metadata ?? {}) },
    occurredAt: new Date(),
  };
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const event: AuditEvent = {
    ...createBase(input),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
  };
  if (input.projectId !== undefined) event.projectId = requireNonBlank(input.projectId, 'projectId');
  return event;
}

export function createPlatformAuditEvent(input: CreatePlatformAuditEventInput): PlatformAuditEvent {
  return createBase(input);
}
