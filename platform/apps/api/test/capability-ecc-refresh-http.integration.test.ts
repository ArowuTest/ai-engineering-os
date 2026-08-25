import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  CapabilityEstateRepository,
  PlatformMembershipRepository,
  UserRepository,
} from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase, databaseUrl, pool, resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const repositoryRoot = path.resolve(process.cwd(), '..');

async function seedPlatformAdmin() {
  const id = randomUUID(), now = new Date();
  await new UserRepository(pool).create({
    id, userId: 'ecc.refresh.admin',
    passwordHash: await hashPassword('ECC-refresh-admin-2026!'),
    status: 'active', createdAt: now, updatedAt: now,
  });
  await new PlatformMembershipRepository(pool).grantAdmin({ userId: id, createdBy: 'bootstrap', now });
  return id;
}
beforeEach(async () => resetDatabase(), 30_000);
afterAll(async () => closeDatabase());

describe('ECC capability refresh HTTP boundary', () => {
  it('lets Platform Admin reconcile the live inherited estate without auto-release', async () => {
    await seedPlatformAdmin();
    const instance = createRuntimeApp({
      DATABASE_URL: databaseUrl,
      ECC_REPOSITORY_ROOT: repositoryRoot,
      ALLOW_DEV_IDENTITY_HEADERS: 'false',
    });
    const login = await instance.app.inject({
      method: 'POST', url: '/auth/login',
      payload: { userId: 'ecc.refresh.admin', password: 'ECC-refresh-admin-2026!' },
    });
    expect(login.statusCode).toBe(200);
    const token = (login.json() as { token: string }).token;
    const refreshed = await instance.app.inject({
      method: 'POST', url: '/admin/capabilities/refresh/ecc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refreshed.statusCode).toBe(200);
    const body = refreshed.json() as { discovered: number; reconciled: number };
    expect(body.discovered).toBeGreaterThan(300);
    expect(body.reconciled).toBe(body.discovered);

    const inventory = await instance.app.inject({
      method: 'GET', url: '/admin/capabilities?kind=harness',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(inventory.statusCode).toBe(200);
    expect(inventory.json()).toContainEqual(expect.objectContaining({
      id: 'ecc.harness.codex', governanceState: 'discovered',
      executionVerification: 'unverified',
    }));
    const releases = await new CapabilityEstateRepository(pool).listReleases('ecc.harness.codex');
    expect(releases).toEqual([]);
    await instance.close();
  });
});