import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type {
  DatabaseUnitOfWork,
  KnowledgeRepository,
  ProjectRepository,
} from '@engineering-os/database';
import {
  createAuditEvent,
  createKnowledgeRecord,
  createProject,
  DomainValidationError,
  type CreateKnowledgeInput,
  type CreateProjectInput,
  type KnowledgeStatus,
} from '@engineering-os/domain';
import type { ModelGateway } from '@engineering-os/model-gateway';

export interface AppDependencies {
  projects: ProjectRepository;
  knowledge: KnowledgeRepository;
  unitOfWork: DatabaseUnitOfWork;
  modelGateway: ModelGateway;
}

type JsonObject = Record<string, unknown>;

function bodyObject(body: unknown): JsonObject {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonObject) : {};
}
function stringField(body: JsonObject, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

function requireIdentity(request: FastifyRequest): { organisationId: string; userId: string } {
  const organisationId = request.headers['x-organisation-id'];
  const userId = request.headers['x-user-id'];
  if (typeof organisationId !== 'string' || organisationId.trim() === '') {
    throw new DomainValidationError('x-organisation-id');
  }
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainValidationError('x-user-id');
  }
  return { organisationId: organisationId.trim(), userId: userId.trim() };
}

function routeId(request: FastifyRequest): string {
  const params = request.params as { id?: unknown };
  return typeof params.id === 'string' ? params.id : '';
}

function projectInput(body: JsonObject, organisationId: string, userId: string): CreateProjectInput {
  const input: CreateProjectInput = {
    organisationId,
    name: stringField(body, 'name'),
    createdBy: userId,
  };
  if (typeof body.description === 'string') input.description = body.description;
  return input;
}
function knowledgeInput(
  body: JsonObject,
  organisationId: string,
  projectId: string,
  userId: string,
): CreateKnowledgeInput {
  const input: CreateKnowledgeInput = {
    organisationId,
    projectId,
    category: stringField(body, 'category'),
    title: stringField(body, 'title'),
    content: stringField(body, 'content'),
    source: stringField(body, 'source'),
    createdBy: userId,
  };
  if (typeof body.status === 'string') input.status = body.status as KnowledgeStatus;
  return input;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainValidationError) {
      return reply.code(400).send({ error: error.message, field: error.field });
    }
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({
    status: 'ok',
    modelRoutes: dependencies.modelGateway.listRoutes().length,
  }));
  app.post('/projects', async (request, reply) => {
    const identity = requireIdentity(request);
    const project = createProject(
      projectInput(bodyObject(request.body), identity.organisationId, identity.userId),
    );
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId: project.id,
      eventType: 'project.created',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'project',
      subjectId: project.id,
      metadata: { source: 'api' },
    });

    await dependencies.unitOfWork.run(async ({ projects, audit }) => {
      await projects.create(project);
      await audit.append(event);
    });
    return reply.code(201).send(project);
  });

  app.get('/projects/:id', async (request, reply) => {
    const identity = requireIdentity(request);
    const project = await dependencies.projects.getById(identity.organisationId, routeId(request));
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(project);
  });
  app.post('/projects/:id/knowledge', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await dependencies.projects.getById(identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const record = createKnowledgeRecord(
      knowledgeInput(bodyObject(request.body), identity.organisationId, projectId, identity.userId),
    );
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId,
      eventType: 'product_knowledge.created',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'product_knowledge',
      subjectId: record.id,
      metadata: {
        revision: record.revision,
        status: record.status,
        source: record.source,
      },
    });

    await dependencies.unitOfWork.run(async ({ knowledge, audit }) => {
      await knowledge.create(record);
      await audit.append(event);
    });
    return reply.code(201).send(record);
  });
  app.get('/projects/:id/knowledge', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await dependencies.projects.getById(identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(await dependencies.knowledge.listByProject(identity.organisationId, projectId));
  });

  return app;
}
