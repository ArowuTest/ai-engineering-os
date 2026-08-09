import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';

export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test';

export const pool = new Pool({ connectionString: databaseUrl, max: 4 });

export async function resetDatabase(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationPath = path.resolve(here, '../migrations/001_initial.sql');
  const migration = await readFile(migrationPath, 'utf8');
  await pool.query(migration);
  await pool.query(
    `INSERT INTO organisations (id, name) VALUES
       ('org-001', 'Organisation One'),
       ('org-002', 'Organisation Two')`,
  );
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}