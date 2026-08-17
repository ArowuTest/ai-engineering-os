import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@engineering-os/domain';
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
    expect(handoff.memory.visibility).toBe('workstream_shared');

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
