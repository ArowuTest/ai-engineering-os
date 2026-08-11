import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type {
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeCandidateRepository,
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
  requireOrganisationRole,
  requireProjectRole,
  type CreateKnowledgeInput,
  type CreateProjectInput,
  type KnowledgeStatus,
  type ProductPartner,
  type ProjectRole,
} from '@engineering-os/domain';
import { NoEligibleRouteError, ProviderExecutionError, type ModelGateway } from '@engineering-os/model-gateway';
import { AuthService, AuthServiceError } from './auth-service.js';
import { executeProductPartnerTurn } from './product-partner-turn-service.js';
import {
  acceptCandidate,
  KnowledgeCandidateServiceError,
  rejectCandidate,
  retryExtractionRun,
} from './knowledge-candidate-service.js';

export interface AppDependencies {
  projects: ProjectRepository;
  knowledge: KnowledgeRepository;
  conversations: ConversationRepository;
  knowledgeCandidates?: KnowledgeCandidateRepository;
  unitOfWork: DatabaseUnitOfWork;
  modelGateway: ModelGateway;
  authService?: AuthService;
  allowDevIdentityHeaders?: boolean;
}

type JsonObject = Record<string, unknown>;

function bodyObject(body: unknown): JsonObject {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonObject) : {};
}

function stringField(body: JsonObject, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

class RequestAuthError extends Error {
  constructor(readonly statusCode: 401 | 403, message: string) {
    super(message);
    this.name = 'RequestAuthError';
  }
}

interface RequestIdentity {
  organisationId: string;
  userId: string;
  authenticated: boolean;
  token?: string;
  organisationRole?: 'owner' | 'admin' | 'member';
  projectRole?: ProjectRole | null;
}

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function requireOrganisationId(request: FastifyRequest): string {
  const value = request.headers['x-organisation-id'];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainValidationError('x-organisation-id');
  }
  return value.trim();
}

async function resolveIdentity(
  request: FastifyRequest,
  dependencies: AppDependencies,
): Promise<RequestIdentity> {
  const organisationId = requireOrganisationId(request);
  if (dependencies.authService) {
    const token = bearerToken(request);
    if (!token) throw new RequestAuthError(401, 'Authentication required');
    const params = request.params as { id?: unknown };
    const projectId = typeof params.id === 'string' ? params.id : null;
    if (projectId) {
      const projectIdentity = await dependencies.authService.authorizeProject(token, organisationId, projectId);
      if (!projectIdentity) {
        const session = await dependencies.authService.resolveSession(token);
        if (!session) throw new RequestAuthError(401, 'Invalid or expired session');
        throw new RequestAuthError(403, 'Project access denied');
      }
      return {
        organisationId,
        userId: projectIdentity.accountId,
        authenticated: true,
        token,
        organisationRole: projectIdentity.organisationRole,
        projectRole: projectIdentity.projectRole,
      };
    }
    const identity = await dependencies.authService.resolveOrganisation(token, organisationId);
    if (!identity) {
      const session = await dependencies.authService.resolveSession(token);
      if (!session) throw new RequestAuthError(401, 'Invalid or expired session');
      throw new RequestAuthError(403, 'Organisation access denied');
    }
    return { organisationId, userId: identity.accountId, authenticated: true, token, organisationRole: identity.organisationRole };
  }

  if (dependencies.allowDevIdentityHeaders === false) {
    throw new RequestAuthError(401, 'Authentication required');
  }
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainValidationError('x-user-id');
  }
  return { organisationId, userId: userId.trim(), authenticated: false };
}

function requireProductContributor(identity: RequestIdentity): void {
  if (!identity.authenticated) return;
  if (identity.projectRole !== 'product_owner' && identity.projectRole !== 'contributor') {
    throw new RequestAuthError(403, 'Product write access denied');
  }
}

function requireProductOwner(identity: RequestIdentity): void {
  if (!identity.authenticated) return;
  if (identity.projectRole !== 'product_owner') {
    throw new RequestAuthError(403, 'Product Owner access required');
  }
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

function requireAuthService(dependencies: AppDependencies): AuthService {
  if (!dependencies.authService) {
    throw new RequestAuthError(401, 'Authentication is not configured');
  }
  return dependencies.authService;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RequestAuthError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof AuthServiceError) {
      const status = error.code === 'invalid_credentials' ? 401
        : error.code === 'forbidden' || error.code === 'account_suspended' ? 403
        : error.code === 'user_id_taken' ? 409
        : 410;
      return reply.code(status).send({ error: error.code });
    }
    if (error instanceof DomainValidationError) {
      return reply.code(400).send({ error: error.message, field: error.field });
    }
    if (error instanceof NoEligibleRouteError) {
      return reply.code(503).send({ error: 'No live Product Partner is configured' });
    }
    if (error instanceof ProviderExecutionError) {
      return reply.code(502).send({ error: 'Live Product Partner execution failed' });
    }
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({
    status: 'ok',
    modelRoutes: dependencies.modelGateway.listRoutes().length,
  }));
  app.get('/model-routes', async () => dependencies.modelGateway.listRoutes());

  app.post('/auth/login', async (request, reply) => {
    const body = bodyObject(request.body);
    const result = await requireAuthService(dependencies).login({
      userId: stringField(body, 'userId'),
      password: stringField(body, 'password'),
    });
    return reply.send(result);
  });

  app.post('/auth/redeem', async (request, reply) => {
    const body = bodyObject(request.body);
    const result = await requireAuthService(dependencies).redeemInvitation({
      key: stringField(body, 'key'),
      userId: stringField(body, 'userId'),
      password: stringField(body, 'password'),
    });
    return reply.code(201).send(result);
  });

  app.get('/auth/me', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) throw new RequestAuthError(401, 'Authentication required');
    const identity = await requireAuthService(dependencies).resolveSession(token);
    if (!identity) throw new RequestAuthError(401, 'Invalid or expired session');
    return reply.send(identity);
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) throw new RequestAuthError(401, 'Authentication required');
    await requireAuthService(dependencies).logout(token);
    return reply.code(204).send();
  });

  app.post('/auth/invitations', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const body = bodyObject(request.body);
    const rawGrants = Array.isArray(body.projectGrants) ? body.projectGrants : [];
    const projectGrants = rawGrants.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new DomainValidationError('projectGrants');
      }
      const item = raw as JsonObject;
      return {
        projectId: stringField(item, 'projectId'),
        role: requireProjectRole(item.role),
      };
    });
    const ttl = body.ttlMinutes;
    const result = await requireAuthService(dependencies).createInvitation({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
      organisationRole: requireOrganisationRole(body.organisationRole),
      projectGrants,
      ...(typeof ttl === 'number' ? { ttlMinutes: ttl } : {}),
    });
    return reply.code(201).send(result);
  });

  app.get('/admin/users', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const people = await requireAuthService(dependencies).listPeople({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
    });
    return reply.send(people);
  });

  app.patch('/admin/users/:userId', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const params = request.params as { userId?: unknown };
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    const status = stringField(bodyObject(request.body), 'status');
    if (status !== 'active' && status !== 'suspended') throw new DomainValidationError('status');
    await requireAuthService(dependencies).setUserStatus({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
      targetUserId,
      status,
    });
    return reply.send({ status });
  });

  app.delete('/admin/users/:userId/organisation-access', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const params = request.params as { userId?: unknown };
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    await requireAuthService(dependencies).revokeOrganisationAccess({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
      targetUserId,
    });
    return reply.code(204).send();
  });

  app.get('/admin/invitation-policy', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    return reply.send(await requireAuthService(dependencies).getInvitationPolicy({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
    }));
  });

  app.patch('/admin/invitation-policy', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const ttlMinutes = bodyObject(request.body).ttlMinutes;
    if (typeof ttlMinutes !== 'number') throw new DomainValidationError('ttlMinutes');
    await requireAuthService(dependencies).setInvitationPolicy({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
      ttlMinutes,
    });
    return reply.send({ ttlMinutes });
  });

  app.get('/admin/invitations', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    return reply.send(await requireAuthService(dependencies).listInvitations({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
    }));
  });

  app.delete('/auth/invitations/:invitationId', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const params = request.params as { invitationId?: unknown };
    const invitationId = typeof params.invitationId === 'string' ? params.invitationId : '';
    await requireAuthService(dependencies).cancelInvitation({
      organisationId: identity.organisationId,
      actorUserId: identity.userId,
      invitationId,
    });
    return reply.code(204).send();
  });

  app.put('/projects/:id/members/:userId', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const params = request.params as { id?: unknown; userId?: unknown };
    const projectId = typeof params.id === 'string' ? params.id : '';
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    const role = requireProjectRole(bodyObject(request.body).role);
    await requireAuthService(dependencies).grantProjectAccess({
      organisationId: identity.organisationId,
      projectId,
      actorUserId: identity.userId,
      targetUserId,
      role,
    });
    return reply.send({ projectId, userId: targetUserId, role });
  });

  app.delete('/projects/:id/members/:userId', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const params = request.params as { id?: unknown; userId?: unknown };
    const projectId = typeof params.id === 'string' ? params.id : '';
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    await requireAuthService(dependencies).revokeProjectAccess({
      organisationId: identity.organisationId,
      projectId,
      actorUserId: identity.userId,
      targetUserId,
    });
    return reply.code(204).send();
  });

  app.post('/projects', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
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

    await dependencies.unitOfWork.run(async ({ projects, conversations, memberships, audit }) => {
      await projects.create(project);
      await conversations.create(conversation);
      if (identity.authenticated) {
        await memberships.grantProject({
          organisationId: identity.organisationId,
          projectId: project.id,
          userId: identity.userId,
          role: 'product_owner',
          createdBy: identity.userId,
          now: project.createdAt,
        });
      }
      await audit.append(event);
    });
    return reply.code(201).send(project);
  });

  app.get('/projects', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    let projects = await dependencies.projects.listByOrganisation(identity.organisationId);
    if (dependencies.authService && identity.token) {
      const scope = await dependencies.authService.getProjectAccessScope(identity.token, identity.organisationId);
      if (!scope) throw new RequestAuthError(403, 'Organisation access denied');
      if (!scope.allProjects) {
        const allowed = new Set(scope.projectIds);
        projects = projects.filter((project) => allowed.has(project.id));
      }
    }
    const summaries = await Promise.all(
      projects.map(async (project) => {
        const records = await dependencies.knowledge.listByProject(identity.organisationId, project.id);
        return { ...project, completeness: calculateProductCompleteness(records) };
      }),
    );
    return reply.send(summaries);
  });

  app.get('/projects/:id', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const project = await projectOrNull(dependencies, identity.organisationId, routeId(request));
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(project);
  });

  app.get('/projects/:id/studio', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
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
    const identity = await resolveIdentity(request, dependencies);
    requireProductContributor(identity);
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

  app.post('/projects/:id/product-partner-turn', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductContributor(identity);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const conversation = await dependencies.conversations.getByProject(
      identity.organisationId,
      projectId,
    );
    if (!conversation) {
      return reply.code(409).send({ error: 'Product discovery conversation not initialised' });
    }

    const history = await dependencies.conversations.listMessages(
      identity.organisationId,
      projectId,
      conversation.id,
    );
    const records = await dependencies.knowledge.listByProject(identity.organisationId, projectId);

    const result = await executeProductPartnerTurn({
      organisationId: identity.organisationId,
      projectId,
      userId: identity.userId,
      userContent: stringField(bodyObject(request.body), 'content'),
      project,
      conversation,
      history,
      knowledge: records,
      modelGateway: dependencies.modelGateway,
      unitOfWork: dependencies.unitOfWork,
    });

    return reply.code(201).send(result);
  });
  app.post('/projects/:id/messages', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductContributor(identity);
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
    const identity = await resolveIdentity(request, dependencies);
    requireProductContributor(identity);
    const body = bodyObject(request.body);
    if (identity.authenticated && identity.projectRole === 'contributor') {
      const requestedStatus = typeof body.status === 'string' ? body.status : 'proposed';
      if (requestedStatus !== 'proposed') {
        throw new RequestAuthError(403, 'Contributors may only propose Product Knowledge');
      }
    }
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const record = createKnowledgeRecord(
      knowledgeInput(body, identity.organisationId, projectId, identity.userId),
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
    const identity = await resolveIdentity(request, dependencies);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(await dependencies.knowledge.listByProject(identity.organisationId, projectId));
  });

  app.patch('/projects/:id/knowledge/:knowledgeId', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductOwner(identity);
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

  app.get('/projects/:id/knowledge-candidates', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const query = request.query as { status?: unknown };
    const status = typeof query.status === 'string' ? query.status : undefined;
    const rows = await dependencies.unitOfWork.run(async ({ knowledgeCandidates }) =>
      knowledgeCandidates.listByProject(
        identity.organisationId,
        projectId,
        status === 'pending' || status === 'accepted' || status === 'rejected' ? status : undefined,
      ),
    );
    return reply.send(rows);
  });

  app.post('/projects/:id/knowledge-candidates/:candidateId/accept', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductOwner(identity);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const params = request.params as { candidateId?: unknown };
    const candidateId = typeof params.candidateId === 'string' ? params.candidateId : '';
    const body = bodyObject(request.body);
    const acceptInput: Parameters<typeof acceptCandidate>[1] = {
      organisationId: identity.organisationId,
      projectId,
      candidateId,
      reviewerId: identity.userId,
    };
    if (typeof body.category === 'string') acceptInput.category = body.category;
    if (typeof body.title === 'string') acceptInput.title = body.title;
    if (typeof body.content === 'string') acceptInput.content = body.content;
    try {
      const result = await acceptCandidate(dependencies.unitOfWork, acceptInput);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof KnowledgeCandidateServiceError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/projects/:id/knowledge-candidates/:candidateId/reject', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductOwner(identity);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const params = request.params as { candidateId?: unknown };
    const candidateId = typeof params.candidateId === 'string' ? params.candidateId : '';
    const body = bodyObject(request.body);
    const rejectInput: Parameters<typeof rejectCandidate>[1] = {
      organisationId: identity.organisationId,
      projectId,
      candidateId,
      reviewerId: identity.userId,
    };
    if (typeof body.reason === 'string') rejectInput.reason = body.reason;
    try {
      const result = await rejectCandidate(dependencies.unitOfWork, rejectInput);
      return reply.send(result);
    } catch (error) {
      if (error instanceof KnowledgeCandidateServiceError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/projects/:id/extraction-runs/:runId/retry', async (request, reply) => {
    const identity = await resolveIdentity(request, dependencies);
    requireProductOwner(identity);
    const projectId = routeId(request);
    const project = await projectOrNull(dependencies, identity.organisationId, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const params = request.params as { runId?: unknown };
    const runId = typeof params.runId === 'string' ? params.runId : '';
    const canonical = await dependencies.knowledge.listByProject(identity.organisationId, projectId);
    // The retry service reads the original run outside its write UoW. Prefer an explicit
    // top-level dependency; otherwise fall back to a UoW-scoped read adapter.
    const candidatesRepo = dependencies.knowledgeCandidates
      ?? new UoWScopedKnowledgeCandidatesReadonly(dependencies.unitOfWork);
    try {
      const result = await retryExtractionRun(dependencies.unitOfWork, {
        organisationId: identity.organisationId,
        projectId,
        runId,
        requestedBy: identity.userId,
        project,
        knowledge: canonical,
        modelGateway: dependencies.modelGateway,
        conversations: dependencies.conversations,
        candidates: candidatesRepo as KnowledgeCandidateRepository,
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof KnowledgeCandidateServiceError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  return app;
}

// Minimal adapter to satisfy the retry service's `getRunById` need without requiring callers to
// wire a KnowledgeCandidateRepository. Implements only the surface the service actually calls
// outside the UoW.
class UoWScopedKnowledgeCandidatesReadonly {
  constructor(private readonly unitOfWork: DatabaseUnitOfWork) {}
  async getRunById(organisationId: string, projectId: string, runId: string) {
    return this.unitOfWork.run(async ({ knowledgeCandidates }) =>
      knowledgeCandidates.getRunById(organisationId, projectId, runId),
    );
  }
}
