import { describe, expect, it } from 'vitest';
import {
  createKnowledgeRecord,
  DomainValidationError,
  KNOWLEDGE_STATUSES,
  reviseKnowledgeRecord,
} from '../src/index.js';

describe('Product Knowledge', () => {
  const validInput = {
    organisationId: 'org-001',
    projectId: 'project-001',
    category: 'business_rule',
    title: 'PPV playback entitlement',
    content: 'Payment never directly exposes the origin playback URL.',
    source: 'product_discussion',
    createdBy: 'user-001',
  };

  it('creates proposed canonical knowledge with provenance by default', () => {
    const record = createKnowledgeRecord(validInput);
    expect(record.status).toBe('proposed');
    expect(record.revision).toBe(1);
    expect(record.source).toBe('product_discussion');
    expect(record.organisationId).toBe('org-001');
    expect(record.projectId).toBe('project-001');
  });

  it('preserves inferred knowledge without implicitly approving it', () => {
    const record = createKnowledgeRecord({ ...validInput, status: 'inferred' });
    expect(record.status).toBe('inferred');    expect(record.status).not.toBe('approved');
  });

  it('accepts every defined lifecycle status', () => {
    for (const status of KNOWLEDGE_STATUSES) {
      expect(createKnowledgeRecord({ ...validInput, status }).status).toBe(status);
    }
  });

  it('rejects an unknown lifecycle status at runtime', () => {
    const input = { ...validInput, status: 'secretly-approved' } as unknown as Parameters<
      typeof createKnowledgeRecord
    >[0];
    expect(() => createKnowledgeRecord(input)).toThrowError(DomainValidationError);
    expect(() => createKnowledgeRecord(input)).toThrow('status');
  });

  it.each([
    'organisationId', 'projectId', 'category', 'title', 'content', 'source', 'createdBy',
  ] as const)('rejects blank %s', (field) => {
    expect(() => createKnowledgeRecord({ ...validInput, [field]: '   ' })).toThrow(field);
  });

  it('creates an immutable next revision while preserving canonical identity', () => {
    const original = createKnowledgeRecord(validInput);
    const revised = reviseKnowledgeRecord(original, {
      content: 'Playback requires an active entitlement and short-lived token.',
      status: 'confirmed',
      createdBy: 'user-002',
    });
    expect(revised.id).toBe(original.id);
    expect(revised.organisationId).toBe(original.organisationId);
    expect(revised.projectId).toBe(original.projectId);
    expect(revised.category).toBe(original.category);
    expect(revised.source).toBe(original.source);
    expect(revised.revision).toBe(2);
    expect(revised.status).toBe('confirmed');
    expect(revised.content).toContain('active entitlement');
    expect(revised.createdBy).toBe('user-002');
    expect(original.revision).toBe(1);
    expect(original.content).toBe(validInput.content);
  });
});
