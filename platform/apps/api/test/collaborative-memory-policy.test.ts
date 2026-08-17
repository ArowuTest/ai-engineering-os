import { describe, expect, it } from 'vitest';
import {
  createCollaborativeMemoryRecord,
  type CollaborativeMemoryRecord,
  type MemoryAccessContext,
} from '@engineering-os/domain';
import {
  resolveMemoryVisibility,
  selectCollaborativeContext,
} from '../src/collaborative-memory-policy.js';

const now = new Date('2026-08-17T01:05:00.000Z');

function memory(overrides: Partial<Parameters<typeof createCollaborativeMemoryRecord>[0]> = {}): CollaborativeMemoryRecord {
  return createCollaborativeMemoryRecord({
    id: 'mem-001', organisationId: 'org-001', projectId: 'project-001',
    scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
    title: 'Context', content: 'Shared project context.', createdBy: 'user-001',
    sourceType: 'agent', sourceAgentId: 'agent-backend', createdAt: now,
    ...overrides,
  });
}

function context(overrides: Partial<MemoryAccessContext> = {}): MemoryAccessContext {
  return {
    organisationId: 'org-001', projectId: 'project-001', userId: 'user-001',
    agentId: 'agent-test', sessionId: 'session-002', workstreamId: 'payments',
    projectAuthorized: true, organisationAuthorized: true, reviewPhase: 'normal',
    ...overrides,
  };
}
describe('Collaborative Memory context policy', () => {
  it('allows authorised project memory and denies the same record after project authorization is revoked', () => {
    const record = memory();
    expect(resolveMemoryVisibility(record, context())).toEqual({ allowed: true, reason: 'project_shared' });
    expect(resolveMemoryVisibility(record, context({ projectAuthorized: false })))
      .toEqual({ allowed: false, reason: 'policy_denied' });
  });

  it('keeps session-private memory inside the owning platform session', () => {
    const record = memory({
      scope: 'session', visibility: 'session_private', sourceSessionId: 'session-001',
    });
    expect(resolveMemoryVisibility(record, context({ sessionId: 'session-001' })).allowed).toBe(true);
    expect(resolveMemoryVisibility(record, context({ sessionId: 'session-002' })))
      .toEqual({ allowed: false, reason: 'policy_denied' });
  });

  it('shares workstream memory only with matching authorised workstream/targets', () => {
    const record = memory({
      scope: 'workstream', visibility: 'workstream_shared', workstreamId: 'payments',
      targetAgentIds: ['agent-test'],
    });
    expect(resolveMemoryVisibility(record, context()).allowed).toBe(true);
    expect(resolveMemoryVisibility(record, context({ workstreamId: 'frontend' })).allowed).toBe(false);
    expect(resolveMemoryVisibility(record, context({ agentId: 'agent-other' })).allowed).toBe(false);
  });
  it('never exposes user-private memory through project context', () => {
    const record = createCollaborativeMemoryRecord({
      id: 'mem-user', scope: 'user', visibility: 'user_private', kind: 'preference',
      trust: 'unreviewed', title: 'Private preference', content: 'Use terse updates.',
      ownerUserId: 'user-001', createdBy: 'user-001', sourceType: 'human', createdAt: now,
    });
    expect(resolveMemoryVisibility(record, context({ userId: 'user-002' })).allowed).toBe(false);
    expect(resolveMemoryVisibility(record, context({ userId: 'user-001' })))
      .toEqual({ allowed: true, reason: 'user_private_owner' });
  });

  it('keeps peer reviewer memory blind and exposes adjudication memory only in adjudication phase', () => {
    const reviewer = memory({
      id: 'mem-reviewer', scope: 'review', visibility: 'reviewer_private',
      reviewerAssignmentId: 'assignment-001', kind: 'evidence',
    });
    const blind = context({ reviewPhase: 'blind_collecting', reviewerAssignmentId: 'assignment-002' });
    expect(resolveMemoryVisibility(reviewer, blind).allowed).toBe(false);
    expect(resolveMemoryVisibility(reviewer, { ...blind, reviewerAssignmentId: 'assignment-001' }).allowed).toBe(true);

    const adjudication = memory({
      id: 'mem-adjudication', scope: 'review', visibility: 'adjudication_shared', kind: 'evidence',
    });
    expect(resolveMemoryVisibility(adjudication, { ...blind, canAdjudicate: true }).allowed).toBe(false);
    expect(resolveMemoryVisibility(adjudication, {
      ...blind, reviewPhase: 'adjudicating', canAdjudicate: true,
    }).allowed).toBe(true);
  });
  it('excludes rejected/superseded records and returns safe explainable inclusion reasons', () => {
    const records = [
      memory({ id: 'mem-project' }),
      memory({ id: 'mem-rejected', trust: 'rejected' }),
      memory({ id: 'mem-superseded', trust: 'superseded' }),
    ];
    const selected = selectCollaborativeContext(records, context(), { maxItems: 10, maxBytes: 4096 });
    expect(selected.items.map((item) => item.memoryId)).toEqual(['mem-project']);
    expect(selected.items[0]?.reason).toBe('project_shared');
    expect(selected.excluded).toEqual([
      { reason: 'policy_denied' },
      { reason: 'policy_denied' },
    ]);
    expect(selected.excluded.every((item) => !('memoryId' in item))).toBe(true);
  });

  it('enforces item and byte budgets deterministically without returning partial memory bodies', () => {
    const records = [
      memory({ id: 'mem-a', content: 'A'.repeat(20) }),
      memory({ id: 'mem-b', content: 'B'.repeat(20) }),
      memory({ id: 'mem-c', content: 'C'.repeat(20) }),
    ];
    const byCount = selectCollaborativeContext(records, context(), { maxItems: 2, maxBytes: 4096 });
    expect(byCount.items.map((item) => item.memoryId)).toEqual(['mem-a', 'mem-b']);
    expect(byCount.excluded.find((item) => item.reason === 'budget_exceeded' && item.memoryId === 'mem-c')?.reason).toBe('budget_exceeded');

    const byBytes = selectCollaborativeContext(records, context(), { maxItems: 10, maxBytes: 25 });
    expect(byBytes.items.map((item) => item.memoryId)).toEqual(['mem-a']);
    expect(byBytes.items[0]?.record.content).toBe('A'.repeat(20));
    expect(byBytes.excluded.find((item) => item.reason === 'budget_exceeded' && item.memoryId === 'mem-b')?.reason).toBe('budget_exceeded');
  });
});
