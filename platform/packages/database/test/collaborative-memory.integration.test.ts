import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentHandoff,
  createAuditEvent,
  createCollaborativeMemoryRecord,
  createEngineeringSession,
  createMemoryLink,
  createProject,
  rebindEngineeringSessionExecution,
} from '@engineering-os/domain';
import {
  CollaborativeMemoryRepository,
  DatabaseUnitOfWork,
  EngineeringSessionRepository,
  ProjectRepository,
  UserRepository,
} from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const now = new Date('2026-08-17T00:50:00.000Z');
afterAll(async () => closeDatabase());
beforeEach(async () => resetDatabase());

async function seedProject() {
  const userId = randomUUID();
  await new UserRepository(pool).create({
    id: userId, userId: `memory.${userId.slice(0, 8)}`, passwordHash: 'scrypt$test$hash',
    status: 'active', createdAt: now, updatedAt: now,
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ('org-001', $1, 'member', 'active', 'bootstrap', $2, $2)`,
    [userId, now],
  );
  const project = createProject({
    organisationId: 'org-001', name: 'Collaborative Memory', createdBy: userId,
  });
  await new ProjectRepository(pool).create(project);
  await pool.query(
    `INSERT INTO project_memberships
      (organisation_id, project_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ('org-001', $1, $2, 'engineer', 'active', 'bootstrap', $3, $3)`,
    [project.id, userId, now],
  );
  return { userId, project };
}

function projectMemory(projectId: string, userId: string, id = 'mem-001') {
  return createCollaborativeMemoryRecord({
    id, organisationId: 'org-001', projectId, scope: 'project', visibility: 'project_shared',
    kind: 'context', trust: 'unreviewed', title: 'Shared context',
    content: 'The checkout workstream uses the approved payment contract.',
    createdBy: userId, sourceType: 'human', createdAt: now,
  });
}

describe('collaborative memory migration', () => {
  it('applies migration 009 and stores no credential-shaped columns', async () => {
    const migrations = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(migrations.rows.map((row) => row.name)).toContain('009_collaborative_memory.sql');
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('collaborative_memories','engineering_sessions','agent_handoffs')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const forbidden of [
      'api_key', 'access_token', 'refresh_token', 'password', 'cookie',
      'provider_session', 'private_key', 'credential', 'secret',
    ]) expect(names).not.toContain(forbidden);
  });
});

describe('CollaborativeMemoryRepository', () => {
  it('persists project memory, scopes direct reads, and stops recall candidates after membership revocation', async () => {
    const { userId, project } = await seedProject();
    const repo = new CollaborativeMemoryRepository(pool);
    const memory = projectMemory(project.id, userId);
    await repo.createMemory(memory);

    expect(await repo.getProjectMemory('org-001', project.id, memory.id)).toEqual(memory);
    expect(await repo.getProjectMemory('org-002', project.id, memory.id)).toBeNull();
    expect(await repo.listProjectMemoriesForUser('org-001', project.id, userId)).toEqual([memory]);

    await pool.query(
      `UPDATE project_memberships SET status = 'revoked', updated_at = $4
       WHERE organisation_id = $1 AND project_id = $2 AND user_id = $3`,
      ['org-001', project.id, userId, new Date(now.getTime() + 1000)],
    );
    expect(await repo.listProjectMemoriesForUser('org-001', project.id, userId)).toEqual([]);
  });
  it('rejects session-private memory that references a nonexistent project session', async () => {
    const { userId, project } = await seedProject();
    const memory = createCollaborativeMemoryRecord({
      id: 'mem_bad_session_ref', organisationId: 'org-001', projectId: project.id,
      scope: 'session', visibility: 'session_private', kind: 'checkpoint', trust: 'unreviewed',
      title: 'Invalid session ref', content: 'Must not outlive session authority.',
      createdBy: userId, sourceType: 'agent', sourceAgentId: 'agent-backend',
      sourceSessionId: 'session-does-not-exist', createdAt: now,
    });
    await expect(new CollaborativeMemoryRepository(pool).createMemory(memory)).rejects.toThrow();
  });

  it('rejects reviewer-private memory that references a fabricated reviewer assignment', async () => {
    const { userId, project } = await seedProject();
    const memory = createCollaborativeMemoryRecord({
      id: 'mem_bad_review_ref', organisationId: 'org-001', projectId: project.id,
      scope: 'review', visibility: 'reviewer_private', kind: 'evidence', trust: 'unreviewed',
      title: 'Invalid reviewer ref', content: 'Must bind to durable review authority.',
      createdBy: userId, sourceType: 'review_council', reviewerAssignmentId: 'assignment-fabricated', createdAt: now,
    });
    await expect(new CollaborativeMemoryRepository(pool).createMemory(memory)).rejects.toThrow();
  });

  it('persists full ECC identity, source-document provenance and tags without truncation', async () => {
    const { userId, project } = await seedProject();
    const repo = new CollaborativeMemoryRepository(pool);
    const id = 'mem_20260817_' + 'a'.repeat(70);
    const memory = createCollaborativeMemoryRecord({
      ...projectMemory(project.id, userId, id), sourceType: 'ecc_import',
      sourceSchema: 'ecc.memory.v1', sourceDocumentDigest: 'c'.repeat(64),
      sourceReference: 'project:handoffs/' + id + '.md', tags: ['auth', 'handoff'],
    });
    await repo.createMemory(memory);
    expect(await repo.getProjectMemory('org-001', project.id, id)).toEqual(memory);
  });

  it('bounds context candidates in SQL and excludes other sessions before policy assembly', async () => {
    const { userId, project } = await seedProject();
    const repo = new CollaborativeMemoryRepository(pool);
    const sessions = new EngineeringSessionRepository(pool);
    const own = createEngineeringSession({ id: 'session-context-own', organisationId: 'org-001', projectId: project.id,
      workstreamId: 'payments', taskId: 'task-own', agentId: 'agent-own', createdBy: userId, createdAt: now });
    const other = createEngineeringSession({ id: 'session-context-other', organisationId: 'org-001', projectId: project.id,
      workstreamId: 'payments', taskId: 'task-other', agentId: 'agent-other', createdBy: userId, createdAt: now });
    await sessions.create(own); await sessions.create(other);
    for (let n=0; n<12; n+=1) await repo.createMemory(projectMemory(project.id,userId,`mem_ctx_${String(n).padStart(2,'0')}`));
    await repo.createMemory(createCollaborativeMemoryRecord({ id:'mem_other_private', organisationId:'org-001', projectId:project.id,
      scope:'session', visibility:'session_private', kind:'checkpoint', trust:'unreviewed', title:'Other private', content:'Must be SQL-filtered.',
      createdBy:userId, sourceType:'agent', sourceAgentId:'agent-other', sourceSessionId:other.id, createdAt:new Date(now.getTime()+1000) }));
    const candidates = await (repo as any).listProjectMemoriesForUser('org-001', project.id, userId, {
      sessionId: own.id, workstreamId:'payments', agentId:'agent-own', maxCandidates:5, reviewPhase:'normal',
    });
    expect(candidates).toHaveLength(5);
    expect(candidates.map((memory: {id:string})=>memory.id)).not.toContain('mem_other_private');
  });

  it('applies hard trust denial before the SQL candidate limit', async () => {
    const { userId, project } = await seedProject(); const repo=new CollaborativeMemoryRepository(pool);
    const live=createCollaborativeMemoryRecord({ ...projectMemory(project.id,userId,'mem_live_before_rejected'), createdAt: now });
    await repo.createMemory(live);
    for(let i=0;i<5;i+=1){ await repo.createMemory(createCollaborativeMemoryRecord({ ...projectMemory(project.id,userId,`mem_rejected_${i}`), trust:'rejected', createdAt:new Date(now.getTime()+100+i) })); }
    const candidates=await repo.listProjectMemoriesForUser('org-001',project.id,userId,{maxCandidates:5,reviewPhase:'normal'});
    expect(candidates.map((memory)=>memory.id)).toContain(live.id);
    expect(candidates.every((memory)=>memory.trust!=='rejected'&&memory.trust!=='superseded')).toBe(true);
  });

  it('recalls governed organisation-shared memory into an authorised project context', async () => {
    const { userId, project } = await seedProject(); const repo=new CollaborativeMemoryRepository(pool);
    const orgMemory=createCollaborativeMemoryRecord({ id:'mem_org_governed', organisationId:'org-001', scope:'organisation', visibility:'organisation_shared', kind:'runbook', trust:'governed', title:'Organisation runbook', content:'Approved organisation-wide engineering guidance.', createdBy:userId, sourceType:'human', createdAt:now });
    await repo.createMemory(orgMemory);
    const candidates=await repo.listProjectMemoriesForUser('org-001',project.id,userId,{maxCandidates:10,reviewPhase:'normal'});
    expect(candidates.map((memory)=>memory.id)).toContain(orgMemory.id);
  });

  it('keeps user-private memory owner-scoped and outside project reads', async () => {
    const { userId, project } = await seedProject();
    const repo = new CollaborativeMemoryRepository(pool);
    const memory = createCollaborativeMemoryRecord({
      id: 'mem-user-001', scope: 'user', visibility: 'user_private', kind: 'preference',
      trust: 'unreviewed', title: 'Personal preference', content: 'Prefer compact progress reports.',
      ownerUserId: userId, createdBy: userId, sourceType: 'human', createdAt: now,
    });
    await repo.createMemory(memory);
    expect(await repo.getUserMemory(userId, memory.id)).toEqual(memory);
    expect(await repo.getUserMemory(randomUUID(), memory.id)).toBeNull();
    expect(await repo.getProjectMemory('org-001', project.id, memory.id)).toBeNull();
  });

  it('stores explicit links and durable handoffs without cross-project lookup leakage', async () => {
    const { userId, project } = await seedProject();
    const memoryRepo = new CollaborativeMemoryRepository(pool);
    const sessionRepo = new EngineeringSessionRepository(pool);
    const first = projectMemory(project.id, userId, 'mem-001');
    const second = projectMemory(project.id, userId, 'mem-002');
    await memoryRepo.createMemory(first);
    await memoryRepo.createMemory(second);
    await memoryRepo.addLink('org-001', project.id, createMemoryLink({
      sourceMemoryId: second.id, targetMemoryId: first.id, relation: 'supersedes',
    }));
    expect(await memoryRepo.listLinks('org-001', project.id, second.id)).toEqual([
      { sourceMemoryId: 'mem-002', targetMemoryId: 'mem-001', relation: 'supersedes' },
    ]);
    expect(await memoryRepo.listProjectMemoriesForUser('org-001', project.id, userId)).toEqual([second]);
    expect(await memoryRepo.getProjectMemory('org-001', project.id, first.id)).toEqual(first);

    const session = createEngineeringSession({
      id: 'session-001', organisationId: 'org-001', projectId: project.id,
      taskId: 'task-001', agentId: 'agent-backend', createdBy: userId, createdAt: now,
    });
    await sessionRepo.create(session);
    const handoff = createAgentHandoff({
      id: 'handoff-001', organisationId: 'org-001', projectId: project.id,
      sourceSessionId: session.id, sourceAgentId: session.agentId,
      targetSessionIds: [], targetAgentIds: ['agent-test'], summary: 'Backend ready for integration tests.',
      evidenceReferences: ['memory:mem-002'], blockers: [], createdBy: userId, createdAt: now,
    });
    await memoryRepo.createHandoff(handoff);
    expect(await memoryRepo.getHandoff('org-001', project.id, handoff.id)).toEqual(handoff);
    expect(await memoryRepo.getHandoff('org-002', project.id, handoff.id)).toBeNull();
  });
});

describe('database authority hardening', () => {
  it('prevents direct memory mutation and engineering-session identity mutation', async () => {
    const { userId, project } = await seedProject();
    const memoryRepo = new CollaborativeMemoryRepository(pool);
    const sessionRepo = new EngineeringSessionRepository(pool);
    const memory = projectMemory(project.id, userId, 'mem-immutable');
    await memoryRepo.createMemory(memory);
    await expect(pool.query('UPDATE collaborative_memories SET content = $1 WHERE id = $2', ['tampered', memory.id]))
      .rejects.toThrow(/immutable|append/i);
    const session = createEngineeringSession({ id: 'session-immutable', organisationId: 'org-001', projectId: project.id, taskId: 'task-001', agentId: 'agent-backend', createdBy: userId, createdAt: now });
    await sessionRepo.create(session);
    await expect(pool.query('UPDATE engineering_sessions SET task_id = $1 WHERE id = $2', ['task-other', session.id]))
      .rejects.toThrow(/immutable|identity/i);
  });
});

describe('EngineeringSessionRepository', () => {
  it('rebinds execution references without changing platform session/task/agent identity', async () => {
    const { userId, project } = await seedProject();
    const repo = new EngineeringSessionRepository(pool);
    const session = createEngineeringSession({
      id: 'session-001', organisationId: 'org-001', projectId: project.id,
      taskId: 'task-001', agentId: 'agent-backend', harnessId: 'codex',
      modelRouteId: 'openai-gpt', runnerId: 'runner-001', environmentId: 'local',
      createdBy: userId, createdAt: now,
    });
    await repo.create(session);
    const rebound = rebindEngineeringSessionExecution(session, {
      harnessId: 'claude-code', modelRouteId: 'anthropic-sonnet', runnerId: 'runner-002',
      environmentId: 'opensandbox', updatedAt: new Date(now.getTime() + 1000),
    });
    await repo.rebindExecution(rebound, session.updatedAt);
    expect(await repo.get('org-001', project.id, session.id)).toEqual(rebound);
  });

  it('rejects a stale execution CAS after another writer advances the session version', async () => {
    const { userId, project } = await seedProject();
    const repo = new EngineeringSessionRepository(pool);
    const session = createEngineeringSession({ id:'session-cas', organisationId:'org-001', projectId:project.id,
      taskId:'task-cas', agentId:'agent-cas', harnessId:'codex', runnerId:'runner-old', createdBy:userId, createdAt:now });
    await repo.create(session);
    const winner = rebindEngineeringSessionExecution(session, {
      harnessId:'claude-code', runnerId:'runner-first', updatedAt:new Date(now.getTime()+1),
    });
    const stale = rebindEngineeringSessionExecution(session, {
      harnessId:'opencode', runnerId:'runner-second', updatedAt:new Date(now.getTime()+1),
    });
    await repo.rebindExecution(winner, session.updatedAt);
    await expect(repo.rebindExecution(stale, session.updatedAt)).rejects.toThrow('engineering session execution conflict');
    expect(await repo.get('org-001', project.id, session.id)).toEqual(winner);
  });
});
describe('Collaborative Memory unit of work', () => {
  it('rolls back memory and audit together when a later material write fails', async () => {
    const { userId, project } = await seedProject();
    const memory = projectMemory(project.id, userId, 'mem-rollback');
    const audit = createAuditEvent({
      organisationId: 'org-001', projectId: project.id, eventType: 'memory.created',
      actorType: 'user', actorId: userId, subjectType: 'collaborative_memory', subjectId: memory.id,
    });
    const unitOfWork = new DatabaseUnitOfWork(pool);

    await expect(unitOfWork.run(async ({ collaborativeMemory, audit: auditRepo }) => {
      await collaborativeMemory.createMemory(memory);
      await auditRepo.append(audit);
      await auditRepo.append(audit);
    })).rejects.toThrow();

    expect(await new CollaborativeMemoryRepository(pool)
      .getProjectMemory('org-001', project.id, memory.id)).toBeNull();
    const auditRows = await pool.query('SELECT id FROM audit_events WHERE subject_id = $1', [memory.id]);
    expect(auditRows.rows).toEqual([]);
  });
});
