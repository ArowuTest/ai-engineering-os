import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeRepository,
  ProjectRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import {
  closeDatabase,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const projects = new ProjectRepository(pool);
const knowledge = new KnowledgeRepository(pool);
const conversations = new ConversationRepository(pool);
const audit = new AuditRepository(pool);
const unitOfWork = new DatabaseUnitOfWork(pool);
const modelGateway = new ModelGateway();
const app = buildApp({ projects, knowledge, conversations, unitOfWork, modelGateway });

const headers = {
  'x-organisation-id': 'org-001',
  'x-user-id': 'user-001',
};

describe('platform API audit trail', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });
  it('records project and Product Knowledge creation in order', async () => {
    const projectResponse = await app.inject({
      method: 'POST',
      url: '/projects',
      headers,
      payload: { name: 'Enterprise Streaming' },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json();

    const knowledgeResponse = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/knowledge`,
      headers,
      payload: {
        category: 'business_rule',
        title: 'Playback entitlement',
        content: 'Playback requires entitlement.',
        source: 'product_discussion',
        status: 'confirmed',
      },
    });
    expect(knowledgeResponse.statusCode).toBe(201);
    const record = knowledgeResponse.json();

    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'project.created',
      'product_knowledge.created',
    ]);    expect(events[0]?.subjectId).toBe(project.id);
    expect(events[0]?.actorId).toBe('user-001');
    expect(events[1]?.subjectId).toBe(record.id);
    expect(events[1]?.metadata).toMatchObject({ revision: 1, status: 'confirmed' });
  });

  it('rolls back project creation when its mandatory audit insert fails', async () => {
    await pool.query(`
      CREATE FUNCTION reject_project_created_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'project.created' THEN
          RAISE EXCEPTION 'forced audit insert failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_project_created_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_project_created_audit();
    `);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers,
      payload: { name: 'Must Roll Back' },
    });
    expect(response.statusCode).toBe(500);
    const stored = await pool.query('SELECT id FROM projects WHERE name = $1', ['Must Roll Back']);
    expect(stored.rowCount).toBe(0);
  });
});
