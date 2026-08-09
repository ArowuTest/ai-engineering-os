import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { closeDatabase, pool } from './database-test-harness.js';

describe('runMigrations', () => {
  afterAll(closeDatabase);

  it('applies every migration once and can safely run again', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const first = await runMigrations(pool);
    const second = await runMigrations(pool);

    expect(first).toEqual(['001_initial.sql', '002_product_studio.sql']);
    expect(second).toEqual([]);

    const applied = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name ASC',
    );
    expect(applied.rows.map((row) => row.name)).toEqual([
      '001_initial.sql',
      '002_product_studio.sql',
    ]);
  });
});
