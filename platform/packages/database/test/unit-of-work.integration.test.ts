import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuditEvent, createProject } from '@engineering-os/domain';
import { DatabaseUnitOfWork, ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('DatabaseUnitOfWork', () => {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const projects = new ProjectRepository(pool);

  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('rolls back a project when later work in the transaction fails', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Atomic Project',
      createdBy: 'user-001',
    });

    await expect(
      unitOfWork.run(async ({ projects: transactionalProjects }) => {
        await transactionalProjects.create(project);
        throw new Error('forced audit failure');
      }),
    ).rejects.toThrow('forced audit failure');

    expect(await projects.getById('org-001', project.id)).toBeNull();
  });
  it('commits a project and its audit event together', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Audited Project',
      createdBy: 'user-001',
    });
    const event = createAuditEvent({
      organisationId: 'org-001',
      projectId: project.id,
      eventType: 'project.created',
      actorType: 'user',
      actorId: 'user-001',
      subjectType: 'project',
      subjectId: project.id,
    });

    await unitOfWork.run(async ({ projects: transactionalProjects, audit }) => {
      await transactionalProjects.create(project);
      await audit.append(event);
    });

    expect(await projects.getById('org-001', project.id)).toEqual(project);
    const auditRows = await pool.query('SELECT event_type FROM audit_events WHERE project_id = $1', [project.id]);
    expect(auditRows.rows).toEqual([{ event_type: 'project.created' }]);
  });
});