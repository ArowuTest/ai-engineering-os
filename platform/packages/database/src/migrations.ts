import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';

const MIGRATION_LOCK = 'engineering_os_schema_migrations';
const MIGRATION_PATTERN = /^\d+_.+\.sql$/;

async function migrationNames(): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const directory = path.resolve(here, '../migrations');
  return (await readdir(directory)).filter((name) => MIGRATION_PATTERN.test(name)).sort();
}

async function migrationSql(name: string): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, '../migrations', name);
  return readFile(file, 'utf8');
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.name));

    for (const name of await migrationNames()) {
      if (applied.has(name)) continue;

      try {
        await client.query('BEGIN');
        await client.query(await migrationSql(name));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        appliedNow.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return appliedNow;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK]);
    } finally {
      client.release();
    }
  }
}
