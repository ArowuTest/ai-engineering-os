import { describe, expect, it } from 'vitest';
import { createAuditEvent, DomainValidationError } from '../src/index.js';

describe('createAuditEvent', () => {
  const validInput = {
    organisationId: 'org-001',
    projectId: '11111111-1111-4111-8111-111111111111',
    eventType: 'project.created',
    actorType: 'user' as const,
    actorId: 'user-001',
    subjectType: 'project',
    subjectId: '11111111-1111-4111-8111-111111111111',
    metadata: { source: 'api' },
  };

  it('creates a timestamped append-only event value', () => {
    const event = createAuditEvent(validInput);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(event.eventType).toBe('project.created');
    expect(event.actorType).toBe('user');
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.metadata).toEqual({ source: 'api' });
  });

  it('rejects unsupported actor types at runtime', () => {
    const input = { ...validInput, actorType: 'unknown' } as unknown as Parameters<
      typeof createAuditEvent
    >[0];
    expect(() => createAuditEvent(input)).toThrowError(DomainValidationError);
    expect(() => createAuditEvent(input)).toThrow('actorType');
  });
});