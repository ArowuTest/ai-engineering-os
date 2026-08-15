import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { AIConnectionRepository, AIRunnerRepository, AuditRepository, DatabaseUnitOfWork, MembershipRepository, type TransactionRepositories, UserRepository } from '@engineering-os/database';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

async function setupUser(role: 'owner' | 'admin' | 'member', userId: string) {
  const now = new Date('2026-08-15T10:00:00Z');
  const user = {
    id: randomUUID(),
    userId,
    passwordHash: await hashPassword('Runner-hardening-password-2026!'),
    status: 'active' as const,
    createdAt: now,
    updatedAt: now
  };
  await new UserRepository(pool).create(user);
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001',
    userId: user.id,
    role,
    createdBy: 'bootstrap',
    now
  });
  return user;
}

function service(unitOfWork = new DatabaseUnitOfWork(pool)) {
  return new AIRunnerService({
    unitOfWork,
    aiRunners: new AIRunnerRepository(pool),
    memberships: new MembershipRepository(pool),
    audit: new AuditRepository(pool)
  });
}

async function personalRunner(userId: string) {
  const member = await setupUser('member', userId);
  const created = await service().registerRunner({
    organisationId: 'org-001',
    actorUserId: member.id,
    ownership: 'personal',
    ownerUserId: member.id,
    harnessId: 'codex',
    persistentSupported: true,
    capabilities: ['chat', 'tools'],
    now: new Date('2026-08-15T10:01:00Z')
  });
  return { member, created };
}

function controlledHeartbeatService(onCredentialRead: () => Promise<void>) {
  const real = new DatabaseUnitOfWork(pool);
  const controlled = {
    run: <T>(work: (repositories: TransactionRepositories) => Promise<T>) =>
      real.run(async repositories => {
        const original = repositories.aiRunners.getActiveCredentialByHash.bind(repositories.aiRunners);
        let reads = 0;
        repositories.aiRunners.getActiveCredentialByHash = async (hash, at) => {
          const result = await original(hash, at);
          reads += 1;
          if (reads === 1 && result) await onCredentialRead();
          return result;
        };
        return work(repositories);
      })
  } as DatabaseUnitOfWork;
  return service(controlled);
}
describe('AIRunnerService hardening', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('invalidates a personal runner when its owner loses organisation membership', async () => {
    const { member, created } = await personalRunner('runner.departed');
    const memberships = new MembershipRepository(pool);
    await memberships.revokeOrganisation('org-001', member.id, new Date('2026-08-15T10:02:00Z'));

    expect(await service().authenticateRunner(created.credential, new Date('2026-08-15T10:03:00Z'))).toBeNull();
    await expect(
      service().recordHeartbeat({
        credential: created.credential,
        seenAt: new Date('2026-08-15T10:03:00Z'),
        expiresAt: new Date('2026-08-15T10:04:00Z'),
        now: new Date('2026-08-15T10:03:00Z')
      })
    ).rejects.toThrow('unauthorized');
  });

  it('terminally closes credentials, bindings and status when trust is revoked', async () => {
    const { member, created } = await personalRunner('runner.trust.kill');
    const admin = await setupUser('admin', 'runner.trust.kill.admin');
    const connectionId = randomUUID();
    const now = new Date('2026-08-15T10:05:00Z');
    await new AIConnectionRepository(pool).createConnection({
      id: connectionId,
      organisationId: 'org-001',
      ownership: 'personal',
      ownerUserId: member.id,
      providerId: 'anthropic',
      connectionFamilyId: 'claude-subscription',
      credentialStrategy: 'runner_managed',
      status: 'available',
      createdBy: member.id,
      createdAt: now,
      updatedAt: now
    });
    await new AIRunnerRepository(pool).createConnectionBinding({
      id: randomUUID(),
      organisationId: 'org-001',
      runnerId: created.runnerId,
      connectionId,
      createdBy: admin.id,
      createdAt: now
    });

    const revokedAt = new Date('2026-08-15T10:06:00Z');
    await service().setRunnerTrust({
      organisationId: 'org-001',
      actorUserId: admin.id,
      runnerId: created.runnerId,
      trustState: 'revoked',
      now: revokedAt
    });

    expect(await new AIRunnerRepository(pool).listActiveBindingsForRunner('org-001', created.runnerId)).toHaveLength(0);
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({
      trustState: 'revoked',
      status: 'revoked',
      revokedAt
    });
    const activeCredentials = await pool.query('SELECT id FROM ai_runner_credentials WHERE runner_id = $1 AND revoked_at IS NULL', [created.runnerId]);
    expect(activeCredentials.rowCount).toBe(0);
  });

  it('does not let a rotated-out credential finish an in-flight heartbeat', async () => {
    const { member, created } = await personalRunner('runner.heartbeat.rotate');
    let release!: () => void;
    let credentialRead!: () => void;
    const releasePromise = new Promise<void>(resolve => {
      release = resolve;
    });
    const credentialReadPromise = new Promise<void>(resolve => {
      credentialRead = resolve;
    });
    const heartbeatService = controlledHeartbeatService(async () => {
      credentialRead();
      await releasePromise;
    });

    const heartbeat = heartbeatService.recordHeartbeat({
      credential: created.credential,
      seenAt: new Date('2026-08-15T10:10:00Z'),
      expiresAt: new Date('2026-08-15T10:11:00Z'),
      now: new Date('2026-08-15T10:10:00Z')
    });
    await credentialReadPromise;
    await service().rotateRunnerCredential({
      organisationId: 'org-001',
      actorUserId: member.id,
      runnerId: created.runnerId,
      now: new Date('2026-08-15T10:10:30Z')
    });
    release();

    await expect(heartbeat).rejects.toThrow('unauthorized');
    const runner = await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId);
    expect(runner).toMatchObject({ status: 'registered' });
    expect(runner?.lastSeenAt).toBeUndefined();
  });

  it('rejects a heartbeat timestamp outside the server clock-skew window', async () => {
    const { created } = await personalRunner('runner.heartbeat.future');
    const now = new Date('2026-08-15T10:15:00Z');

    await expect(
      service().recordHeartbeat({
        credential: created.credential,
        seenAt: new Date('2099-01-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:01:00Z'),
        now
      } as never)
    ).rejects.toThrow('heartbeat timestamp outside allowed clock skew');

    const runner = await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId);
    expect(runner).toMatchObject({ status: 'registered' });
    expect(runner?.lastSeenAt).toBeUndefined();
  });
  it('uses a locking organisation-membership read for authority-sensitive mutations', async () => {
    const member = await setupUser('member', 'runner.authority.lock');
    const holder = await pool.connect();
    const contender = await pool.connect();
    try {
      await holder.query('BEGIN');
      const locked = await (new MembershipRepository(holder) as any).getOrganisationForUpdate('org-001', member.id);
      expect(locked).toMatchObject({ status: 'active' });
      await contender.query("SET lock_timeout = '100ms'");
      await expect(new MembershipRepository(contender).revokeOrganisation('org-001', member.id, new Date('2026-08-15T10:20:00Z'))).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      contender.release();
    }
  });
});
