import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());

describe('capability estate migration', () => {
  it('creates separate catalogue, release and agent persistence surfaces', async () => {
    const tables = await pool.query<{ name: string | null }>(`
      SELECT to_regclass('public.capability_catalogue')::text AS name
      UNION ALL SELECT to_regclass('public.capability_release_policies')::text
      UNION ALL SELECT to_regclass('public.capability_agents')::text
    `);
    expect(tables.rows.map((row) => row.name)).toEqual([
      'capability_catalogue',
      'capability_release_policies',
      'capability_agents',
    ]);
  });

  it('keeps credential-shaped columns out of the capability estate', async () => {
    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN ('capability_catalogue','capability_release_policies','capability_agents')
    `);
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['secret', 'token', 'password', 'credential', 'api_key']),
    );
  });
});