import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank } from './validation.js';

export const AUDIT_ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditEvent {
  id: string;
  organisationId: string;
  projectId?: string;
  eventType: string;
  actorType: AuditActorType;
  actorId: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

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
function requireActorType(value: unknown): AuditActorType {
  if (typeof value !== 'string' || !AUDIT_ACTOR_TYPES.includes(value as AuditActorType)) {
    throw new DomainValidationError('actorType', 'actorType must be user, agent, or system');
  }
  return value as AuditActorType;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    eventType: requireNonBlank(input.eventType, 'eventType'),
    actorType: requireActorType(input.actorType),
    actorId: requireNonBlank(input.actorId, 'actorId'),
    subjectType: requireNonBlank(input.subjectType, 'subjectType'),
    subjectId: requireNonBlank(input.subjectId, 'subjectId'),
    metadata: { ...(input.metadata ?? {}) },
    occurredAt: new Date(),
  };
  if (input.projectId !== undefined) {
    event.projectId = requireNonBlank(input.projectId, 'projectId');
  }
  return event;
}
