import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken, hashPassword, type OrganisationRole } from '@engineering-os/domain';
import { AIRunnerRepository, AuditRepository, DatabaseUnitOfWork, MembershipRepository, UserRepository } from '@engineering-os/database';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

async function setupUser(role: OrganisationRole, userId: string) {
  const now = new Date('2026-08-15T08:30:00Z');
  const user = {
    id: randomUUID(),
    userId,
    passwordHash: await hashPassword('Runner-service-password-2026!'),
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

function service() {
  return new AIRunnerService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiRunners: new AIRunnerRepository(pool),
    memberships: new MembershipRepository(pool),
    audit: new AuditRepository(pool)
  });
}

describe('AIRunnerService', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('registers a personal runner with a one-time hash-only platform credential and atomic audit', async () => {
    const member = await setupUser('member', 'runner.member');
    const runners = service();
    const now = new Date('2026-08-15T08:35:00Z');

    const created = await runners.registerRunner({
      organisationId: 'org-001',
      actorUserId: member.id,
      ownership: 'personal',
      ownerUserId: member.id,
      harnessId: 'codex',
      persistentSupported: true,
      capabilities: ['chat', 'tools'],
      now
    });
    expect(created.credential.length).toBeGreaterThan(30);
    const runner = await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId);
    expect(runner).toMatchObject({
      ownership: 'personal',
      ownerUserId: member.id,
      harnessId: 'codex',
      status: 'registered',
      trustState: 'pending'
    });

    const credentials = await pool.query<{ credential_hash: string }>('SELECT credential_hash FROM ai_runner_credentials WHERE runner_id = $1', [created.runnerId]);
    expect(credentials.rows).toHaveLength(1);
    expect(credentials.rows[0]?.credential_hash).toBe(hashOpaqueToken(created.credential));
    expect(credentials.rows[0]?.credential_hash).not.toBe(created.credential);

    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    expect(audits.map(event => event.eventType)).toContain('ai.runner.registered');
    expect(JSON.stringify(audits)).not.toContain(created.credential);
  });
  it('rolls back runner and credential creation when mandatory audit persistence fails', async () => {
    const member = await setupUser('member', 'runner.audit.rollback');
    await pool.query(`
      CREATE FUNCTION reject_runner_registered_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'ai.runner.registered' THEN
          RAISE EXCEPTION 'forced runner audit insert failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_runner_registered_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_runner_registered_audit();
    `);
    try {
      await expect(
        service().registerRunner({
          organisationId: 'org-001',
          actorUserId: member.id,
          ownership: 'personal',
          ownerUserId: member.id,
          harnessId: 'codex',
          persistentSupported: true,
          capabilities: ['chat'],
          now: new Date('2026-08-15T08:36:00Z')
        })
      ).rejects.toThrow('forced runner audit insert failure');
      expect((await pool.query('SELECT id FROM ai_runners')).rowCount).toBe(0);
      expect((await pool.query('SELECT id FROM ai_runner_credentials')).rowCount).toBe(0);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_runner_registered_audit_trigger ON audit_events;
        DROP FUNCTION IF EXISTS reject_runner_registered_audit();
      `);
    }
  });
});
