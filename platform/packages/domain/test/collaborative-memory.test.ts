import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  MEMORY_SCOPES,
  MEMORY_TRUST_STATES,
  MEMORY_VISIBILITIES,
  canRecallCollaborativeMemory,
  createAgentHandoff,
  createCollaborativeMemoryRecord,
  createEngineeringSession,
  createMemoryLink,
  digestMemoryContent,
  rebindEngineeringSessionExecution,
  type CollaborativeMemoryRecord,
} from '../src/index.js';

const now = new Date('2026-08-17T00:45:00.000Z');
const baseMemory = () => ({
  id: 'mem-001',
  organisationId: 'org-001',
  projectId: 'project-001',
  scope: 'project' as const,
  visibility: 'project_shared' as const,
  kind: 'context' as const,
  trust: 'unreviewed' as const,
  title: 'Checkout implementation context',
  content: 'Payment workstream uses the approved checkout service contract.',
  createdBy: 'user-001',
  sourceType: 'human' as const,
  createdAt: now,
});
describe('Collaborative Memory domain', () => {
  it('exposes only the approved first-slice scope, visibility and trust states', () => {
    expect(MEMORY_SCOPES).toEqual([
      'project', 'workstream', 'agent', 'session', 'review', 'user', 'organisation',
    ]);
    expect(MEMORY_VISIBILITIES).toEqual([
      'session_private', 'workstream_shared', 'project_shared', 'organisation_shared',
      'reviewer_private', 'adjudication_shared', 'user_private',
    ]);
    expect(MEMORY_TRUST_STATES).toEqual([
      'unreviewed', 'verified', 'governed', 'superseded', 'rejected',
    ]);
  });

  it('creates a tenant/project-scoped record with stable content digest and immutable provenance fields', () => {
    const record = createCollaborativeMemoryRecord({
      ...baseMemory(),
      sourceHarnessId: 'codex',
      sourceSessionId: 'session-001',
      targetHarnessIds: ['claude-code', 'opencode'],
    });
    expect(record.contentDigest).toBe(digestMemoryContent(record.content));
    expect(record).toMatchObject({
      organisationId: 'org-001', projectId: 'project-001',
      sourceHarnessId: 'codex', sourceSessionId: 'session-001',
      targetHarnessIds: ['claude-code', 'opencode'],
    });
  });
  it('preserves full ECC-compatible identity and import provenance', () => {
    const eccId = 'mem_20260817_' + 'a'.repeat(70);
    const record = createCollaborativeMemoryRecord({
      ...baseMemory(), id: eccId, sourceType: 'ecc_import', sourceSchema: 'ecc.memory.v1',
      sourceDocumentDigest: 'b'.repeat(64), sourceReference: 'project:handoffs/' + eccId + '.md',
      tags: ['auth', 'handoff'],
    });
    expect(record.id).toBe(eccId);
    expect(record.sourceSchema).toBe('ecc.memory.v1');
    expect(record.sourceDocumentDigest).toBe('b'.repeat(64));
    expect(record.tags).toEqual(['auth', 'handoff']);
  });

  it('requires complete ECC import provenance and unique bounded tags', () => {
    expect(() => createCollaborativeMemoryRecord({ ...baseMemory(), sourceType: 'ecc_import' }))
      .toThrow(/source.*digest|provenance|schema/i);
    expect(() => createCollaborativeMemoryRecord({
      ...baseMemory(), sourceType: 'ecc_import', sourceSchema: 'ecc.memory.v1',
      sourceDocumentDigest: 'b'.repeat(64), tags: ['auth', 'auth'],
    })).toThrow(/tags.*duplicate/i);
  });

  it('requires project identity for collaborative project/workstream/agent/session/review scopes', () => {
    for (const scope of ['project', 'workstream', 'agent', 'session', 'review'] as const) {
      expect(() => createCollaborativeMemoryRecord({
        ...baseMemory(), scope, projectId: undefined as never,
      })).toThrowError(DomainValidationError);
    }
  });

  it('rejects secret-like content before a memory record can be produced', () => {
    for (const content of [
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      'api_key=sk-super-secret-value-1234567890',
      'password=hunter2-hunter2-hunter2',
    ]) {
      expect(() => createCollaborativeMemoryRecord({ ...baseMemory(), content }))
        .toThrow(/secret|credential/i);
    }
  });

  it('strips unknown credential/session fields instead of reflecting them into durable memory', () => {
    const input = {
      ...baseMemory(), apiKey: 'forbidden', refreshToken: 'forbidden',
      providerSession: 'forbidden', cookie: 'forbidden',
    } as Parameters<typeof createCollaborativeMemoryRecord>[0] & Record<string, unknown>;
    const record = createCollaborativeMemoryRecord(input) as CollaborativeMemoryRecord & Record<string, unknown>;
    for (const key of ['apiKey', 'refreshToken', 'providerSession', 'cookie']) {
      expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
    }
  });
  it('keeps user-private memory owned by the user and outside implicit project sharing', () => {
    const { organisationId: _organisationId, projectId: _projectId, ...userMemory } = baseMemory();
    const record = createCollaborativeMemoryRecord({
      ...userMemory, scope: 'user', visibility: 'user_private', ownerUserId: 'user-001',
      kind: 'preference', title: 'Personal preference', content: 'Prefer concise progress updates.',
    });
    expect(canRecallCollaborativeMemory(record, {
      userId: 'user-001', projectAuthorized: false, organisationAuthorized: false,
    })).toBe(true);
    expect(canRecallCollaborativeMemory(record, {
      userId: 'user-002', organisationId: 'org-001', projectId: 'project-001',
      projectAuthorized: true, organisationAuthorized: true,
    })).toBe(false);

    const harnessTargeted = createCollaborativeMemoryRecord({
      ...userMemory, id: 'mem_user_harness', scope: 'user', visibility: 'user_private',
      ownerUserId: 'user-001', kind: 'preference', title: 'Harness preference',
      content: 'Only recall this preference in Claude Code.', targetHarnessIds: ['claude-code'],
    });
    expect(canRecallCollaborativeMemory(harnessTargeted, {
      userId: 'user-001', harnessId: 'codex', projectAuthorized: false, organisationAuthorized: false,
    })).toBe(false);
    expect(canRecallCollaborativeMemory(harnessTargeted, {
      userId: 'user-001', harnessId: 'claude-code', projectAuthorized: false, organisationAuthorized: false,
    })).toBe(true);
  });

  it('excludes rejected and superseded memory from normal recall', () => {
    const context = { organisationId: 'org-001', projectId: 'project-001', projectAuthorized: true, organisationAuthorized: true };
    for (const trust of ['rejected', 'superseded'] as const) {
      const record = createCollaborativeMemoryRecord({ ...baseMemory(), trust });
      expect(canRecallCollaborativeMemory(record, context)).toBe(false);
    }
  });

  it('isolates session-private and reviewer-private memory while allowing authorised project sharing', () => {
    const sessionPrivate = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'session', visibility: 'session_private',
      sourceSessionId: 'session-001',
    });
    expect(canRecallCollaborativeMemory(sessionPrivate, {
      organisationId: 'org-001', projectId: 'project-001', sessionId: 'session-001',
      projectAuthorized: true, organisationAuthorized: true,
    })).toBe(true);
    expect(canRecallCollaborativeMemory(sessionPrivate, {
      organisationId: 'org-001', projectId: 'project-001', sessionId: 'session-002',
      projectAuthorized: true, organisationAuthorized: true,
    })).toBe(false);
  });
  it('enforces reviewer-private and adjudication visibility by phase and assignment', () => {
    const reviewerPrivate = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'review', visibility: 'reviewer_private',
      reviewerAssignmentId: 'assignment-001', kind: 'evidence',
    });
    const peer = {
      organisationId: 'org-001', projectId: 'project-001', projectAuthorized: true,
      organisationAuthorized: true, reviewerAssignmentId: 'assignment-002', reviewPhase: 'blind_collecting' as const,
    };
    expect(canRecallCollaborativeMemory(reviewerPrivate, { ...peer, reviewerAssignmentId: 'assignment-001' })).toBe(true);
    expect(canRecallCollaborativeMemory(reviewerPrivate, peer)).toBe(false);
    expect(canRecallCollaborativeMemory(reviewerPrivate, {
      ...peer, reviewerAssignmentId: 'assignment-001', reviewPhase: 'adjudicating',
    })).toBe(false);
    expect(canRecallCollaborativeMemory(reviewerPrivate, {
      ...peer, reviewerAssignmentId: 'assignment-001', reviewPhase: 'normal',
    })).toBe(false);

    const adjudication = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'review', visibility: 'adjudication_shared', kind: 'evidence',
    });
    expect(canRecallCollaborativeMemory(adjudication, { ...peer, reviewPhase: 'blind_collecting', canAdjudicate: true })).toBe(false);
    expect(canRecallCollaborativeMemory(adjudication, { ...peer, reviewPhase: 'adjudicating', canAdjudicate: true })).toBe(true);
  });

  it('requires workstream and explicit targets to match before shared recall', () => {
    const record = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'workstream', visibility: 'workstream_shared',
      workstreamId: 'payments', targetAgentIds: ['agent-test'],
    });
    const context = {
      organisationId: 'org-001', projectId: 'project-001', workstreamId: 'payments',
      projectAuthorized: true, organisationAuthorized: true,
    };
    expect(canRecallCollaborativeMemory(record, { ...context, agentId: 'agent-test' })).toBe(true);
    expect(canRecallCollaborativeMemory(record, { ...context, agentId: 'agent-other' })).toBe(false);
    expect(canRecallCollaborativeMemory(record, { ...context, workstreamId: 'frontend', agentId: 'agent-test' })).toBe(false);
  });
  it('normalizes empty target dimensions so targetability is stable before and after persistence', () => {
    const byAgent = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'workstream', visibility: 'workstream_shared', workstreamId: 'payments',
      targetAgentIds: ['agent-test'], targetSessionIds: [],
    });
    expect(byAgent.targetSessionIds).toBeUndefined();
    expect(canRecallCollaborativeMemory(byAgent, {
      organisationId: 'org-001', projectId: 'project-001', workstreamId: 'payments',
      agentId: 'agent-test', projectAuthorized: true, organisationAuthorized: true,
    })).toBe(true);

    const bySession = createCollaborativeMemoryRecord({
      ...baseMemory(), scope: 'workstream', visibility: 'workstream_shared', workstreamId: 'payments',
      targetAgentIds: [], targetSessionIds: ['session-test'],
    });
    expect(bySession.targetAgentIds).toBeUndefined();
    expect(canRecallCollaborativeMemory(bySession, {
      organisationId: 'org-001', projectId: 'project-001', workstreamId: 'payments',
      sessionId: 'session-test', projectAuthorized: true, organisationAuthorized: true,
    })).toBe(true);
  });

  it('enforces explicit harness targeting in recall contexts', () => {
    const record = createCollaborativeMemoryRecord({
      ...baseMemory(), targetHarnessIds: ['claude-code'],
    });
    const context = {
      organisationId: 'org-001', projectId: 'project-001',
      projectAuthorized: true, organisationAuthorized: true,
    };
    expect(canRecallCollaborativeMemory(record, { ...context, harnessId: 'claude-code' })).toBe(true);
    expect(canRecallCollaborativeMemory(record, { ...context, harnessId: 'codex' })).toBe(false);
    expect(canRecallCollaborativeMemory(record, context)).toBe(false);
  });

  it('validates explicit memory links instead of inferring last-writer-wins', () => {
    expect(createMemoryLink({
      sourceMemoryId: 'mem-002', targetMemoryId: 'mem-001', relation: 'supersedes',
    })).toEqual({ sourceMemoryId: 'mem-002', targetMemoryId: 'mem-001', relation: 'supersedes' });
    expect(() => createMemoryLink({
      sourceMemoryId: 'mem-001', targetMemoryId: 'mem-001', relation: 'supersedes',
    })).toThrow(DomainValidationError);
  });

  it('keeps platform engineering session identity stable when execution route changes', () => {
    const session = createEngineeringSession({
      id: 'session-001', organisationId: 'org-001', projectId: 'project-001',
      workstreamId: 'payments', taskId: 'task-001', agentId: 'agent-backend',
      harnessId: 'codex', modelRouteId: 'openai-gpt', runnerId: 'runner-001',
      environmentId: 'local', createdBy: 'user-001', createdAt: now,
    });
    const rebound = rebindEngineeringSessionExecution(session, {
      harnessId: 'claude-code', modelRouteId: 'anthropic-sonnet', runnerId: 'runner-002',
      environmentId: 'opensandbox', updatedAt: new Date(now.getTime() + 1000),
    });
    expect(rebound).toMatchObject({
      id: 'session-001', organisationId: 'org-001', projectId: 'project-001',
      taskId: 'task-001', agentId: 'agent-backend', harnessId: 'claude-code',
      modelRouteId: 'anthropic-sonnet', environmentId: 'opensandbox',
    });
  });

  it('creates a credential-free durable handoff between sessions or agents', () => {
    const handoff = createAgentHandoff({
      id: 'handoff-001', organisationId: 'org-001', projectId: 'project-001',
      sourceSessionId: 'session-001', sourceAgentId: 'agent-backend',
      targetSessionIds: ['session-002'], targetAgentIds: ['agent-test'],
      summary: 'Implementation complete; run integration and adversarial tests.',
      evidenceReferences: ['commit:abc123', 'test:unit-42'], blockers: [],
      createdBy: 'user-001', createdAt: now,
    });
    expect(handoff.targetSessionIds).toEqual(['session-002']);
    expect(handoff.targetAgentIds).toEqual(['agent-test']);
    expect(() => createAgentHandoff({
      ...handoff, id: 'handoff-002', summary: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
    })).toThrow(/secret|credential/i);
  });
});