import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAIRunnerRecord, validateAIRunnerConnectionBinding } from '@engineering-os/domain';
import { AIConnectionRepository, AIRunnerRepository, DatabaseUnitOfWork, UserRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

afterAll(async () => closeDatabase());

async function seedUser(userId: string, organisationId = 'org-001'): Promise<string> {
  const id = randomUUID();
  const now = new Date('2026-08-14T04:00:00Z');
  await new UserRepository(pool).create({
    id,
    userId,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'member', 'active', 'bootstrap', $3, $3)`,
    [organisationId, id, now]
  );
  return id;
}
async function seedConnection(organisationId: string, ownerUserId?: string): Promise<string> {
  const id = randomUUID();
  const now = new Date('2026-08-14T04:00:00Z');
  await new AIConnectionRepository(pool).createConnection({
    id,
    organisationId,
    ownership: ownerUserId ? 'personal' : 'organisation',
    ...(ownerUserId ? { ownerUserId } : {}),
    providerId: 'anthropic',
    connectionFamilyId: 'claude_code_subscription',
    credentialStrategy: 'runner_managed',
    status: 'configured',
    createdBy: ownerUserId ?? 'bootstrap',
    createdAt: now,
    updatedAt: now
  });
  return id;
}

function runnerRecord(organisationId: string, ownerUserId?: string) {
  return createAIRunnerRecord({
    id: randomUUID(),
    organisationId,
    ownership: ownerUserId ? 'personal' : 'organisation',
    ...(ownerUserId ? { ownerUserId } : {}),
    harnessId: 'claude-code',
    persistentSupported: true,
    capabilities: ['workspace', 'tools', 'mcp'],
    createdBy: ownerUserId ?? 'bootstrap',
    createdAt: new Date('2026-08-14T04:00:00Z')
  });
}

describe('ai_runners migration schema', () => {
  beforeEach(async () => resetDatabase());

  it('applies migration 007 and stores no provider/plaintext credential columns', async () => {
    const migrations = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
    expect(migrations.rows.map(row => row.name)).toContain('007_ai_runners.sql');

    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('ai_runners', 'ai_runner_connection_bindings', 'ai_runner_credentials')`
    );
    expect(columns.rows.length).toBeGreaterThan(0);
    const forbidden = ['password', 'api_key', 'access_token', 'refresh_token', 'cookie', 'cookies', 'provider_session', 'session_token', 'plaintext_token', 'secret'];
    for (const name of forbidden) {
      expect(columns.rows.map(row => row.column_name)).not.toContain(name);
    }
    expect(columns.rows.map(row => row.column_name)).toContain('credential_hash');
  });

  it('enforces runner ownership and heartbeat chronology in PostgreSQL', async () => {
    const owner = await seedUser('runner.schema.owner');
    await expect(
      pool.query(
        `INSERT INTO ai_runners
       (id, organisation_id, ownership, owner_user_id, harness_id, status, trust_state,
        persistent_supported, capabilities, created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'personal', NULL, 'claude-code', 'registered', 'pending',
               true, ARRAY['workspace'], $2, now(), now())`,
        [randomUUID(), owner]
      )
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO ai_runners
       (id, organisation_id, ownership, owner_user_id, harness_id, status, trust_state,
        persistent_supported, capabilities, created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'organisation', $2, 'claude-code', 'registered', 'pending',
               true, ARRAY['workspace'], $3, now(), now())`,
        [randomUUID(), owner, owner]
      )
    ).rejects.toThrow();

    const runnerId = randomUUID();
    await pool.query(
      `INSERT INTO ai_runners
       (id, organisation_id, ownership, owner_user_id, harness_id, status, trust_state,
        persistent_supported, capabilities, created_by, created_at, updated_at)
       VALUES ($1, 'org-001', 'personal', $2, 'claude-code', 'registered', 'pending',
               true, ARRAY['workspace'], $3, '2026-08-14T04:00:00Z', '2026-08-14T04:00:00Z')`,
      [runnerId, owner, owner]
    );
    await expect(
      pool.query(
        `UPDATE ai_runners SET last_seen_at = '2026-08-14T05:00:00Z',
                             heartbeat_expires_at = '2026-08-14T04:59:59Z'
       WHERE id = $1`,
        [runnerId]
      )
    ).rejects.toThrow();
  });
});

describe('AIRunnerRepository', () => {
  beforeEach(async () => resetDatabase());

  it('round-trips a personal runner and scopes reads by organisation', async () => {
    const owner = await seedUser('runner.repo.owner');
    const repo = new AIRunnerRepository(pool);
    const record = runnerRecord('org-001', owner);
    await repo.createRunner(record);

    const fetched = await repo.getRunner('org-001', record.id);
    expect(fetched).toMatchObject({
      id: record.id,
      organisationId: 'org-001',
      ownerUserId: owner,
      harnessId: 'claude-code',
      status: 'registered',
      trustState: 'pending',
      capabilities: ['workspace', 'tools', 'mcp']
    });
    expect(await repo.getRunner('org-002', record.id)).toBeNull();
  });

  it('preserves binding history while allowing only one active runner-connection pair', async () => {
    const owner = await seedUser('runner.binding.owner');
    const connectionId = await seedConnection('org-001', owner);
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);

    const first = validateAIRunnerConnectionBinding({
      id: randomUUID(),
      organisationId: 'org-001',
      runnerId: runner.id,
      connectionId,
      createdBy: owner,
      createdAt: new Date('2026-08-14T04:10:00Z')
    });
    await repo.createConnectionBinding(first);
    await expect(repo.createConnectionBinding({ ...first, id: randomUUID() })).rejects.toThrow();

    await repo.revokeConnectionBinding('org-001', first.id, new Date('2026-08-14T04:20:00Z'));
    const second = validateAIRunnerConnectionBinding({
      ...first,
      id: randomUUID(),
      createdAt: new Date('2026-08-14T04:30:00Z')
    });
    await repo.createConnectionBinding(second);

    const active = await repo.listActiveBindingsForConnection('org-001', connectionId);
    expect(active.map(binding => binding.id)).toEqual([second.id]);
    const history = await pool.query('SELECT id, revoked_at FROM ai_runner_connection_bindings WHERE runner_id = $1 ORDER BY created_at', [runner.id]);
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]?.revoked_at).not.toBeNull();
  });

  it('rejects a binding to a connection in another organisation', async () => {
    const ownerOne = await seedUser('runner.cross.one', 'org-001');
    const ownerTwo = await seedUser('runner.cross.two', 'org-002');
    const foreignConnection = await seedConnection('org-002', ownerTwo);
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', ownerOne);
    await repo.createRunner(runner);

    await expect(
      repo.createConnectionBinding(
        validateAIRunnerConnectionBinding({
          id: randomUUID(),
          organisationId: 'org-001',
          runnerId: runner.id,
          connectionId: foreignConnection,
          createdBy: ownerOne,
          createdAt: new Date('2026-08-14T04:10:00Z')
        })
      )
    ).rejects.toThrow();
  });

  it('stores only credential hashes and resolves an active credential by hash', async () => {
    const owner = await seedUser('runner.credential.owner');
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);
    const createdAt = new Date('2026-08-14T04:00:00Z');
    const expiresAt = new Date('2026-08-15T04:00:00Z');
    const credentialHash = 'a'.repeat(64);

    await repo.createCredentialHash({
      id: randomUUID(),
      organisationId: 'org-001',
      runnerId: runner.id,
      credentialHash,
      createdAt,
      expiresAt
    });
    const found = await repo.getActiveCredentialByHash(credentialHash, new Date('2026-08-14T05:00:00Z'));
    expect(found).toMatchObject({ organisationId: 'org-001', runnerId: runner.id, credentialHash });
    expect(await repo.getActiveCredentialByHash(credentialHash, expiresAt)).toBeNull();
  });

  it('allows one active credential per runner and preserves rotation history', async () => {
    const owner = await seedUser('runner.rotate.owner');
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);
    const firstId = randomUUID();
    await repo.createCredentialHash({
      id: firstId,
      organisationId: 'org-001',
      runnerId: runner.id,
      credentialHash: 'b'.repeat(64),
      createdAt: new Date('2026-08-14T04:00:00Z')
    });
    await expect(
      repo.createCredentialHash({
        id: randomUUID(),
        organisationId: 'org-001',
        runnerId: runner.id,
        credentialHash: 'c'.repeat(64),
        createdAt: new Date('2026-08-14T04:05:00Z')
      })
    ).rejects.toThrow();

    await repo.revokeCredential('org-001', firstId, new Date('2026-08-14T04:10:00Z'));
    await repo.createCredentialHash({
      id: randomUUID(),
      organisationId: 'org-001',
      runnerId: runner.id,
      credentialHash: 'c'.repeat(64),
      createdAt: new Date('2026-08-14T04:11:00Z')
    });
    const rows = await pool.query('SELECT credential_hash, revoked_at FROM ai_runner_credentials WHERE runner_id = $1 ORDER BY created_at', [runner.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
  });

  it('persists heartbeat health and survives a fresh repository instance', async () => {
    const owner = await seedUser('runner.heartbeat.owner');
    const runner = runnerRecord('org-001', owner);
    const firstRepo = new AIRunnerRepository(pool);
    await firstRepo.createRunner(runner);
    const seenAt = new Date('2026-08-14T05:00:00Z');
    const expiresAt = new Date('2026-08-14T05:02:00Z');
    await firstRepo.recordHeartbeat('org-001', runner.id, seenAt, expiresAt);

    const afterRestart = new AIRunnerRepository(pool);
    const fetched = await afterRestart.getRunner('org-001', runner.id);
    expect(fetched?.status).toBe('online');
    expect(fetched?.lastSeenAt?.toISOString()).toBe(seenAt.toISOString());
    expect(fetched?.heartbeatExpiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  it('rejects an out-of-order heartbeat instead of moving health time backwards', async () => {
    const owner = await seedUser('runner.heartbeat.replay');
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);
    await repo.recordHeartbeat('org-001', runner.id, new Date('2026-08-14T05:00:00Z'), new Date('2026-08-14T05:02:00Z'));

    await expect(repo.recordHeartbeat('org-001', runner.id, new Date('2026-08-14T04:59:59Z'), new Date('2026-08-14T05:03:00Z'))).rejects.toThrow();
    const fetched = await repo.getRunner('org-001', runner.id);
    expect(fetched?.lastSeenAt?.toISOString()).toBe('2026-08-14T05:00:00.000Z');
    expect(fetched?.heartbeatExpiresAt?.toISOString()).toBe('2026-08-14T05:02:00.000Z');
  });
  it('rejects heartbeat expiry that is not strictly after the seen time', async () => {
    const owner = await seedUser('runner.heartbeat.invalid');
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);
    const seenAt = new Date('2026-08-14T05:00:00Z');
    await expect(repo.recordHeartbeat('org-001', runner.id, seenAt, seenAt)).rejects.toThrow();
  });

  it('composes the runner repository into DatabaseUnitOfWork and rolls back atomically', async () => {
    const owner = await seedUser('runner.uow.owner');
    const runner = runnerRecord('org-001', owner);
    const uow = new DatabaseUnitOfWork(pool);
    await expect(
      uow.run(async ({ aiRunners }) => {
        await aiRunners.createRunner(runner);
        throw new Error('forced runner transaction failure');
      })
    ).rejects.toThrow('forced runner transaction failure');

    expect(await new AIRunnerRepository(pool).getRunner('org-001', runner.id)).toBeNull();
  });
});

// Persistence-level revocation must remain fail-closed even before Task 3 service policy.
describe('AIRunnerRepository revocation hardening', () => {
  beforeEach(async () => resetDatabase());

  it('does not authenticate or revive a revoked runner', async () => {
    const owner = await seedUser('runner.revoked.owner');
    const repo = new AIRunnerRepository(pool);
    const runner = runnerRecord('org-001', owner);
    await repo.createRunner(runner);
    const hash = 'd'.repeat(64);
    await repo.createCredentialHash({
      id: randomUUID(),
      organisationId: 'org-001',
      runnerId: runner.id,
      credentialHash: hash,
      createdAt: new Date('2026-08-14T04:00:00Z')
    });

    await repo.setRunnerStatus('org-001', runner.id, 'revoked', new Date('2026-08-14T04:10:00Z'));
    expect(await repo.getActiveCredentialByHash(hash, new Date('2026-08-14T04:11:00Z'))).toBeNull();
    await expect(repo.setRunnerStatus('org-001', runner.id, 'online', new Date('2026-08-14T04:12:00Z'))).rejects.toThrow();
    expect((await repo.getRunner('org-001', runner.id))?.status).toBe('revoked');
  });
});
