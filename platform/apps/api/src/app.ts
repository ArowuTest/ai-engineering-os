import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type {
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeRepository,
  ProjectRepository,
} from '@engineering-os/database';
import {
  calculateProductCompleteness,
  changeProjectProductPartner,
  createAuditEvent,
  createConversation,
  createConversationMessage,
  createKnowledgeRecord,
  createProject,
  DomainValidationError,
  reviseKnowledgeRecord,
  type CreateKnowledgeInput,
  type CreateProjectInput,
  type KnowledgeStatus,
  type ProductPartner,
} from '@engineering-os/domain';
import type { ModelGateway } from '@engineering-os/model-gateway';

export interface AppDependencies {
  projects: ProjectRepository;
  knowledge: KnowledgeRepository;
  conversations: ConversationRepository;
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

function knowledgeId(request: FastifyRequest): string {
  const params = request.params as { knowledgeId?: unknown };
  return typeof params.knowledgeId === 'string' ? params.knowledgeId : '';
}

function projectInput(body: JsonObject, organisationId: string, userId: string): CreateProjectInput {
  const input: CreateProjectInput = {
    organisationId,
    name: stringField(body, 'name'),
    createdBy: userId,
  };
  if (typeof body.description === 'string') input.description = body.description;
  if (typeof body.preferredProductPartner === 'string') {
    input.preferredProductPartner = body.preferredProductPartner as ProductPartner;
  }
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

function knowledgeRevisionInput(body: JsonObject, userId: string) {
  const input: { title?: string; content?: string; status?: KnowledgeStatus; createdBy: string } = {
    createdBy: userId,
  };
  if (typeof body.title === 'string') input.title = body.title;
  if (typeof body.content === 'string') input.content = body.content;
  if (typeof body.status === 'string') input.status = body.status as KnowledgeStatus;
  return input;
}

async function projectOrNull(
  dependencies: AppDependencies,
  organisationId: string,
  projectId: string,
) {
  return dependencies.projects.getById(organisationId, projectId);
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
  app.get('/model-routes', async () => dependencies.modelGateway.listRoutes());


  app.post('/projects', async (request, reply) => {
    const identity = requireIdentity(request);
    const project = createProject(
      projectInput(bodyObject(request.body), identity.organisationId, identity.userId),
    );
    const conversation = createConversation({
      organisationId: identity.organisationId,
      projectId: project.id,
      createdBy: identity.userId,
    });
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId: project.id,
      eventType: 'project.created',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'project',
      subjectId: project.id,
      metadata: {
        source: 'api',
        conversationId: conversation.id,
        preferredProductPartner: project.preferredProductPartner,
      },
    });

    await dependencies.unitOfWork.run(async ({ projects, conversations, audit }) => {
      await projects.create(project);
      await conversations.create(conversation);
      await audit.append(event);
    });
    return reply.code(201).send(project);
  });

  app.get('/projects', async (request, reply) => {
    const identity = requireIdentity(request);
    const projects = await dependencies.projects.listByOrganisation(identity.organisationId);
    const summaries = await Promise.all(
      projects.map(async (project) => {
        const records = await dependencies.knowledge.listByProject(identity.organisationId, project.id);
        return { ...project, completeness: calculateProductCompleteness(records) };
      }),
    );
    return reply.send(summaries);
  });

  app.get('/projects/:id', async (request, reply) => {
    const identity = requireIdentity(request);
    const project = await projectOrNull(dependencies, identity.organisationId, routeId(request));
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(project);
  });

  app.get('/projects/:id/studio', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const conversation = await dependencies.conversations.getByProject(identity.organisationId, projectId);
    const records = await dependencies.knowledge.listByProject(identity.organisationId, projectId);
    const messages = conversation
      ? await dependencies.conversations.listMessages(identity.organisationId, projectId, conversation.id)
      : [];
    return reply.send({
      project,
      conversation,
      messages,
      knowledge: records,
      completeness: calculateProductCompleteness(records),
    });
  });

  app.patch('/projects/:id/product-partner', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const current = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!current) return reply.code(404).send({ error: 'Project not found' });

    const body = bodyObject(request.body);
    const changed = changeProjectProductPartner(
      current,
      stringField(body, 'preferredProductPartner') as ProductPartner,
    );
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId,
      eventType: 'product_partner.changed',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'project',
      subjectId: projectId,
      metadata: {
        from: current.preferredProductPartner,
        to: changed.preferredProductPartner,
      },
    });

    await dependencies.unitOfWork.run(async ({ projects, audit }) => {
      await projects.updateProductPartner(changed);
      await audit.append(event);
    });
    return reply.send(changed);
  });

  app.post('/projects/:id/messages', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const conversation = await dependencies.conversations.getByProject(identity.organisationId, projectId);
    if (!conversation) {
      return reply.code(409).send({ error: 'Product discovery conversation not initialised' });
    }

    const message = createConversationMessage({
      organisationId: identity.organisationId,
      projectId,
      conversationId: conversation.id,
      role: 'user',
      content: stringField(bodyObject(request.body), 'content'),
      createdBy: identity.userId,
    });
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId,
      eventType: 'conversation.message.appended',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'conversation_message',
      subjectId: message.id,
      metadata: { conversationId: conversation.id, role: message.role },
    });

    await dependencies.unitOfWork.run(async ({ conversations, audit }) => {
      await conversations.appendMessage(message);
      await audit.append(event);
    });
    return reply.code(201).send(message);
  });

  app.post('/projects/:id/knowledge', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
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
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(await dependencies.knowledge.listByProject(identity.organisationId, projectId));
  });

  app.patch('/projects/:id/knowledge/:knowledgeId', async (request, reply) => {
    const identity = requireIdentity(request);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const current = await dependencies.knowledge.getById(
      identity.organisationId,
      projectId,
      knowledgeId(request),
    );
    if (!current) return reply.code(404).send({ error: 'Product Knowledge not found' });

    const revised = reviseKnowledgeRecord(
      current,
      knowledgeRevisionInput(bodyObject(request.body), identity.userId),
    );
    const event = createAuditEvent({
      organisationId: identity.organisationId,
      projectId,
      eventType: 'product_knowledge.revised',
      actorType: 'user',
      actorId: identity.userId,
      subjectType: 'product_knowledge',
      subjectId: revised.id,
      metadata: {
        revision: revised.revision,
        status: revised.status,
        source: revised.source,
      },
    });

    await dependencies.unitOfWork.run(async ({ knowledge, audit }) => {
      await knowledge.addRevision(revised);
      await audit.append(event);
    });
    return reply.send(revised);
  });

  return app;
}
