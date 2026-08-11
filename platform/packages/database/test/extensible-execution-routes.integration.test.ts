import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { closeDatabase, pool } from './database-test-harness.js';

const migrationNames = [
  '001_initial.sql',
  '002_product_studio.sql',
  '003_auth_collaboration.sql',
] as const;

async function applyLegacyMigrations(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(`
    CREATE TABLE schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const directory = path.resolve(here, '../migrations');
  for (const name of migrationNames) {
    const sql = await readFile(path.join(directory, name), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
  }

  await pool.query(`INSERT INTO organisations (id, name) VALUES ('org-001', 'Organisation One')`);
  await pool.query(`
    INSERT INTO projects (
      id, organisation_id, name, description, created_by, created_at,
      stage, preferred_product_partner, updated_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 'org-001', 'Project', NULL,
      'user-001', now(), 'discovery', 'openai', now()
    )
  `);
  await pool.query(`
    INSERT INTO conversations (
      id, organisation_id, project_id, purpose, created_by, created_at
    ) VALUES (
      '22222222-2222-4222-8222-222222222222', 'org-001',
      '11111111-1111-4111-8111-111111111111', 'product_discovery', 'user-001', now()
    )
  `);
}

describe('004_extensible_execution_routes migration', () => {
  afterAll(closeDatabase);

  it('upgrades closed provider checks without rewriting migration 002', async () => {
    await applyLegacyMigrations();

    await expect(
      pool.query(`UPDATE projects SET preferred_product_partner = 'future-provider'`),
    ).rejects.toThrow();
    await expect(
      pool.query(`
        INSERT INTO conversation_messages (
          id, organisation_id, project_id, conversation_id, role, content, provider,
          created_by, created_at
        ) VALUES (
          '33333333-3333-4333-8333-333333333333', 'org-001',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222', 'assistant', 'Future answer',
          'future-provider', 'agent-product', now()
        )
      `),
    ).rejects.toThrow();

    const first = await runMigrations(pool);
    const second = await runMigrations(pool);
    expect(first).toEqual(['004_extensible_execution_routes.sql']);
    expect(second).toEqual([]);

    await expect(
      pool.query(`UPDATE projects SET preferred_product_partner = 'future-provider.v2'`),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`UPDATE projects SET preferred_product_partner = 'auto'`),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`UPDATE projects SET preferred_product_partner = 'OpenAI'`),
    ).rejects.toThrow();

    await expect(
      pool.query(`
        INSERT INTO conversation_messages (
          id, organisation_id, project_id, conversation_id, role, content, provider,
          created_by, created_at
        ) VALUES (
          '44444444-4444-4444-8444-444444444444', 'org-001',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222', 'assistant', 'Future answer',
          'future-provider', 'agent-product', now()
        )
      `),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`
        INSERT INTO conversation_messages (
          id, organisation_id, project_id, conversation_id, role, content, provider,
          created_by, created_at
        ) VALUES (
          '55555555-5555-4555-8555-555555555555', 'org-001',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222', 'assistant', 'No provider',
          NULL, 'agent-product', now()
        )
      `),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`UPDATE conversation_messages SET provider = 'auto' WHERE provider IS NULL`),
    ).rejects.toThrow();

    const applied = await pool.query<{ name: string }>(
      `SELECT name FROM schema_migrations WHERE name = '004_extensible_execution_routes.sql'`,
    );
    expect(applied.rows).toHaveLength(1);
  });
});
