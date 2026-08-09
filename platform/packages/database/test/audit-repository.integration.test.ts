import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuditEvent, createProject } from '@engineering-os/domain';
import { AuditRepository, ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('AuditRepository', () => {
  const projects = new ProjectRepository(pool);
  const audit = new AuditRepository(pool);

  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('appends project audit events in deterministic insertion order', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Streaming',
      createdBy: 'user-001',
    });
    await projects.create(project);

    const first = createAuditEvent({
      organisationId: 'org-001',
      projectId: project.id,
      eventType: 'project.created',
      actorType: 'user',
      actorId: 'user-001',
      subjectType: 'project',
      subjectId: project.id,
    });
    const second = createAuditEvent({      organisationId: 'org-001',
      projectId: project.id,
      eventType: 'product_knowledge.created',
      actorType: 'user',
      actorId: 'user-001',
      subjectType: 'product_knowledge',
      subjectId: '22222222-2222-4222-8222-222222222222',
    });
    second.occurredAt = first.occurredAt;

    await audit.append(first);
    await audit.append(second);

    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'project.created',
      'product_knowledge.created',
    ]);
  });

  it('rejects direct mutation or deletion of persisted audit history', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Streaming',
      createdBy: 'user-001',
    });
    await projects.create(project);
    const event = createAuditEvent({
      organisationId: 'org-001',
      projectId: project.id,
      eventType: 'project.created',      actorType: 'user',
      actorId: 'user-001',
      subjectType: 'project',
      subjectId: project.id,
    });
    await audit.append(event);

    await expect(
      pool.query(`UPDATE audit_events SET event_type = 'tampered' WHERE id = $1`, [event.id]),
    ).rejects.toThrow('append-only');
    await expect(pool.query('DELETE FROM audit_events WHERE id = $1', [event.id])).rejects.toThrow(
      'append-only',
    );
  });
});
