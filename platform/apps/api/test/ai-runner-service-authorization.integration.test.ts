import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, type OrganisationRole } from '@engineering-os/domain';
import { AIRunnerRepository, AuditRepository, DatabaseUnitOfWork, MembershipRepository, UserRepository } from '@engineering-os/database';
import { AIRunnerService } from '../src/ai-runner-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

async function setupUser(role: OrganisationRole, userId: string) {
  const now = new Date('2026-08-15T08:40:00Z');
  const user = {
    id: randomUUID(),
    userId,
    passwordHash: await hashPassword('Runner-policy-password-2026!'),
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

const runnerInput = {
  organisationId: 'org-001',
  harnessId: 'codex',
  persistentSupported: true,
  capabilities: ['chat', 'tools'],
  now: new Date('2026-08-15T08:45:00Z')
} as const;

describe('AIRunnerService authorization', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('rejects a personal runner whose owner is not the actor', async () => {
    const actor = await setupUser('member', 'runner.actor');
    const other = await setupUser('member', 'runner.other');

    await expect(
      service().registerRunner({
        ...runnerInput,
        actorUserId: actor.id,
        ownership: 'personal',
        ownerUserId: other.id
      })
    ).rejects.toThrow('forbidden');

    expect(await new AIRunnerRepository(pool).listForUser('org-001', other.id)).toHaveLength(0);
  });

  it('rejects organisation-owned runner registration by an ordinary member', async () => {
    const member = await setupUser('member', 'runner.member.org');

    await expect(
      service().registerRunner({
        ...runnerInput,
        actorUserId: member.id,
        ownership: 'organisation'
      })
    ).rejects.toThrow('forbidden');

    expect(await new AIRunnerRepository(pool).listOrganisationRunners('org-001')).toHaveLength(0);
  });

  it('allows an organisation admin to register an organisation-owned runner', async () => {
    const admin = await setupUser('admin', 'runner.admin');
    const created = await service().registerRunner({
      ...runnerInput,
      actorUserId: admin.id,
      ownership: 'organisation'
    });

    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({
      ownership: 'organisation',
      createdBy: admin.id
    });
  });
  it('does not let a member self-assert trust for a personal runner', async () => {
    const member = await setupUser('member', 'runner.trust.member');
    const created = await service().registerRunner({
      ...runnerInput,
      actorUserId: member.id,
      ownership: 'personal',
      ownerUserId: member.id
    });

    await expect(
      service().setRunnerTrust({
        organisationId: 'org-001',
        actorUserId: member.id,
        runnerId: created.runnerId,
        trustState: 'trusted',
        now: new Date('2026-08-15T08:50:00Z')
      })
    ).rejects.toThrow('forbidden');
  });

  it('allows an organisation admin to govern runner trust with audit', async () => {
    const member = await setupUser('member', 'runner.trust.owner');
    const admin = await setupUser('admin', 'runner.trust.admin');
    const created = await service().registerRunner({
      ...runnerInput,
      actorUserId: member.id,
      ownership: 'personal',
      ownerUserId: member.id
    });
    await service().setRunnerTrust({
      organisationId: 'org-001',
      actorUserId: admin.id,
      runnerId: created.runnerId,
      trustState: 'trusted',
      now: new Date('2026-08-15T08:50:00Z')
    });
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ trustState: 'trusted' });
    await service().setRunnerTrust({
      organisationId: 'org-001',
      actorUserId: admin.id,
      runnerId: created.runnerId,
      trustState: 'restricted',
      now: new Date('2026-08-15T08:51:00Z')
    });
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ trustState: 'restricted' });
    await service().setRunnerTrust({
      organisationId: 'org-001',
      actorUserId: admin.id,
      runnerId: created.runnerId,
      trustState: 'revoked',
      now: new Date('2026-08-15T08:52:00Z')
    });
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ trustState: 'revoked' });
    expect(await service().authenticateRunner(created.credential, new Date('2026-08-15T08:53:00Z'))).toBeNull();
    expect((await pool.query('SELECT id FROM ai_runner_credentials WHERE runner_id = $1 AND revoked_at IS NULL', [created.runnerId])).rowCount).toBe(0);
    expect((await new AuditRepository(pool).listByOrganisation('org-001')).map(e => e.eventType)).toContain('ai.runner.trust_changed');
  });
  it('lists only the actor personal runners plus organisation-owned runners', async () => {
    const member = await setupUser('member', 'runner.list.member');
    const other = await setupUser('member', 'runner.list.other');
    const admin = await setupUser('admin', 'runner.list.admin');
    const runners = service();
    const own = await runners.registerRunner({
      ...runnerInput,
      actorUserId: member.id,
      ownership: 'personal',
      ownerUserId: member.id
    });
    await runners.registerRunner({
      ...runnerInput,
      actorUserId: other.id,
      ownership: 'personal',
      ownerUserId: other.id
    });
    const organisation = await runners.registerRunner({
      ...runnerInput,
      actorUserId: admin.id,
      ownership: 'organisation'
    });

    const listed = await runners.listRunners({ organisationId: 'org-001', actorUserId: member.id });
    expect(listed.map(runner => runner.id).sort()).toEqual([own.runnerId, organisation.runnerId].sort());
    expect(JSON.stringify(listed)).not.toContain('credentialHash');
  });
  it('enforces owner/admin lifecycle control for organisation-owned runners', async () => {
    const admin = await setupUser('admin', 'runner.lifecycle.admin');
    const owner = await setupUser('owner', 'runner.lifecycle.owner');
    const member = await setupUser('member', 'runner.lifecycle.member');
    const runners = service();
    const created = await runners.registerRunner({
      ...runnerInput,
      actorUserId: admin.id,
      ownership: 'organisation'
    });

    await expect(runners.rotateRunnerCredential({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');
    await expect(runners.disableRunner({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');
    await expect(runners.revokeRunner({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');

    const rotated = await runners.rotateRunnerCredential({
      organisationId: 'org-001',
      actorUserId: owner.id,
      runnerId: created.runnerId,
      now: new Date('2026-08-15T08:55:00Z')
    });
    expect(await runners.authenticateRunner(created.credential, new Date('2026-08-15T08:56:00Z'))).toBeNull();
    expect(await runners.authenticateRunner(rotated.credential, new Date('2026-08-15T08:56:00Z'))).not.toBeNull();
    await runners.disableRunner({ organisationId: 'org-001', actorUserId: admin.id, runnerId: created.runnerId, now: new Date('2026-08-15T08:57:00Z') });
    expect(await runners.authenticateRunner(rotated.credential, new Date('2026-08-15T08:58:00Z'))).toBeNull();
    await runners.revokeRunner({ organisationId: 'org-001', actorUserId: owner.id, runnerId: created.runnerId, now: new Date('2026-08-15T08:59:00Z') });
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ status: 'revoked' });
  });

  it('denies runner administration after the actor organisation membership is revoked', async () => {
    const member = await setupUser('member', 'runner.revoked.member');
    const runners = service();
    const created = await runners.registerRunner({
      ...runnerInput,
      actorUserId: member.id,
      ownership: 'personal',
      ownerUserId: member.id
    });
    await new MembershipRepository(pool).revokeOrganisation('org-001', member.id, new Date('2026-08-15T08:54:00Z'));

    await expect(runners.listRunners({ organisationId: 'org-001', actorUserId: member.id })).rejects.toThrow('forbidden');
    await expect(runners.rotateRunnerCredential({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');
    await expect(runners.disableRunner({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');
    await expect(runners.revokeRunner({ organisationId: 'org-001', actorUserId: member.id, runnerId: created.runnerId })).rejects.toThrow('forbidden');
    expect(await new AIRunnerRepository(pool).getRunner('org-001', created.runnerId)).toMatchObject({ status: 'registered' });
  });
});
