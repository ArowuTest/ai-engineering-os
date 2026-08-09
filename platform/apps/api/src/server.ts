import {
  ConversationRepository,
  createDatabasePool,
  DatabaseUnitOfWork,
  KnowledgeRepository,
  ProjectRepository,
  runMigrations,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { buildApp } from './app.js';

export interface RuntimeEnvironment {
  DATABASE_URL?: string;
  PLATFORM_HOST?: string;
  PLATFORM_PORT?: string;
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

export function createRuntimeApp(environment: RuntimeEnvironment) {
  const pool = createDatabasePool(environment.DATABASE_URL);
  const app = buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork: new DatabaseUnitOfWork(pool),
    modelGateway: new ModelGateway(),
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

export async function prepareRuntimeDatabase(
  pool: ReturnType<typeof createDatabasePool>,
  environment: RuntimeEnvironment,
): Promise<void> {
  await runMigrations(pool);
  const organisationId = environment.DEV_BOOTSTRAP_ORGANISATION_ID?.trim();
  if (!organisationId) return;

  const organisationName =
    environment.DEV_BOOTSTRAP_ORGANISATION_NAME?.trim() || 'Development Organisation';
  await pool.query(
    `INSERT INTO organisations (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [organisationId, organisationName],
  );
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
