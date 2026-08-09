import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createKnowledgeRecord,
  createProject,
  reviseKnowledgeRecord,
} from '@engineering-os/domain';
import { KnowledgeRepository, ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('KnowledgeRepository', () => {
  const projects = new ProjectRepository(pool);
  const knowledge = new KnowledgeRepository(pool);

  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => closeDatabase());

  async function seedProject() {
    const project = createProject({
      organisationId: 'org-001',
      name: 'Enterprise Streaming',
      createdBy: 'user-001',
    });
    await projects.create(project);
    return project;
  }

  it('persists canonical knowledge and enforces organisation/project scope', async () => {
    const project = await seedProject();    const record = createKnowledgeRecord({
      organisationId: 'org-001',
      projectId: project.id,
      category: 'business_rule',
      title: 'Playback entitlement',
      content: 'Playback requires an active entitlement.',
      source: 'product_discussion',
      status: 'confirmed',
      createdBy: 'user-001',
    });

    await knowledge.create(record);

    expect(await knowledge.getById('org-001', project.id, record.id)).toEqual(record);
    expect(await knowledge.getById('org-002', project.id, record.id)).toBeNull();
    expect(await knowledge.listByProject('org-002', project.id)).toEqual([]);
  });

  it('appends a revision and keeps the historical revision unchanged', async () => {
    const project = await seedProject();
    const original = createKnowledgeRecord({
      organisationId: 'org-001',
      projectId: project.id,
      category: 'business_rule',
      title: 'Playback entitlement',
      content: 'Successful payment creates entitlement.',
      source: 'product_discussion',
      createdBy: 'user-001',
    });
    await knowledge.create(original);
    const revised = reviseKnowledgeRecord(original, {
      content: 'Payment creates entitlement; playback also requires a short-lived token.',
      status: 'approved',
      createdBy: 'user-002',
    });
    await knowledge.addRevision(revised);

    expect(await knowledge.getById('org-001', project.id, original.id)).toEqual(revised);
    expect(await knowledge.listByProject('org-001', project.id)).toEqual([revised]);

    const history = await pool.query(
      `SELECT revision, content, status FROM product_knowledge
       WHERE organisation_id = $1 AND project_id = $2 AND id = $3
       ORDER BY revision`,
      ['org-001', project.id, original.id],
    );
    expect(history.rows).toEqual([
      { revision: 1, content: original.content, status: 'proposed' },
      { revision: 2, content: revised.content, status: 'approved' },
    ]);
  });
});