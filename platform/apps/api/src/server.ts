import { randomUUID } from 'node:crypto';
import {
  AIConnectionRepository,
  AIRunnerRepository,
  AuditRepository,
  ConversationRepository,
  createDatabasePool,
  DatabaseUnitOfWork,
  InvitationRepository,
  KnowledgeRepository,
  MembershipRepository,
  ProjectRepository,
  runMigrations,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import { createAuditEvent, hashPassword, normalizeUserId } from '@engineering-os/domain';
import { buildApp } from './app.js';
import { AuthService } from './auth-service.js';
import { AIConnectionService, createRepositoryRunnerAvailabilityResolver } from './ai-connection-service.js';
import { AIRunnerService } from './ai-runner-service.js';
import { productionConnectionFamilyPolicyRegistry } from './ai-connection-policy.js';
import { createConfiguredModelGateway, type ModelRuntimeEnvironment } from './model-runtime.js';

export interface RuntimeEnvironment extends ModelRuntimeEnvironment {
  DATABASE_URL?: string;
  PLATFORM_HOST?: string;
  PLATFORM_PORT?: string;
  ALLOW_DEV_IDENTITY_HEADERS?: string;
  BOOTSTRAP_ORGANISATION_ID?: string;
  BOOTSTRAP_ORGANISATION_NAME?: string;
  BOOTSTRAP_OWNER_USER_ID?: string;
  BOOTSTRAP_OWNER_PASSWORD?: string;
  DEV_BOOTSTRAP_ORGANISATION_ID?: string;
  DEV_BOOTSTRAP_ORGANISATION_NAME?: string;
  [key: string]: string | undefined;
}

export interface ServerConfig {
  host: string;
  port: number;
}

export function resolveServerConfig(environment: RuntimeEnvironment): ServerConfig {
  const host = environment.PLATFORM_HOST?.trim() || '127.0.0.1';
  const rawPort = environment.PLATFORM_PORT?.trim() || '3100';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PLATFORM_PORT must be an integer between 1 and 65535');
  }
  return { host, port };
}

function createAuthService(pool: ReturnType<typeof createDatabasePool>) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  return new AuthService({
    unitOfWork,
    users: new UserRepository(pool),
    memberships: new MembershipRepository(pool),
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit: new AuditRepository(pool),
  });
}

export function createRuntimeApp(environment: RuntimeEnvironment) {
  const pool = createDatabasePool(environment.DATABASE_URL);
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const modelGateway = createConfiguredModelGateway(environment);
  const aiRunners = new AIRunnerRepository(pool);
  const aiConnectionService = new AIConnectionService({
    unitOfWork,
    aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool),
    projects: new ProjectRepository(pool),
    sessions: new SessionRepository(pool),
    policy: productionConnectionFamilyPolicyRegistry,
    modelGateway,
    runnerAvailability: createRepositoryRunnerAvailabilityResolver(aiRunners),
  });
  const aiRunnerService = new AIRunnerService({
    unitOfWork,
    aiRunners,
    memberships: new MembershipRepository(pool),
    audit: new AuditRepository(pool),
  });
  const app = buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork,
    modelGateway,
    authService: createAuthService(pool),
    aiConnectionService,
    aiRunnerService,
    aiConnectionPolicy: productionConnectionFamilyPolicyRegistry,
    allowDevIdentityHeaders: environment.ALLOW_DEV_IDENTITY_HEADERS === 'true',
  });

  return {
    app,
    pool,
    async close(): Promise<void> {
      await app.close();
      await pool.end();
    },
  };
}

async function bootstrapOwnerIfConfigured(
  pool: ReturnType<typeof createDatabasePool>,
  environment: RuntimeEnvironment,
  organisationId: string,
): Promise<void> {
  const configuredUserId = environment.BOOTSTRAP_OWNER_USER_ID?.trim();
  const configuredPassword = environment.BOOTSTRAP_OWNER_PASSWORD;
  if (!configuredUserId && !configuredPassword) return;
  if (!configuredUserId || !configuredPassword) {
    throw new Error('BOOTSTRAP_OWNER_USER_ID and BOOTSTRAP_OWNER_PASSWORD must be provided together');
  }

  const existingMemberships = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM organisation_memberships
     WHERE organisation_id = $1 AND status = 'active'`,
    [organisationId],
  );
  if (Number(existingMemberships.rows[0]?.count ?? '0') > 0) return;

  const userId = normalizeUserId(configuredUserId);
  const passwordHash = await hashPassword(configuredPassword);
  const accountId = randomUUID();
  const now = new Date();
  const unitOfWork = new DatabaseUnitOfWork(pool);

  await unitOfWork.run(async ({ users, memberships, audit }) => {
    if (await users.getByUserId(userId)) {
      throw new Error('BOOTSTRAP_OWNER_USER_ID already exists');
    }
    await users.create({
      id: accountId,
      userId,
      passwordHash,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await memberships.grantOrganisation({
      organisationId,
      userId: accountId,
      role: 'owner',
      createdBy: 'bootstrap',
      now,
    });
    await audit.append(createAuditEvent({
      organisationId,
      eventType: 'auth.bootstrap.owner_created',
      actorType: 'system',
      actorId: 'bootstrap',
      subjectType: 'user',
      subjectId: accountId,
      metadata: { userId },
    }));
  });
}

export async function prepareRuntimeDatabase(
  pool: ReturnType<typeof createDatabasePool>,
  environment: RuntimeEnvironment,
): Promise<void> {
  await runMigrations(pool);
  const organisationId =
    environment.BOOTSTRAP_ORGANISATION_ID?.trim()
    || environment.DEV_BOOTSTRAP_ORGANISATION_ID?.trim();
  if (!organisationId) return;

  const organisationName =
    environment.BOOTSTRAP_ORGANISATION_NAME?.trim()
    || environment.DEV_BOOTSTRAP_ORGANISATION_NAME?.trim()
    || 'Development Organisation';
  await pool.query(
    `INSERT INTO organisations (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [organisationId, organisationName],
  );
  await bootstrapOwnerIfConfigured(pool, environment, organisationId);
}

export async function startServer(environment: RuntimeEnvironment = process.env) {
  const runtime = createRuntimeApp(environment);
  const config = resolveServerConfig(environment);
  try {
    await prepareRuntimeDatabase(runtime.pool, environment);
    await runtime.app.listen(config);
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
