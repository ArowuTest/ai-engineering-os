import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCollaborativeMemoryRecord } from '@engineering-os/domain';
import {
  classifyEccMemoryImport,
  materializeCollaborativeMemoryToEcc,
  parseEccMemoryDocument,
} from '../src/index.js';

const eccId = `mem_20260817_${'a'.repeat(70)}`;
const oldId = 'mem_20260816_oldmemory';

function eccDocument(overrides: Partial<{
  id: string; kind: string; scope: string; status: string; sourceHarness: string;
  targetHarnesses: string[]; tags: string[]; links: string[]; body: string;
}> = {}): string {
  const values = {
    id: eccId, kind: 'handoff', scope: 'project', status: 'active', sourceHarness: 'codex',
    targetHarnesses: ['claude-code'], tags: ['auth', 'migration'], links: [oldId],
    body: 'Tests pass. Continue with integration and adversarial review.', ...overrides,
  };
  return `---\nschema: "ecc.memory.v1"\nid: ${JSON.stringify(values.id)}\ntitle: "Authentication migration handoff"\nkind: ${JSON.stringify(values.kind)}\nscope: ${JSON.stringify(values.scope)}\ntrust: "unreviewed"\nstatus: ${JSON.stringify(values.status)}\nsource_harness: ${JSON.stringify(values.sourceHarness)}\ntarget_harnesses: ${JSON.stringify(values.targetHarnesses)}\ntags: ${JSON.stringify(values.tags)}\nlinks: ${JSON.stringify(values.links)}\ncreated_at: "2026-08-17T00:10:00.000Z"\nupdated_at: "2026-08-17T00:11:00.000Z"\n---\n\n${values.body}\n`;
}

describe('ECC Collaborative Memory adapter', () => {
  it('normalizes a real ecc.memory.v1 project document into platform memory without changing its identity', () => {
    const candidate = parseEccMemoryDocument(eccDocument(), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
      sourceReference: `project:handoffs/${eccId}.md`,
    });
    expect(candidate.record).toMatchObject({
      id: eccId, organisationId: 'org-001', projectId: 'project-001',
      scope: 'project', visibility: 'project_shared', kind: 'handoff', trust: 'unreviewed',
      sourceType: 'ecc_import', sourceHarnessId: 'codex', sourceSchema: 'ecc.memory.v1',
      sourceReference: `project:handoffs/${eccId}.md`, tags: ['auth', 'migration'],
    });
    expect(candidate.record.targetHarnessIds).toEqual(['claude-code']);
    expect(candidate.linkedMemoryIds).toEqual([oldId]);
    expect(candidate.eccScope).toBe('project');
    expect(candidate.eccStatus).toBe('active');
    expect(candidate.record.sourceDocumentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('maps ECC team scope to project-shared platform context and preserves source scope evidence', () => {
    const candidate = parseEccMemoryDocument(eccDocument({ scope: 'team' }), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    });
    expect(candidate.record.scope).toBe('project');
    expect(candidate.record.visibility).toBe('project_shared');
    expect(candidate.eccScope).toBe('team');
  });

  it('maps ECC user scope to user-private platform memory and requires an owner', () => {
    expect(() => parseEccMemoryDocument(eccDocument({ scope: 'user' }), {
      createdBy: 'user-001',
    })).toThrow(/owner/i);

    const candidate = parseEccMemoryDocument(eccDocument({ scope: 'user', links: [] }), {
      ownerUserId: 'user-001', createdBy: 'user-001',
    });
    expect(candidate.record).toMatchObject({
      scope: 'user', visibility: 'user_private', ownerUserId: 'user-001',
    });
  });

  it('maps rejected/superseded ECC status into platform recall trust state', () => {
    const rejected = parseEccMemoryDocument(eccDocument({ status: 'rejected' }), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    });
    const superseded = parseEccMemoryDocument(eccDocument({ status: 'superseded' }), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    });
    expect(rejected.record.trust).toBe('rejected');
    expect(superseded.record.trust).toBe('superseded');
  });

  it('uses the inherited ECC parser and secret scanner to fail closed on malformed or secret documents', () => {
    expect(() => parseEccMemoryDocument('not-frontmatter', {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    })).toThrow(/frontmatter/i);
    const token = `sk-${'A1'.repeat(12)}`;
    expect(() => parseEccMemoryDocument(eccDocument({ body: `Imported token ${token}` }), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    })).toThrow(/secret/i);
  });
  it('classifies same-ID/same-document imports as idempotent and same-ID/different-document as conflict', () => {
    const candidate = parseEccMemoryDocument(eccDocument(), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    });
    expect(classifyEccMemoryImport(null, candidate)).toBe('new');
    expect(classifyEccMemoryImport(candidate.record, candidate)).toBe('idempotent');

    const changed = parseEccMemoryDocument(eccDocument({ body: 'Changed content.' }), {
      organisationId: 'org-001', projectId: 'project-001', createdBy: 'user-001',
    });
    expect(classifyEccMemoryImport(candidate.record, changed)).toBe('conflict');
  });

  it('materializes through the inherited ECC vault runtime under an approved task root and stays create-only', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-ecc-memory-'));
    const taskRoot = join(root, 'task');
    try {
      const record = createCollaborativeMemoryRecord({
        id: 'mem_20260817_platformmemory', organisationId: 'org-001', projectId: 'project-001',
        scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
        title: 'Platform context', content: 'Context materialized for an ECC harness.',
        createdBy: 'user-001', sourceType: 'agent', sourceHarnessId: 'codex',
        createdAt: new Date('2026-08-17T00:20:00.000Z'),
      });
      const materialized = materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot, allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'], tags: ['platform'],
        now: new Date('2026-08-17T00:21:00.000Z'),
      });
      expect(materialized.path.startsWith(taskRoot)).toBe(true);
      expect(readFileSync(materialized.path, 'utf8')).toContain('schema: "ecc.memory.v1"');
      expect(readFileSync(materialized.path, 'utf8')).toContain(record.content);
      expect(() => materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot, allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'], tags: ['platform'],
      })).toThrow(/already exists|create-only/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('enforces durable agent, session, and harness targets before ECC materialization', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-ecc-targets-'));
    try {
      const record = createCollaborativeMemoryRecord({
        id: 'mem_20260817_targeted', organisationId: 'org-001', projectId: 'project-001',
        scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
        title: 'Targeted context', content: 'Only the selected execution context may materialize this.',
        targetAgentIds: ['agent-a'], targetSessionIds: ['session-a'], targetHarnessIds: ['claude-code'],
        createdBy: 'user-001', sourceType: 'agent', createdAt: new Date('2026-08-17T00:20:00.000Z'),
      });
      expect(() => materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot: join(root, 'wrong-harness'), allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['codex'], agentId: 'agent-a', sessionId: 'session-a',
      } as never)).toThrow(/target|harness|authori[sz]ed/i);
      expect(() => materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot: join(root, 'missing-agent'), allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'], sessionId: 'session-a',
      } as never)).toThrow(/target|agent|authori[sz]ed/i);
      expect(() => materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot: join(root, 'wrong-session'), allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'], agentId: 'agent-a', sessionId: 'session-b',
      } as never)).toThrow(/target|session|authori[sz]ed/i);
      const materialized = materializeCollaborativeMemoryToEcc(record, {
        approvedRoot: root, taskRoot: join(root, 'matched'), allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'], agentId: 'agent-a', sessionId: 'session-a',
      } as never);
      expect(materialized.eccMemory.targetHarnesses).toEqual(['claude-code']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses materialization outside the approved root and refuses private memory without explicit visibility approval', () => {
    const approved = mkdtempSync(join(tmpdir(), 'platform-ecc-approved-'));
    const outside = mkdtempSync(join(tmpdir(), 'platform-ecc-outside-'));
    try {
      const shared = createCollaborativeMemoryRecord({
        id: 'mem_20260817_shared', organisationId: 'org-001', projectId: 'project-001',
        scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
        title: 'Shared', content: 'Safe shared context.', createdBy: 'user-001',
        sourceType: 'agent', createdAt: new Date('2026-08-17T00:20:00.000Z'),
      });
      expect(() => materializeCollaborativeMemoryToEcc(shared, {
        approvedRoot: approved, taskRoot: outside, allowedVisibilities: ['project_shared'],
        sourceHarness: 'codex', targetHarnesses: ['claude-code'],
      })).toThrow(/outside|root|within/i);

      const privateReview = createCollaborativeMemoryRecord({
        id: 'mem_20260817_private', organisationId: 'org-001', projectId: 'project-001',
        scope: 'review', visibility: 'reviewer_private', reviewerAssignmentId: 'assignment-001',
        kind: 'evidence', trust: 'unreviewed', title: 'Private review', content: 'Reviewer-only evidence.',
        createdBy: 'user-001', sourceType: 'review_council', createdAt: new Date('2026-08-17T00:20:00.000Z'),
      });
      expect(() => materializeCollaborativeMemoryToEcc(privateReview, {
        approvedRoot: approved, taskRoot: approved, allowedVisibilities: ['project_shared'],
        sourceHarness: 'reviewer', targetHarnesses: ['claude-code'],
      })).toThrow(/visibility|authori[sz]ed|policy/i);
    } finally {
      rmSync(approved, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
