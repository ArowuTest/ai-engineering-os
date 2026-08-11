import { describe, expect, it } from 'vitest';
import { createRuntimeApp, prepareRuntimeDatabase, resolveServerConfig } from '../src/server.js';

const databaseUrl =
  'postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test';

describe('API runtime composition', () => {
  it('resolves safe host and port defaults', () => {
    expect(resolveServerConfig({})).toEqual({ host: '127.0.0.1', port: 3100 });
    expect(resolveServerConfig({ PLATFORM_HOST: '0.0.0.0', PLATFORM_PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('rejects an invalid port before starting the server', () => {
    expect(() => resolveServerConfig({ PLATFORM_PORT: 'not-a-port' })).toThrow('PLATFORM_PORT');
    expect(() => resolveServerConfig({ PLATFORM_PORT: '70000' })).toThrow('PLATFORM_PORT');
  });

  it('composes the real repositories and exposes health without listening on a socket', async () => {
    const runtime = createRuntimeApp({ DATABASE_URL: databaseUrl });
    try {
      const response = await runtime.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', modelRoutes: 0 });
    } finally {
      await runtime.close();
    }
  });

  it('prepares runtime migrations and optional development organisation idempotently', async () => {
    const runtime = createRuntimeApp({ DATABASE_URL: databaseUrl });
    try {
      await runtime.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const environment = {
        DEV_BOOTSTRAP_ORGANISATION_ID: 'org-001',
        DEV_BOOTSTRAP_ORGANISATION_NAME: 'Development Organisation',
      };
      await prepareRuntimeDatabase(runtime.pool, environment);
      await prepareRuntimeDatabase(runtime.pool, environment);

      const organisations = await runtime.pool.query<{ id: string }>(
        'SELECT id FROM organisations WHERE id = $1', ['org-001'],
      );
      expect(organisations.rowCount).toBe(1);
      const migrations = await runtime.pool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name ASC',
      );
      expect(migrations.rows.map((row) => row.name)).toEqual([
        '001_initial.sql',
        '002_product_studio.sql',
        '003_auth_collaboration.sql',
        '004_extensible_execution_routes.sql',
      ]);
    } finally {
      await runtime.close();
    }
  });

  it('creates the first owner only when explicit bootstrap credentials are supplied', async () => {
    const runtime = createRuntimeApp({ DATABASE_URL: databaseUrl });
    try {
      await runtime.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const environment = {
        BOOTSTRAP_ORGANISATION_ID: 'org-bootstrap',
        BOOTSTRAP_ORGANISATION_NAME: 'Bootstrap Organisation',
        BOOTSTRAP_OWNER_USER_ID: 'Initial.Owner',
        BOOTSTRAP_OWNER_PASSWORD: 'Bootstrap-owner-2026!',
      };
      await prepareRuntimeDatabase(runtime.pool, environment);
      await prepareRuntimeDatabase(runtime.pool, environment);

      const users = await runtime.pool.query<{ user_id: string; password_hash: string }>(
        `SELECT user_id, password_hash FROM users WHERE user_id = 'initial.owner'`,
      );
      expect(users.rowCount).toBe(1);
      expect(users.rows[0]?.password_hash).not.toContain('Bootstrap-owner-2026!');
      const membership = await runtime.pool.query<{ role: string }>(
        `SELECT role FROM organisation_memberships
         WHERE organisation_id = 'org-bootstrap' AND user_id = (SELECT id FROM users WHERE user_id = 'initial.owner')`,
      );
      expect(membership.rows[0]?.role).toBe('owner');
    } finally {
      await runtime.close();
    }
  });
});
