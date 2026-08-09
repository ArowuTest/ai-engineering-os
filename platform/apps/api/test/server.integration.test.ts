import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
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
const unitOfWork = new DatabaseUnitOfWork(pool);
const modelGateway = new ModelGateway();
const app = buildApp({ projects, knowledge, conversations, unitOfWork, modelGateway });

const identityHeaders = {
  'x-organisation-id': 'org-001',
  'x-user-id': 'user-001',
};

describe('platform API', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });
  it('reports health and configured model route count', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', modelRoutes: 0 });
  });

  it('creates and retrieves a project only inside the caller organisation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: identityHeaders,
      payload: { name: 'Enterprise Streaming', description: 'PPV platform' },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json();
    expect(project.organisationId).toBe('org-001');
    expect(project.name).toBe('Enterprise Streaming');

    const visible = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: identityHeaders,
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().id).toBe(project.id);

    const hidden = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: { ...identityHeaders, 'x-organisation-id': 'org-002' },
    });
    expect(hidden.statusCode).toBe(404);
  });
  it('creates and lists canonical Product Knowledge for a project', async () => {
    const createdProject = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: identityHeaders,
      payload: { name: 'Enterprise Streaming' },
    });
    const project = createdProject.json();

    const createdKnowledge = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/knowledge`,
      headers: identityHeaders,
      payload: {
        category: 'business_rule',
        title: 'Playback entitlement',
        content: 'Playback requires an active entitlement.',
        source: 'product_discussion',
        status: 'confirmed',
      },
    });
    expect(createdKnowledge.statusCode).toBe(201);
    expect(createdKnowledge.json().status).toBe('confirmed');

    const listed = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/knowledge`,
      headers: identityHeaders,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
  });
  it('rejects knowledge writes against another organisation project', async () => {
    const createdProject = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: identityHeaders,
      payload: { name: 'Enterprise Streaming' },
    });
    const project = createdProject.json();

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/knowledge`,
      headers: { ...identityHeaders, 'x-organisation-id': 'org-002' },
      payload: {
        category: 'business_rule',
        title: 'Foreign write',
        content: 'Must not be stored.',
        source: 'test',
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 for invalid project input instead of leaking an internal error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: identityHeaders,
      payload: { name: '   ' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('name');
  });
  it('exposes safe configured model route metadata', async () => {
    const response = await app.inject({ method: 'GET', url: '/model-routes' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
