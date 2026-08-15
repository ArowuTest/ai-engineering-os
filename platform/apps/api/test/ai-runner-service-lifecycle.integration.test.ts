import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { AIRunnerRepository, AuditRepository, DatabaseUnitOfWork, MembershipRepository, UserRepository } from '@engineering-os/database';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

async function setupMember(userId = 'runner.lifecycle') {
  const now = new Date('2026-08-15T09:00:00Z');
  const user = {
    id: randomUUID(),
    userId,
    passwordHash: await hashPassword('Runner-lifecycle-password-2026!'),
    status: 'active' as const,
    createdAt: now,
    updatedAt: now
  };
  await new UserRepository(pool).create(user);
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001',
    userId: user.id,
    role: 'member',
    createdBy: 'bootstrap',
    now
  });
  return user;
}
function service() {
  return new AIRunnerService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiRunners: new AIRunnerRepository(pool),
    memberships: new MembershipRepository(pool),
    audit: new AuditRepository(pool)
  });
}

async function registerPersonalRunner(userId = 'runner.lifecycle') {
  const member = await setupMember(userId);
  const created = await service().registerRunner({
    organisationId: 'org-001',
    actorUserId: member.id,
    ownership: 'personal',
    ownerUserId: member.id,
    harnessId: 'codex',
    persistentSupported: true,
    capabilities: ['chat', 'tools'],
    now: new Date('2026-08-15T09:05:00Z')
  });
  return { member, created };
}

describe('AIRunnerService lifecycle', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());
  it('authenticates only an active platform runner credential', async () => {
    const { created } = await registerPersonalRunner();
    const runners = service();

    expect(await runners.authenticateRunner(created.credential, new Date('2026-08-15T09:06:00Z'))).toEqual({ organisationId: 'org-001', runnerId: created.runnerId });

    expect(await runners.authenticateRunner('not-a-valid-runner-credential', new Date('2026-08-15T09:06:00Z'))).toBeNull();
  });

  it('rotates a personal runner credential atomically and invalidates the old credential', async () => {
    const { member, created } = await registerPersonalRunner('runner.rotate');
    const runners = service();
    const rotated = await runners.rotateRunnerCredential({
      organisationId: 'org-001',
      actorUserId: member.id,
      runnerId: created.runnerId,
      now: new Date('2026-08-15T09:10:00Z')
    });

    expect(rotated.credential).not.toBe(created.credential);
    expect(await runners.authenticateRunner(created.credential, new Date('2026-08-15T09:11:00Z'))).toBeNull();
    expect(await runners.authenticateRunner(rotated.credential, new Date('2026-08-15T09:11:00Z'))).toEqual({ organisationId: 'org-001', runnerId: created.runnerId });

    const credentials = await pool.query<{ credential_hash: string; revoked_at: Date | null }>(
      'SELECT credential_hash, revoked_at FROM ai_runner_credentials WHERE runner_id = $1 ORDER BY created_at',
      [created.runnerId]
    );
    expect(credentials.rows).toHaveLength(2);
    expect(credentials.rows[0]?.revoked_at).not.toBeNull();
    expect(credentials.rows[1]?.revoked_at).toBeNull();

    const serializedAudit = JSON.stringify(await new AuditRepository(pool).listByOrganisation('org-001'));
    expect(serializedAudit).not.toContain(created.credential);
    expect(serializedAudit).not.toContain(rotated.credential);
  });
  it('records a credential-authenticated heartbeat without creating audit noise', async () => {
    const { created } = await registerPersonalRunner('runner.heartbeat');
    const runners = service();
    const seenAt = new Date('2026-08-15T09:20:00Z');
    const expiresAt = new Date('2026-08-15T09:21:00Z');
    const auditBefore = await new AuditRepository(pool).listByOrganisation('org-001');

    await runners.recordHeartbeat({ credential: created.credential, seenAt, expiresAt });

    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({
      status: 'online',
      lastSeenAt: seenAt,
      heartbeatExpiresAt: expiresAt
    });
    const auditAfter = await new AuditRepository(pool).listByOrganisation('org-001');
    expect(auditAfter).toHaveLength(auditBefore.length);
  });
  it('disables a personal runner immediately without heartbeat audit spam', async () => {
    const { member, created } = await registerPersonalRunner('runner.disable');
    const runners = service();
    await runners.disableRunner({
      organisationId: 'org-001',
      actorUserId: member.id,
      runnerId: created.runnerId,
      now: new Date('2026-08-15T09:30:00Z')
    });

    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ status: 'disabled' });
    expect(await runners.authenticateRunner(created.credential, new Date('2026-08-15T09:31:00Z'))).toBeNull();
    await expect(
      runners.recordHeartbeat({
        credential: created.credential,
        seenAt: new Date('2026-08-15T09:31:00Z'),
        expiresAt: new Date('2026-08-15T09:32:00Z')
      })
    ).rejects.toThrow('unauthorized');
    expect((await new AuditRepository(pool).listByOrganisation('org-001')).map(e => e.eventType)).toContain('ai.runner.disabled');
  });

  it('terminally revokes a personal runner and all active platform credentials', async () => {
    const { member, created } = await registerPersonalRunner('runner.revoke');
    const runners = service();
    await runners.revokeRunner({
      organisationId: 'org-001',
      actorUserId: member.id,
      runnerId: created.runnerId,
      now: new Date('2026-08-15T09:40:00Z')
    });

    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({
      status: 'revoked',
      revokedAt: new Date('2026-08-15T09:40:00Z')
    });
    const active = await pool.query('SELECT id FROM ai_runner_credentials WHERE runner_id = $1 AND revoked_at IS NULL', [created.runnerId]);
    expect(active.rowCount).toBe(0);
    expect(await runners.authenticateRunner(created.credential, new Date('2026-08-15T09:41:00Z'))).toBeNull();
    expect((await new AuditRepository(pool).listByOrganisation('org-001')).map(e => e.eventType)).toContain('ai.runner.revoked');
  });
});
