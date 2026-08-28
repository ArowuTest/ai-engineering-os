import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIConnectionRepository,
  AIConnectionSecretRepository,
  AIDispatchRepository,
  AIRunnerRepository,
  AssuranceRepository,
  AuditRepository,
  ConversationRepository,
  CapabilityEstateRepository,
  createDatabasePool,
  DatabaseUnitOfWork,
  InvitationRepository,
  KnowledgeRepository,
  MembershipRepository,
  PlatformMembershipRepository,
  ProjectRepository,
  runMigrations,
  SessionRepository,
  StudioInteractionArtifactRepository,
  UserRepository,
} from '@engineering-os/database';
import { createAuditEvent, hashPassword, normalizeUserId } from '@engineering-os/domain';
import { discoverEccCapabilityInventory } from '@engineering-os/ecc-adapter';
import { buildApp } from './app.js';
import { AuthService } from './auth-service.js';
import { AIConnectionService, createRepositoryRunnerAvailabilityResolver } from './ai-connection-service.js';
import { AIRunnerService } from './ai-runner-service.js';
import { AIDispatchService } from './ai-dispatch-service.js';
import { productionConnectionFamilyPolicyRegistry } from './ai-connection-policy.js';
import {
  createConfiguredModelGateway,
  createConfiguredStudioArtifactSemanticNormalizer,
  type ModelRuntimeEnvironment,
} from './model-runtime.js';
import { createLocalObjectStorageProvider } from '@engineering-os/object-storage';
import { CapabilityEstateService } from './capability-estate-service.js';
import { RequirementsAssuranceService } from './requirements-assurance-service.js';
import {
  createConfiguredAIConnectionProviderAdapters,
  createConfiguredAIConnectionSecretProtector,
} from './ai-connection-runtime.js';
import { createRepositoryAIConnectionCredentialResolver } from './ai-connection-secret-protector.js';
import { createConnectionModelRouteCatalogue } from './connection-model-route-catalogue.js';

export interface RuntimeEnvironment extends ModelRuntimeEnvironment {
  DATABASE_URL?: string;
  ECC_REPOSITORY_ROOT?: string;
  STUDIO_OBJECT_STORAGE_ROOT?: string;
  PLATFORM_HOST?: string;
  PLATFORM_PORT?: string;
  ALLOW_DEV_IDENTITY_HEADERS?: string;
  AIOS_CONNECTION_SECRET_MASTER_KEY?: string;
  AIOS_CONNECTION_SECRET_KEY_VERSION?: string;
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
    platformMemberships: new PlatformMembershipRepository(pool),
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit: new AuditRepository(pool),
  });
}

export function createRuntimeApp(environment: RuntimeEnvironment) {
  const pool = createDatabasePool(environment.DATABASE_URL);
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const modelGateway = createConfiguredModelGateway(environment);
  const studioArtifactSemanticNormalizer = createConfiguredStudioArtifactSemanticNormalizer(environment);
  const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
  const eccRepositoryRoot = environment.ECC_REPOSITORY_ROOT?.trim()
    ? resolve(environment.ECC_REPOSITORY_ROOT.trim())
    : defaultRepositoryRoot;
  const objectStorageRoot = environment.STUDIO_OBJECT_STORAGE_ROOT?.trim()
    ? resolve(environment.STUDIO_OBJECT_STORAGE_ROOT.trim())
    : resolve(defaultRepositoryRoot, '.aios-data', 'object-storage');
  const objectStorage = createLocalObjectStorageProvider({ rootPath: objectStorageRoot });
  const aiRunners = new AIRunnerRepository(pool);
  const aiConnections = new AIConnectionRepository(pool);
  const aiConnectionSecrets = new AIConnectionSecretRepository(pool);
  const memberships = new MembershipRepository(pool);
  const platformMemberships = new PlatformMembershipRepository(pool);
  const projects = new ProjectRepository(pool);
  const sessions = new SessionRepository(pool);
  const capabilities = new CapabilityEstateRepository(pool);
  const providerAdapters = createConfiguredAIConnectionProviderAdapters(environment);
  const credentialProtector = createConfiguredAIConnectionSecretProtector(environment);
  const credentialResolver = credentialProtector
    ? createRepositoryAIConnectionCredentialResolver({ secrets: aiConnectionSecrets, protector: credentialProtector })
    : undefined;
  const connectionModelRoutes = createConnectionModelRouteCatalogue({
    aiConnections,
    policy: productionConnectionFamilyPolicyRegistry,
  });
  const capabilityEstateService = new CapabilityEstateService({
    unitOfWork,
    capabilities,
    memberships,
    platformMemberships,
    projects,
    modelGateway,
    connectionModelRoutes,
    eccCapabilityDiscovery: () => discoverEccCapabilityInventory(eccRepositoryRoot),
  });
  const requirementsAssuranceService = new RequirementsAssuranceService({
    unitOfWork,
    projects,
    conversations: new ConversationRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    assurance: new AssuranceRepository(pool),
    capabilityEstateService,
    modelGateway,
  });
  const aiConnectionService = new AIConnectionService({
    unitOfWork,
    aiConnections,
    memberships,
    projects,
    sessions,
    policy: productionConnectionFamilyPolicyRegistry,
    modelGateway,
    modelRouteEligibility: capabilityEstateService,
    runnerAvailability: createRepositoryRunnerAvailabilityResolver(aiRunners),
    providerAdapters,
    ...(credentialProtector && credentialResolver ? { credentialProtector, credentialResolver } : {}),
  });
  const aiRunnerService = new AIRunnerService({
    unitOfWork,
    aiRunners,
    memberships: new MembershipRepository(pool),
    audit: new AuditRepository(pool),
  });
  const aiDispatchService = new AIDispatchService({
    runnerService: aiRunnerService,
    aiRunners,
    memberships: new MembershipRepository(pool),
    dispatches: new AIDispatchRepository(pool),
  });
  const app = buildApp({
    projects,
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork,
    modelGateway,
    authService: createAuthService(pool),
    studioInteractionArtifacts: new StudioInteractionArtifactRepository(pool),
    objectStorage,
    capabilityEstateService,
    requirementsAssuranceService,
    ...(studioArtifactSemanticNormalizer === undefined
      ? {}
      : { studioArtifactSemanticNormalizer }),
    aiConnectionService,
    aiRunnerService,
    aiDispatchService,
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
