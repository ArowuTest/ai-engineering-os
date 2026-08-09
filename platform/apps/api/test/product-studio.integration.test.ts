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
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const projects = new ProjectRepository(pool);
const knowledge = new KnowledgeRepository(pool);
const conversations = new ConversationRepository(pool);
const audit = new AuditRepository(pool);
const unitOfWork = new DatabaseUnitOfWork(pool);
const app = buildApp({ projects, knowledge, conversations, unitOfWork, modelGateway: new ModelGateway() });

const headers = { 'x-organisation-id': 'org-001', 'x-user-id': 'user-001' };

beforeEach(resetDatabase);
afterAll(async () => { await app.close(); await closeDatabase(); });

async function createStudioProject() {
  const response = await app.inject({
    method: 'POST', url: '/projects', headers,
    payload: { name: 'AI Studio', description: 'Product discovery', preferredProductPartner: 'google' },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe('Product Studio API', () => {
  it('creates a discovery conversation and exposes dashboard completeness', async () => {
    const project = await createStudioProject();

    const dashboard = await app.inject({ method: 'GET', url: '/projects', headers });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()[0]).toMatchObject({
      id: project.id,
      stage: 'discovery',
      preferredProductPartner: 'google',
      completeness: { percentage: 0 },
    });

    const studio = await app.inject({ method: 'GET', url: `/projects/${project.id}/studio`, headers });
    expect(studio.statusCode).toBe(200);
    expect(studio.json().conversation.purpose).toBe('product_discovery');
    expect(studio.json().messages).toEqual([]);
    expect(studio.json().completeness.missingCategories).toContain('vision');
  });

  it('appends a durable user discovery message', async () => {
    const project = await createStudioProject();
    const sent = await app.inject({
      method: 'POST', url: `/projects/${project.id}/messages`, headers,
      payload: { content: 'I want an enterprise livestream platform.' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().role).toBe('user');

    const studio = await app.inject({ method: 'GET', url: `/projects/${project.id}/studio`, headers });
    expect(studio.json().messages).toHaveLength(1);
    expect(studio.json().messages[0].content).toContain('enterprise livestream');
  });

  it('changes Product Partner without losing project state', async () => {
    const project = await createStudioProject();
    const changed = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/product-partner`, headers,
      payload: { preferredProductPartner: 'anthropic' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().preferredProductPartner).toBe('anthropic');

    const studio = await app.inject({ method: 'GET', url: `/projects/${project.id}/studio`, headers });
    expect(studio.json().project.name).toBe('AI Studio');
    expect(studio.json().project.preferredProductPartner).toBe('anthropic');
    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toContain('product_partner.changed');
  });

  it('revises Product Knowledge and updates completeness from the latest revision', async () => {
    const project = await createStudioProject();
    const created = await app.inject({
      method: 'POST', url: `/projects/${project.id}/knowledge`, headers,
      payload: { category: 'vision', title: 'Vision', content: 'Initial vision', source: 'product_discussion' },
    });
    const record = created.json();

    const revised = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/knowledge/${record.id}`, headers,
      payload: { status: 'confirmed', content: 'Confirmed product vision' },
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ revision: 2, status: 'confirmed', content: 'Confirmed product vision' });

    const studio = await app.inject({ method: 'GET', url: `/projects/${project.id}/studio`, headers });
    expect(studio.json().completeness.percentage).toBe(8);
    expect(studio.json().knowledge[0].revision).toBe(2);
  });
});
