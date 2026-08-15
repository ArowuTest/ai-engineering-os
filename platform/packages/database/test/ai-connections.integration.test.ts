import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

afterAll(async () => closeDatabase());
import {
  AIConnectionRepository,
  DatabaseUnitOfWork,
  SessionRepository,
  UserRepository,
} from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

interface SeededUser {
  id: string;
  userId: string;
}

async function seedUser(userId: string): Promise<SeededUser> {
  const users = new UserRepository(pool);
  const id = randomUUID();
  const now = new Date();
  await users.create({
    id,
    userId,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return { id, userId };
}

async function seedProject(organisationId: string, name: string): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, $2, $3, 'bootstrap', $4, 'discovery', 'auto', $4)`,
    [projectId, organisationId, name, now],
  );
  return projectId;
}

async function seedOrgMembership(organisationId: string, userId: string): Promise<void> {
  const now = new Date();
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'member', 'active', 'bootstrap', $3, $3)`,
    [organisationId, userId, now],
  );
}

describe('ai_connections migration schema', () => {
  beforeEach(async () => resetDatabase());

  it('has no raw credential columns anywhere on new tables', async () => {
    const columns = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT column_name, table_name FROM information_schema.columns
       WHERE table_name IN ('ai_connections', 'ai_connection_project_shares')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names.length).toBeGreaterThan(0);
    for (const forbidden of ['password', 'token', 'cookie', 'refresh_token', 'api_key',
                             'password_hash', 'token_hash', 'refresh', 'secret', 'credential']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('enforces personal ownership requires owner_user_id via CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO ai_connections
          (id, organisation_id, ownership, owner_user_id, provider_id,
           connection_family_id, credential_strategy, status,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', 'personal', NULL, 'openai',
                 'openai_api', 'runner_managed', 'configured',
                 'bootstrap', now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('rejects organisation ownership carrying an owner_user_id', async () => {
    const owner = await seedUser('org.spoof');
    await seedOrgMembership('org-001', owner.id);
    await expect(
      pool.query(
        `INSERT INTO ai_connections
          (id, organisation_id, ownership, owner_user_id, provider_id,
           connection_family_id, credential_strategy, status,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', 'organisation', $2, 'openai',
                 'openai_api', 'runner_managed', 'configured',
                 'bootstrap', now(), now())`,
        [randomUUID(), owner.id],
      ),
    ).rejects.toThrow();
  });

  it('requires nonblank secret_ref_id when credential strategy is external_secret_ref', async () => {
    await expect(
      pool.query(
        `INSERT INTO ai_connections
          (id, organisation_id, ownership, owner_user_id, provider_id,
           connection_family_id, credential_strategy, secret_ref_id, status,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', 'organisation', NULL, 'openai',
                 'openai_api', 'external_secret_ref', NULL, 'configured',
                 'bootstrap', now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO ai_connections
          (id, organisation_id, ownership, owner_user_id, provider_id,
           connection_family_id, credential_strategy, secret_ref_id, status,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', 'organisation', NULL, 'openai',
                 'openai_api', 'external_secret_ref', '   ', 'configured',
                 'bootstrap', now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('rejects secret_ref_id when credential strategy is not external_secret_ref', async () => {
    const owner = await seedUser('personal.strategy');
    await seedOrgMembership('org-001', owner.id);
    await expect(
      pool.query(
        `INSERT INTO ai_connections
          (id, organisation_id, ownership, owner_user_id, provider_id,
           connection_family_id, credential_strategy, secret_ref_id, status,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', 'personal', $2, 'openai',
                 'openai_api', 'runner_managed', 'secret-should-not-store', 'configured',
                 'bootstrap', now(), now())`,
        [randomUUID(), owner.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects project share whose connection lives in a different organisation', async () => {
    const owner = await seedUser('cross.org.owner');
    await seedOrgMembership('org-001', owner.id);
    const projectInOrgTwo = await seedProject('org-002', 'Foreign Project');

    const connectionId = randomUUID();
    await pool.query(
      `INSERT INTO ai_connections
        (id, organisation_id, ownership, owner_user_id, provider_id,
         connection_family_id, credential_strategy, status,
         created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'personal', $2, 'openai',
               'openai_api', 'runner_managed', 'configured',
               'bootstrap', now(), now())`,
      [connectionId, owner.id],
    );

    await expect(
      pool.query(
        `INSERT INTO ai_connection_project_shares
          (id, organisation_id, project_id, connection_id, connection_ownership,
           mode, created_by, created_at, updated_at)
         VALUES ($1, 'org-002', $2, $3, 'personal',
                 'online_only', 'bootstrap', now(), now())`,
        [randomUUID(), projectInOrgTwo, connectionId],
      ),
    ).rejects.toThrow();
  });

  it('rejects project share that references an organisation-owned connection', async () => {
    const project = await seedProject('org-001', 'Shared Project');
    const connectionId = randomUUID();
    await pool.query(
      `INSERT INTO ai_connections
        (id, organisation_id, ownership, owner_user_id, provider_id,
         connection_family_id, credential_strategy, secret_ref_id, status,
         created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'organisation', NULL, 'openai',
               'openai_api', 'external_secret_ref', 'secret-abc', 'configured',
               'bootstrap', now(), now())`,
      [connectionId],
    );

    await expect(
      pool.query(
        `INSERT INTO ai_connection_project_shares
          (id, organisation_id, project_id, connection_id, connection_ownership,
           mode, created_by, created_at, updated_at)
         VALUES ($1, 'org-001', $2, $3, 'organisation',
                 'online_only', 'bootstrap', now(), now())`,
        [randomUUID(), project, connectionId],
      ),
    ).rejects.toThrow();
  });

  it('enforces usage window: available_until must be strictly greater than available_from', async () => {
    const owner = await seedUser('window.owner');
    await seedOrgMembership('org-001', owner.id);
    const project = await seedProject('org-001', 'Window Project');
    const connectionId = randomUUID();
    await pool.query(
      `INSERT INTO ai_connections
        (id, organisation_id, ownership, owner_user_id, provider_id,
         connection_family_id, credential_strategy, status,
         created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'personal', $2, 'openai',
               'openai_api', 'runner_managed', 'configured',
               'bootstrap', now(), now())`,
      [connectionId, owner.id],
    );

    await expect(
      pool.query(
        `INSERT INTO ai_connection_project_shares
          (id, organisation_id, project_id, connection_id, connection_ownership,
           mode, available_from, available_until,
           created_by, created_at, updated_at)
         VALUES ($1, 'org-001', $2, $3, 'personal',
                 'online_only', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z',
                 'bootstrap', now(), now())`,
        [randomUUID(), project, connectionId],
      ),
    ).rejects.toThrow();
  });
});

describe('AIConnectionRepository', () => {
  beforeEach(async () => resetDatabase());

  it('creates and reads a personal connection scoped by organisation', async () => {
    const owner = await seedUser('personal.owner');
    await seedOrgMembership('org-001', owner.id);
    const repo = new AIConnectionRepository(pool);
    const record = {
      id: randomUUID(),
      organisationId: 'org-001',
      ownership: 'personal' as const,
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed' as const,
      status: 'configured' as const,
      createdBy: owner.id,
      createdAt: new Date('2026-08-12T10:00:00Z'),
      updatedAt: new Date('2026-08-12T10:00:00Z'),
    };
    await repo.createConnection(record);

    const fetched = await repo.getConnection('org-001', record.id);
    expect(fetched).toMatchObject({
      id: record.id,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed',
      status: 'configured',
    });
    expect(await repo.getConnection('org-002', record.id)).toBeNull();

    const listed = await repo.listForUser('org-001', owner.id);
    expect(listed.map((r) => r.id)).toEqual([record.id]);
  });

  it('lists organisation-owned connections, excluding personal', async () => {
    const owner = await seedUser('personal.only');
    await seedOrgMembership('org-001', owner.id);
    const repo = new AIConnectionRepository(pool);

    const personalId = randomUUID();
    await repo.createConnection({
      id: personalId,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed',
      status: 'configured',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const orgId = randomUUID();
    await repo.createConnection({
      id: orgId,
      organisationId: 'org-001',
      ownership: 'organisation',
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'external_secret_ref',
      secretRefId: 'vault:openai/org-001',
      status: 'configured',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const orgList = await repo.listOrganisationConnections('org-001');
    expect(orgList.map((r) => r.id)).toEqual([orgId]);
    expect(orgList[0]?.secretRefId).toBe('vault:openai/org-001');
  });

  it('setConnectionStatus transitions to revoked without deleting the row', async () => {
    const owner = await seedUser('revoke.owner');
    await seedOrgMembership('org-001', owner.id);
    const repo = new AIConnectionRepository(pool);
    const id = randomUUID();
    await repo.createConnection({
      id,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed',
      status: 'configured',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const revokedAt = new Date('2026-08-12T12:00:00Z');
    await repo.setConnectionStatus('org-001', id, 'revoked', revokedAt);
    const after = await repo.getConnection('org-001', id);
    expect(after?.status).toBe('revoked');
    expect(after?.revokedAt?.toISOString()).toBe(revokedAt.toISOString());
  });

  it('allows only one active project share per (connection, project) via partial unique index', async () => {
    const owner = await seedUser('share.owner');
    await seedOrgMembership('org-001', owner.id);
    const project = await seedProject('org-001', 'Share Project');
    const repo = new AIConnectionRepository(pool);
    const connectionId = randomUUID();
    await repo.createConnection({
      id: connectionId,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed',
      status: 'configured',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const firstShareId = randomUUID();
    await repo.createProjectShare({
      id: firstShareId,
      organisationId: 'org-001',
      projectId: project,
      connectionId,
      mode: 'online_only',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      repo.createProjectShare({
        id: randomUUID(),
        organisationId: 'org-001',
        projectId: project,
        connectionId,
        mode: 'online_only',
        createdBy: owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();

    await repo.revokeProjectShare('org-001', firstShareId, new Date('2026-08-12T13:00:00Z'));

    const secondShareId = randomUUID();
    await repo.createProjectShare({
      id: secondShareId,
      organisationId: 'org-001',
      projectId: project,
      connectionId,
      mode: 'persistent',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const active = await repo.getActiveProjectShare('org-001', project, connectionId);
    expect(active?.id).toBe(secondShareId);
    expect(active?.mode).toBe('persistent');

    const allRows = await pool.query<{ id: string }>(
      `SELECT id FROM ai_connection_project_shares
       WHERE organisation_id = 'org-001' AND project_id = $1 AND connection_id = $2`,
      [project, connectionId],
    );
    expect(allRows.rows).toHaveLength(2);
  });

  it('round-trips usage window timestamps', async () => {
    const owner = await seedUser('window.round');
    await seedOrgMembership('org-001', owner.id);
    const project = await seedProject('org-001', 'RoundTrip Project');
    const repo = new AIConnectionRepository(pool);
    const connectionId = randomUUID();
    await repo.createConnection({
      id: connectionId,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: owner.id,
      providerId: 'openai',
      connectionFamilyId: 'openai_api',
      credentialStrategy: 'runner_managed',
      status: 'configured',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const availableFrom = new Date('2026-09-01T09:00:00Z');
    const availableUntil = new Date('2026-09-01T17:00:00Z');
    const shareId = randomUUID();
    await repo.createProjectShare({
      id: shareId,
      organisationId: 'org-001',
      projectId: project,
      connectionId,
      mode: 'online_only',
      availableFrom,
      availableUntil,
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const share = await repo.getActiveProjectShare('org-001', project, connectionId);
    expect(share?.availableFrom?.toISOString()).toBe(availableFrom.toISOString());
    expect(share?.availableUntil?.toISOString()).toBe(availableUntil.toISOString());
  });

  it('lists active project shares scoped by organisation + project', async () => {
    const owner = await seedUser('list.shares');
    await seedOrgMembership('org-001', owner.id);
    const project = await seedProject('org-001', 'List Shares Project');
    const otherProject = await seedProject('org-001', 'Other Project');
    const repo = new AIConnectionRepository(pool);
    const c1 = randomUUID();
    const c2 = randomUUID();
    for (const id of [c1, c2]) {
      await repo.createConnection({
        id,
        organisationId: 'org-001',
        ownership: 'personal',
        ownerUserId: owner.id,
        providerId: 'openai',
        connectionFamilyId: 'openai_api',
        credentialStrategy: 'runner_managed',
        status: 'configured',
        createdBy: owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await repo.createProjectShare({
      id: randomUUID(),
      organisationId: 'org-001',
      projectId: project,
      connectionId: c1,
      mode: 'online_only',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const revokedShareId = randomUUID();
    await repo.createProjectShare({
      id: revokedShareId,
      organisationId: 'org-001',
      projectId: project,
      connectionId: c2,
      mode: 'online_only',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await repo.revokeProjectShare('org-001', revokedShareId, new Date());
    await repo.createProjectShare({
      id: randomUUID(),
      organisationId: 'org-001',
      projectId: otherProject,
      connectionId: c1,
      mode: 'online_only',
      createdBy: owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const listed = await repo.listActiveProjectShares('org-001', project);
    expect(listed.map((s) => s.connectionId)).toEqual([c1]);
  });

  it('composes into DatabaseUnitOfWork transactional repositories', async () => {
    const owner = await seedUser('uow.owner');
    await seedOrgMembership('org-001', owner.id);
    const uow = new DatabaseUnitOfWork(pool);
    const connectionId = randomUUID();
    await uow.run(async ({ aiConnections }) => {
      await aiConnections.createConnection({
        id: connectionId,
        organisationId: 'org-001',
        ownership: 'personal',
        ownerUserId: owner.id,
        providerId: 'openai',
        connectionFamilyId: 'openai_api',
        credentialStrategy: 'runner_managed',
        status: 'configured',
        createdBy: owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const repo = new AIConnectionRepository(pool);
    expect(await repo.getConnection('org-001', connectionId)).not.toBeNull();
  });
});

describe('SessionRepository.hasActiveForUser', () => {
  beforeEach(async () => resetDatabase());

  it('returns true only for unexpired non-revoked sessions', async () => {
    const users = new UserRepository(pool);
    const sessions = new SessionRepository(pool);
    const userId = randomUUID();
    const now = new Date('2026-08-12T10:00:00Z');
    await users.create({
      id: userId,
      userId: 'presence.user',
      passwordHash: 'scrypt$test$hash',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    expect(await sessions.hasActiveForUser(userId, now)).toBe(false);

    await sessions.create({
      id: randomUUID(),
      userId,
      tokenHash: 'c'.repeat(64),
      createdAt: now,
      expiresAt: new Date('2026-08-12T11:00:00Z'),
    });
    expect(await sessions.hasActiveForUser(userId, now)).toBe(true);
    expect(await sessions.hasActiveForUser(userId, new Date('2026-08-12T12:00:00Z'))).toBe(false);

    await sessions.revokeAllForUser(userId, new Date('2026-08-12T10:30:00Z'));
    expect(await sessions.hasActiveForUser(userId, new Date('2026-08-12T10:45:00Z'))).toBe(false);
  });
});

describe('migration ordering', () => {

  it('applies exactly migrations 001..008 in order', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { runMigrations } = await import('../src/index.js');
    const applied = await runMigrations(pool);
    expect(applied).toEqual([
      '001_initial.sql',
      '002_product_studio.sql',
      '003_auth_collaboration.sql',
      '004_extensible_execution_routes.sql',
      '005_product_knowledge_candidates.sql',
      '006_ai_connections_and_delegation.sql',
      '007_ai_runners.sql',
      '008_ai_dispatches.sql',
    ]);
  });
});
