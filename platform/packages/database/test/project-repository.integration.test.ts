import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@engineering-os/domain';
import { ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('ProjectRepository', () => {
  const repository = new ProjectRepository(pool);

  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('persists and retrieves a project within its organisation boundary', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Enterprise Streaming',
      description: 'PPV and enterprise livestreaming',
      createdBy: 'user-001',
    });

    await repository.create(project);

    const stored = await repository.getById('org-001', project.id);
    expect(stored).toEqual(project);
    expect(await repository.getById('org-002', project.id)).toBeNull();
  });
});