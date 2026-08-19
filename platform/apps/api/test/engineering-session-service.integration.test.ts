import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCollaborativeMemoryRecord, createProject } from '@engineering-os/domain';
import {
  AuditRepository,
  CollaborativeMemoryRepository,
  DatabaseUnitOfWork,
  EngineeringSessionRepository,
  MembershipRepository,
  ProjectRepository,
  UserRepository,
} from '@engineering-os/database';
import { EngineeringSessionService } from '../src/engineering-session-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const now = new Date('2026-08-17T01:10:00.000Z');

async function seedUser(userId: string) {
  const user = {
    id: randomUUID(), userId, passwordHash: 'scrypt$test$hash', status: 'active' as const,
    createdAt: now, updatedAt: now,
  };
  await new UserRepository(pool).create(user);
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: user.id, role: 'member', createdBy: 'bootstrap', now,
  });
  return user;
}

async function setupProject() {
  const alice = await seedUser('memory.alice');
  const bob = await seedUser('memory.bob');  const project = createProject({
    organisationId: 'org-001', name: 'Parallel Agents', createdBy: alice.id,
  });
  await new ProjectRepository(pool).create(project);
  const memberships = new MembershipRepository(pool);
  for (const user of [alice, bob]) {
    await memberships.grantProject({
      organisationId: 'org-001', projectId: project.id, userId: user.id,
      role: 'engineer', createdBy: alice.id, now,
    });
  }
  const assignments = new EngineeringSessionRepository(pool);
  for (const [userId, workstreamId, taskId, agentId] of [
    [alice.id, 'payments', 'task-backend', 'agent-backend'],
    [alice.id, undefined, 'task-backend', 'agent-backend'],
    [alice.id, undefined, 'task-codex-target', 'agent-codex-target'],
    [alice.id, undefined, 'task-claude-target', 'agent-claude-target'],
    [alice.id, undefined, 'task-review-forge', 'agent-review-forge'],
    [alice.id, undefined, 'task-rebind-race', 'agent-rebind-race'],
    [alice.id, undefined, 'task-rebind-same-ts', 'agent-rebind-same-ts'],
    [alice.id, undefined, 'task-revoke-race', 'agent-revoke-race'],
    [bob.id, 'payments', 'task-test', 'agent-test'],
    [bob.id, 'payments', 'task-other', 'agent-other'],
    [bob.id, 'frontend', 'task-frontend', 'agent-frontend'],
  ] as const) {
    await assignments.grantAssignment({ organisationId: 'org-001', projectId: project.id, userId,
      ...(workstreamId === undefined ? {} : { workstreamId }), taskId, agentId, createdBy: alice.id, now });
  }
  return { alice, bob, project };
}

function service() {
  return new EngineeringSessionService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    memberships: new MembershipRepository(pool),
    users: new UserRepository(pool),
    collaborativeMemory: new CollaborativeMemoryRepository(pool),
    engineeringSessions: new EngineeringSessionRepository(pool),
  });
}

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());

describe('EngineeringSessionService', () => {
  it('rejects a caller-selected workstream/agent session without a platform assignment', async () => {
    const { alice, project } = await setupProject();
    await expect(service().startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      workstreamId: 'payments', taskId: 'task-self-asserted', agentId: 'agent-security',
      harnessId: 'codex', now,
    })).rejects.toThrow(/assignment|required|forbidden/i);
  });
  it('starts parallel OS sessions with independent agents/harnesses and durable audit', async () => {
    const { alice, bob, project } = await setupProject();
    const sessions = service();
    const backend = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend',
      harnessId: 'codex', modelRouteId: 'openai-gpt', runnerId: 'runner-a',
      environmentId: 'local', now,
    });    const tester = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: bob.id,
      workstreamId: 'payments', taskId: 'task-test', agentId: 'agent-test',
      harnessId: 'claude-code', modelRouteId: 'anthropic-sonnet', runnerId: 'runner-b',
      environmentId: 'local', now: new Date(now.getTime() + 1),
    });

    expect(backend.id).not.toBe(tester.id);
    expect(backend).toMatchObject({ agentId: 'agent-backend', harnessId: 'codex', projectId: project.id });
    expect(tester).toMatchObject({ agentId: 'agent-test', harnessId: 'claude-code', projectId: project.id });
    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    expect(audits.filter((event) => event.eventType === 'engineering.session.started')).toHaveLength(2);
  });

  it('keeps private checkpoints in the source session while sharing a targeted handoff with another agent', async () => {
    const { alice, bob, project } = await setupProject();
    const sessions = service();
    const backend = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend',
      harnessId: 'codex', environmentId: 'local', now,
    });
    const tester = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: bob.id,
      workstreamId: 'payments', taskId: 'task-test', agentId: 'agent-test',
      harnessId: 'claude-code', environmentId: 'local', now: new Date(now.getTime() + 1),
    });
    const other = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: bob.id,
      workstreamId: 'payments', taskId: 'task-other', agentId: 'agent-other',
      harnessId: 'opencode', environmentId: 'local', now: new Date(now.getTime() + 2),
    });
    const checkpoint = await sessions.recordCheckpoint({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: backend.id, title: 'Backend checkpoint',
      content: 'Payment service implementation is complete and unit tests pass.', now: new Date(now.getTime() + 3),
    });
    expect(checkpoint.visibility).toBe('session_private');
    expect(checkpoint.id).toMatch(/^mem_[a-z0-9_-]+$/);

    const handoff = await sessions.createHandoff({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sourceSessionId: backend.id, targetAgentIds: ['agent-test'], targetSessionIds: [],
      summary: 'Run integration and adversarial tests against the completed backend.',
      evidenceReferences: ['memory:' + checkpoint.id], blockers: [], now: new Date(now.getTime() + 4),
    });
    expect(handoff.handoff.targetAgentIds).toEqual(['agent-test']);
    expect(handoff.memory.kind).toBe('handoff');
    expect(handoff.memory.id).toMatch(/^mem_[a-z0-9_-]+$/);
    expect(handoff.memory.visibility).toBe('project_shared');

    const backendContext = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: backend.id, maxItems: 20, maxBytes: 20_000,
    });
    expect(backendContext.items.map((item) => item.memoryId)).toContain(checkpoint.id);

    const testerContext = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: bob.id,
      sessionId: tester.id, maxItems: 20, maxBytes: 20_000,
    });
    expect(testerContext.items.map((item) => item.memoryId)).toContain(handoff.memory.id);
    expect(testerContext.items.map((item) => item.memoryId)).not.toContain(checkpoint.id);

    const otherContext = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: bob.id,
      sessionId: other.id, maxItems: 20, maxBytes: 20_000,
    });
    expect(otherContext.items.map((item) => item.memoryId)).not.toContain(handoff.memory.id);
  });
  it('delivers an explicitly targeted handoff across workstream boundaries', async () => {
    const { alice, bob, project } = await setupProject();
    const sessions = service();
    const backend = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    const frontend = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: bob.id, workstreamId: 'frontend', taskId: 'task-frontend', agentId: 'agent-frontend',
      harnessId: 'claude-code', now: new Date(now.getTime() + 1) });
    const handoff = await sessions.createHandoff({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sourceSessionId: backend.id, targetSessionIds: [frontend.id], targetAgentIds: [],
      summary: 'Frontend must consume the completed backend contract.', evidenceReferences: [], blockers: [],
      now: new Date(now.getTime() + 2) });
    const context = await sessions.getContext({ organisationId: 'org-001', projectId: project.id,
      actorUserId: bob.id, sessionId: frontend.id, maxItems: 20, maxBytes: 20_000 });
    expect(context.items.map((item) => item.memoryId)).toContain(handoff.memory.id);
  });

  it('delivers an agent-only handoff to that agent across workstream boundaries', async () => {
    const { alice, bob, project } = await setupProject();
    const sessions = service();
    const backend = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    const frontend = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: bob.id, workstreamId: 'frontend', taskId: 'task-frontend', agentId: 'agent-frontend',
      harnessId: 'claude-code', now: new Date(now.getTime() + 1) });
    const handoff = await sessions.createHandoff({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sourceSessionId: backend.id, targetSessionIds: [], targetAgentIds: ['agent-frontend'],
      summary: 'Frontend agent must receive the backend contract across workstreams.', evidenceReferences: [], blockers: [],
      now: new Date(now.getTime() + 2) });
    const context = await sessions.getContext({ organisationId: 'org-001', projectId: project.id,
      actorUserId: bob.id, sessionId: frontend.id, maxItems: 20, maxBytes: 20_000 });
    expect(handoff.memory.visibility).toBe('project_shared');
    expect(context.items.map((item) => item.memoryId)).toContain(handoff.memory.id);
  });

  it('enforces harness-targeted memory against the current OS session harness', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const codex = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      taskId: 'task-codex-target', agentId: 'agent-codex-target', harnessId: 'codex', now,
    });
    const claude = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      taskId: 'task-claude-target', agentId: 'agent-claude-target', harnessId: 'claude-code', now,
    });
    const memory = createCollaborativeMemoryRecord({
      id: 'mem_harness_target', organisationId: 'org-001', projectId: project.id,
      scope: 'project', visibility: 'project_shared', kind: 'context', trust: 'unreviewed',
      title: 'Claude-only continuation', content: 'Use only in the Claude Code execution context.',
      targetHarnessIds: ['claude-code'], createdBy: alice.id, sourceType: 'human', createdAt: now,
    });
    await new CollaborativeMemoryRepository(pool).createMemory(memory);

    const codexContext = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id, sessionId: codex.id,
      maxItems: 20, maxBytes: 20_000,
    });
    const claudeContext = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id, sessionId: claude.id,
      maxItems: 20, maxBytes: 20_000,
    });
    expect(codexContext.items.map((item) => item.memoryId)).not.toContain(memory.id);
    expect(claudeContext.items.map((item) => item.memoryId)).toContain(memory.id);
  });

  it('does not let a session caller self-assert reviewer identity or adjudication authority', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      taskId: 'task-review-forge', agentId: 'agent-review-forge', harnessId: 'codex', now,
    });
    const memories = new CollaborativeMemoryRepository(pool);
    await expect(memories.createMemory(createCollaborativeMemoryRecord({
      id: 'mem_forged_reviewer', organisationId: 'org-001', projectId: project.id,
      scope: 'review', visibility: 'reviewer_private', reviewerAssignmentId: 'assignment-secret',
      kind: 'evidence', trust: 'unreviewed', title: 'Reviewer private', content: 'Peer finding context.',
      createdBy: alice.id, sourceType: 'review_council', createdAt: now,
    }))).rejects.toThrow(/reviewer.*assignment/i);
    await memories.createMemory(createCollaborativeMemoryRecord({
      id: 'mem_forged_adjudication', organisationId: 'org-001', projectId: project.id,
      scope: 'review', visibility: 'adjudication_shared', kind: 'evidence', trust: 'unreviewed',
      title: 'Adjudication private', content: 'Adjudication context.', createdBy: alice.id,
      sourceType: 'review_council', createdAt: now,
    }));

    await expect(sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id, sessionId: session.id,
      maxItems: 20, maxBytes: 20_000, reviewerAssignmentId: 'assignment-secret',
      reviewPhase: 'adjudicating', canAdjudicate: true,
    })).rejects.toThrow('review_context_requires_review_council_authority');
  });

  it('does not let another project member recall session-private memory by supplying the owner session id', async () => {
    const { alice, bob, project } = await setupProject();
    const sessions = service();
    const backend = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    const checkpoint = await sessions.recordCheckpoint({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sessionId: backend.id, title: 'Alice private state', content: 'Alice-only private checkpoint.',
      now: new Date(now.getTime() + 1) });
    const spoofed = await new CollaborativeMemoryRepository(pool).listProjectMemoriesForUser(
      'org-001', project.id, bob.id, { sessionId: backend.id, workstreamId: 'payments', reviewPhase: 'normal', maxCandidates: 20 });
    expect(spoofed.map((memory) => memory.id)).not.toContain(checkpoint.id);
  });

  it('continues the same OS session after runner/harness/environment replacement without losing private memory', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const original = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      workstreamId: 'payments', taskId: 'task-backend', agentId: 'agent-backend',
      harnessId: 'codex', modelRouteId: 'openai-gpt', runnerId: 'runner-old',
      environmentId: 'local', now,
    });
    const checkpoint = await sessions.recordCheckpoint({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: original.id, title: 'Before runner loss', content: 'Implementation state is durable.',
      now: new Date(now.getTime() + 1),
    });

    const continued = await sessions.continueSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: original.id, harnessId: 'claude-code', modelRouteId: 'anthropic-sonnet',
      runnerId: 'runner-new', environmentId: 'opensandbox', now: new Date(now.getTime() + 2),
    });
    expect(continued).toMatchObject({
      id: original.id, taskId: original.taskId, agentId: original.agentId,
      harnessId: 'claude-code', runnerId: 'runner-new', environmentId: 'opensandbox',
    });
    const context = await sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: original.id, maxItems: 20, maxBytes: 20_000,
    });
    expect(context.items.map((item) => item.memoryId)).toContain(checkpoint.id);
  });
  it('advances the platform session version even when the caller supplies the current timestamp', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, taskId: 'task-rebind-race', agentId: 'agent-rebind-race', harnessId: 'codex', now });
    const continued = await sessions.continueSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sessionId: session.id, harnessId: 'claude-code', runnerId: 'runner-first',
      now: session.updatedAt });
    expect(continued.updatedAt.getTime()).toBeGreaterThan(session.updatedAt.getTime());
    expect(await new EngineeringSessionRepository(pool).get('org-001', project.id, session.id)).toEqual(continued);
  });


  it('rejects execution rebind after the platform engineering assignment is revoked', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, taskId: 'task-rebind-race', agentId: 'agent-rebind-race', harnessId: 'codex', now });
    await pool.query(
      `UPDATE engineering_session_assignments SET status='revoked', updated_at=$5
       WHERE organisation_id=$1 AND project_id=$2 AND user_id=$3 AND task_id=$4 AND agent_id='agent-rebind-race'`,
      ['org-001', project.id, alice.id, 'task-rebind-race', new Date(now.getTime() + 1)],
    );
    await expect(sessions.continueSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sessionId: session.id, harnessId: 'claude-code', now: new Date(now.getTime() + 2) }))
      .rejects.toThrow(/assignment|required|forbidden/i);
  });

  it('revokes recall, checkpoint and handoff authority when the engineering assignment is revoked', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, workstreamId: 'payments', taskId: 'task-backend',
      agentId: 'agent-backend', harnessId: 'codex', now });
    await pool.query(`UPDATE engineering_session_assignments SET status='revoked', updated_at=$5
      WHERE organisation_id=$1 AND project_id=$2 AND user_id=$3 AND task_id=$4 AND agent_id='agent-backend'`,
      ['org-001', project.id, alice.id, 'task-backend', new Date(now.getTime() + 1)]);
    await expect(sessions.getContext({ organisationId:'org-001', projectId:project.id, actorUserId:alice.id,
      sessionId:session.id, maxItems:20, maxBytes:20_000 })).rejects.toThrow(/assignment|required|forbidden/i);
    await expect(sessions.recordCheckpoint({ organisationId:'org-001', projectId:project.id, actorUserId:alice.id,
      sessionId:session.id, title:'Revoked', content:'Must not persist.', now:new Date(now.getTime()+2) }))
      .rejects.toThrow(/assignment|required|forbidden/i);
    await expect(sessions.createHandoff({ organisationId:'org-001', projectId:project.id, actorUserId:alice.id,
      sourceSessionId:session.id, targetSessionIds:[], targetAgentIds:['agent-test'], summary:'Must not hand off.',
      evidenceReferences:[], blockers:[], now:new Date(now.getTime()+3) })).rejects.toThrow(/assignment|required|forbidden/i);
  });

  it('rejects execution rebind after the engineering session is no longer active', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    await pool.query(`UPDATE engineering_sessions SET status='completed', updated_at=$4
      WHERE organisation_id=$1 AND project_id=$2 AND id=$3`,
      ['org-001', project.id, session.id, new Date(now.getTime() + 1)]);
    await expect(sessions.continueSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sessionId: session.id, harnessId: 'claude-code', runnerId: 'runner-late',
      now: new Date(now.getTime() + 2) })).rejects.toThrow(/active|status/i);
    const persisted = await new EngineeringSessionRepository(pool).get('org-001', project.id, session.id);
    expect(persisted).toMatchObject({ status: 'completed', harnessId: 'codex' });
    expect(persisted?.runnerId).toBeUndefined();
  });

  it('rejects checkpoints after the source engineering session is no longer active', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    await pool.query(`UPDATE engineering_sessions SET status='completed', updated_at=$4
      WHERE organisation_id=$1 AND project_id=$2 AND id=$3`,
      ['org-001', project.id, session.id, new Date(now.getTime() + 1)]);
    await expect(sessions.recordCheckpoint({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sessionId: session.id, title: 'Late checkpoint', content: 'Must not persist.',
      now: new Date(now.getTime() + 2) })).rejects.toThrow(/active|status/i);
  });

  it('rejects handoffs after the source engineering session is no longer active', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now });
    await pool.query(`UPDATE engineering_sessions SET status='cancelled', updated_at=$4
      WHERE organisation_id=$1 AND project_id=$2 AND id=$3`,
      ['org-001', project.id, session.id, new Date(now.getTime() + 1)]);
    await expect(sessions.createHandoff({ organisationId: 'org-001', projectId: project.id,
      actorUserId: alice.id, sourceSessionId: session.id, targetSessionIds: [], targetAgentIds: ['agent-test'],
      summary: 'Late handoff', evidenceReferences: [], blockers: [], now: new Date(now.getTime() + 2) }))
      .rejects.toThrow(/active|status/i);
  });

  it('serializes checkpoint authority against a concurrent project revocation', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      taskId: 'task-revoke-race', agentId: 'agent-revoke-race', harnessId: 'codex', now,
    });
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE collaborative_memories IN ACCESS EXCLUSIVE MODE');
    try {
      const checkpoint = sessions.recordCheckpoint({ organisationId: 'org-001', projectId: project.id,
        actorUserId: alice.id, sessionId: session.id, title: 'Blocked checkpoint', content: 'Authority race proof.', now });
      let reachedInsert = false;
      for (let attempt = 0; attempt < 100 && !reachedInsert; attempt += 1) {
        const waiting = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = current_database() AND query LIKE 'INSERT INTO collaborative_memories%' AND wait_event_type = 'Lock'`);
        reachedInsert = Number(waiting.rows[0]?.count ?? 0) > 0;
        if (!reachedInsert) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(reachedInsert).toBe(true);
      let revoked = false;
      const revoke = new MembershipRepository(pool).revokeProject(
        'org-001', project.id, alice.id, new Date(now.getTime() + 1),
      ).finally(() => { revoked = true; });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(revoked).toBe(false);
      await blocker.query('COMMIT');
      await checkpoint;
      await revoke;
    } finally {
      try { await blocker.query('ROLLBACK'); } catch {}
      blocker.release();
    }
  });

  it('fails closed after project membership revocation and after account suspension', async () => {
    const { alice, project } = await setupProject();
    const sessions = service();
    const session = await sessions.startSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      taskId: 'task-backend', agentId: 'agent-backend', harnessId: 'codex', now,
    });
    await new MembershipRepository(pool).revokeProject(
      'org-001', project.id, alice.id, new Date(now.getTime() + 1),
    );
    await expect(sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: session.id, maxItems: 20, maxBytes: 20_000,
    })).rejects.toThrow('forbidden');
    await expect(sessions.continueSession({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: session.id, harnessId: 'claude-code', now: new Date(now.getTime() + 2),
    })).rejects.toThrow('forbidden');

    await new MembershipRepository(pool).grantProject({
      organisationId: 'org-001', projectId: project.id, userId: alice.id,
      role: 'engineer', createdBy: 'bootstrap', now: new Date(now.getTime() + 3),
    });
    await new UserRepository(pool).setStatus(alice.id, 'suspended', new Date(now.getTime() + 4));
    await expect(sessions.getContext({
      organisationId: 'org-001', projectId: project.id, actorUserId: alice.id,
      sessionId: session.id, maxItems: 20, maxBytes: 20_000,
    })).rejects.toThrow('forbidden');
  });
});
