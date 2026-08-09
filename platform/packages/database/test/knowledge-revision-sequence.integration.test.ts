import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createKnowledgeRecord, createProject } from '@engineering-os/domain';
import { KnowledgeRepository, ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('KnowledgeRepository revision sequence', () => {
  const projects = new ProjectRepository(pool);
  const knowledge = new KnowledgeRepository(pool);

  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('rejects a skipped revision and leaves history unchanged', async () => {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Streaming',
      createdBy: 'user-001',
    });
    await projects.create(project);
    const original = createKnowledgeRecord({
      organisationId: 'org-001',
      projectId: project.id,
      category: 'requirement',
      title: 'Playback',
      content: 'Entitlement is required.',
      source: 'product_discussion',
      createdBy: 'user-001',
    });
    await knowledge.create(original);
    const skippedRevision = {
      ...original,
      revision: 3,
      content: 'This revision must not be accepted.',
      createdBy: 'user-002',
      createdAt: new Date(),
    };

    await expect(knowledge.addRevision(skippedRevision)).rejects.toThrow('expected revision 2');

    const history = await pool.query(
      'SELECT revision FROM product_knowledge WHERE id = $1 ORDER BY revision',
      [original.id],
    );
    expect(history.rows).toEqual([{ revision: 1 }]);
  });
});