import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { closeDatabase, pool } from './database-test-harness.js';

describe('runMigrations', () => {
  afterAll(closeDatabase);

  it('applies every migration once and can safely run again', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const first = await runMigrations(pool);
    const second = await runMigrations(pool);

    expect(first).toEqual([
      '001_initial.sql',
      '002_product_studio.sql',
      '003_auth_collaboration.sql',
      '004_extensible_execution_routes.sql',
      '005_product_knowledge_candidates.sql',
      '006_ai_connections_and_delegation.sql',
      '007_ai_runners.sql',
      '008_ai_dispatches.sql',
      '009_collaborative_memory.sql',
    ]);
    expect(second).toEqual([]);

    const applied = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name ASC',
    );
    expect(applied.rows.map((row) => row.name)).toEqual([
      '001_initial.sql',
      '002_product_studio.sql',
      '003_auth_collaboration.sql',
      '004_extensible_execution_routes.sql',
      '005_product_knowledge_candidates.sql',
      '006_ai_connections_and_delegation.sql',
      '007_ai_runners.sql',
      '008_ai_dispatches.sql',
      '009_collaborative_memory.sql',
    ]);
  });
});
