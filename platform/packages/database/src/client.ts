import { Pool } from 'pg';

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL is required');
  }
  return new Pool({ connectionString: databaseUrl });
}