import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AIConnectionRepository,
  AuditRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  UserRepository,
} from '@engineering-os/database';
import type { OrganisationRole } from '@engineering-os/domain';
import { AIConnectionService, AIConnectionServiceError } from '../src/ai-connection-service.js';
import {
  createConnectionFamilyPolicyRegistry,
  type ConnectionFamilyPolicyRegistry,
  type TrustedConnectionFamilyPolicy,
} from '../src/ai-connection-policy.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const TEST_POLICIES: readonly TrustedConnectionFamilyPolicy[] = [
  {
    id: 'test-personal',
    providerId: 'test',
    displayName: 'Test Personal',
    executionMode: 'subscription',
    harnessId: 'test-harness',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'test-org-api',
    providerId: 'test',
    displayName: 'Test Organisation API',
    executionMode: 'api',
    allowedOwnership: ['organisation'],
    credentialStrategies: ['external_secret_ref'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'test-org-none',
    providerId: 'test',
    displayName: 'Test Organisation No Creds',
    executionMode: 'api',
    allowedOwnership: ['organisation'],
    credentialStrategies: ['none'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
];

function makeRegistry(): ConnectionFamilyPolicyRegistry {
  return createConnectionFamilyPolicyRegistry(TEST_POLICIES);
}

async function seedUser(userId: string): Promise<{ id: string; userId: string }> {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id,
    userId,
    passwordHash: 'scrypt$test$hash',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return { id, userId };
}

async function seedMember(
  organisationId: string,
  userId: string,
  role: OrganisationRole = 'member',
  status: 'active' | 'revoked' = 'active',
): Promise<void> {
  const now = new Date();
  await pool.query(
    `INSERT INTO organisation_memberships
      (organisation_id, user_id, role, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'bootstrap', $5, $5)`,
    [organisationId, userId, role, status, now],
  );
}

function makeService(registry: ConnectionFamilyPolicyRegistry = makeRegistry()) {
  return new AIConnectionService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool),
    policy: registry,
  });
}

async function expectServiceError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error('expected AIConnectionServiceError with code ' + code);
  } catch (error) {
    expect(error).toBeInstanceOf(AIConnectionServiceError);
    expect((error as AIConnectionServiceError).code).toBe(code);
  }
}

describe('AIConnectionService', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('registers a personal connection owned by the actor with no credentials', async () => {
    const actor = await seedUser('personal.actor');
    await seedMember('org-001', actor.id, 'member');
    const service = makeService();

    const summary = await service.registerPersonalConnection({
      organisationId: 'org-001',
      actorUserId: actor.id,
      connectionFamilyId: 'test-personal',
    });

    expect(summary.ownership).toBe('personal');
    expect(summary.ownerUserId).toBe(actor.id);
    expect(summary.providerId).toBe('test');
    expect(summary.connectionFamilyId).toBe('test-personal');
    expect(summary.credentialStrategy).toBe('runner_managed');
    expect(summary.status).toBe('configured');
    expect(summary.credentialConfigured).toBe(false);
    expect((summary as unknown as Record<string, unknown>).secretRefId).toBeUndefined();

    const persisted = await new AIConnectionRepository(pool).getConnection('org-001', summary.id);
    expect(persisted?.ownerUserId).toBe(actor.id);
    expect(persisted?.secretRefId).toBeUndefined();

    const shares = await pool.query(
      'SELECT id FROM ai_connection_project_shares WHERE connection_id = $1',
      [summary.id],
    );
    expect(shares.rowCount).toBe(0);
  });

  it('rejects registration by a non-member and by a revoked member', async () => {
    const nonMember = await seedUser('non.member');
    const revoked = await seedUser('revoked.member');
    await seedMember('org-001', revoked.id, 'member', 'revoked');
    const service = makeService();

    await expectServiceError(
      service.registerPersonalConnection({
        organisationId: 'org-001',
        actorUserId: nonMember.id,
        connectionFamilyId: 'test-personal',
      }),
      'forbidden',
    );
    await expectServiceError(
      service.registerPersonalConnection({
        organisationId: 'org-001',
        actorUserId: revoked.id,
        connectionFamilyId: 'test-personal',
      }),
      'forbidden',
    );
    await expectServiceError(
      service.listConnections({ organisationId: 'org-001', actorUserId: nonMember.id }),
      'forbidden',
    );
  });

  it('fails closed on unknown family and on mismatched-ownership family', async () => {
    const actor = await seedUser('closed.actor');
    await seedMember('org-001', actor.id, 'admin');
    const service = makeService();

    await expectServiceError(
      service.registerPersonalConnection({
        organisationId: 'org-001',
        actorUserId: actor.id,
        connectionFamilyId: 'unknown-family',
      }),
      'policy_blocked',
    );
    await expectServiceError(
      service.registerPersonalConnection({
        organisationId: 'org-001',
        actorUserId: actor.id,
        connectionFamilyId: 'test-org-api',
      }),
      'policy_blocked',
    );
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: actor.id,
        connectionFamilyId: 'test-personal',
        secretRefId: 'vault:x',
      }),
      'policy_blocked',
    );
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: actor.id,
        connectionFamilyId: 'unknown-family',
        secretRefId: 'vault:x',
      }),
      'policy_blocked',
    );
  });

  it('forbids ordinary member from registering organisation connection but permits admin/owner', async () => {
    const member = await seedUser('member.only');
    const admin = await seedUser('org.admin');
    const owner = await seedUser('org.owner');
    await seedMember('org-001', member.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    await seedMember('org-001', owner.id, 'owner');
    const service = makeService();

    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: member.id,
        connectionFamilyId: 'test-org-api',
        secretRefId: 'vault:member-attempt',
      }),
      'forbidden',
    );

    const adminSummary = await service.registerOrganisationConnection({
      organisationId: 'org-001',
      actorUserId: admin.id,
      connectionFamilyId: 'test-org-api',
      secretRefId: 'vault:admin-created',
    });
    expect(adminSummary.ownership).toBe('organisation');
    expect(adminSummary.ownerUserId).toBeUndefined();
    expect(adminSummary.credentialStrategy).toBe('external_secret_ref');
    expect(adminSummary.credentialConfigured).toBe(true);
    expect((adminSummary as unknown as Record<string, unknown>).secretRefId).toBeUndefined();

    const ownerSummary = await service.registerOrganisationConnection({
      organisationId: 'org-001',
      actorUserId: owner.id,
      connectionFamilyId: 'test-org-none',
    });
    expect(ownerSummary.credentialStrategy).toBe('none');
    expect(ownerSummary.credentialConfigured).toBe(false);
  });

  it('requires nonblank secretRefId when policy demands external_secret_ref', async () => {
    const admin = await seedUser('secret.admin');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();

    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: admin.id,
        connectionFamilyId: 'test-org-api',
      }),
      'policy_blocked',
    );
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: admin.id,
        connectionFamilyId: 'test-org-api',
        secretRefId: '   ',
      }),
      'policy_blocked',
    );
  });

  it('lists caller personal connections plus org connections as safe summaries only', async () => {
    const actor = await seedUser('list.actor');
    const other = await seedUser('list.other');
    const admin = await seedUser('list.admin');
    await seedMember('org-001', actor.id, 'member');
    await seedMember('org-001', other.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();

    const actorPersonal = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actor.id, connectionFamilyId: 'test-personal',
    });
    await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: other.id, connectionFamilyId: 'test-personal',
    });
    const org = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id,
      connectionFamilyId: 'test-org-api', secretRefId: 'vault:list',
    });

    const listing = await service.listConnections({ organisationId: 'org-001', actorUserId: actor.id });
    const ids = listing.map((c) => c.id);
    expect(ids).toContain(actorPersonal.id);
    expect(ids).toContain(org.id);
    // does NOT contain other user's personal connection
    expect(listing.every((c) => c.ownership !== 'personal' || c.ownerUserId === actor.id)).toBe(true);

    const serialized = JSON.stringify(listing);
    expect(serialized).not.toContain('vault:list');
    expect(serialized).not.toContain('secretRefId');
    const orgEntry = listing.find((c) => c.id === org.id);
    expect(orgEntry?.credentialConfigured).toBe(true);
    const personalEntry = listing.find((c) => c.id === actorPersonal.id);
    expect(personalEntry?.credentialConfigured).toBe(false);
  });

  it('audit metadata never contains secretRefId or credential material', async () => {
    const admin = await seedUser('audit.admin');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();

    const summary = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id,
      connectionFamilyId: 'test-org-api', secretRefId: 'vault:top-secret-42',
    });

    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    const registration = audits.find((event) => event.subjectId === summary.id);
    expect(registration?.eventType).toBe('ai.connection.organisation.registered');
    const meta = JSON.stringify(registration?.metadata ?? {});
    expect(meta).not.toContain('vault:top-secret-42');
    expect(meta).not.toContain('secretRefId');
    expect(meta).not.toContain('secret_ref_id');
    expect((registration?.metadata as Record<string, unknown> | undefined)?.secretRefId).toBeUndefined();
  });

  it('emits ai.connection.personal.registered audit for personal registration', async () => {
    const actor = await seedUser('audit.personal');
    await seedMember('org-001', actor.id, 'member');
    const service = makeService();
    const summary = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actor.id, connectionFamilyId: 'test-personal',
    });
    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    const registered = audits.find((event) => event.subjectId === summary.id);
    expect(registered?.eventType).toBe('ai.connection.personal.registered');
    expect(registered?.actorId).toBe(actor.id);
    expect(registered?.metadata).toMatchObject({
      ownership: 'personal',
      connectionFamilyId: 'test-personal',
      providerId: 'test',
      status: 'configured',
    });
  });

  it('personal-connection revocation is owner-only; admin cannot seize personal, but can revoke org', async () => {
    const actor = await seedUser('revoker.actor');
    const other = await seedUser('revoker.other');
    const admin = await seedUser('revoker.admin');
    await seedMember('org-001', actor.id, 'member');
    await seedMember('org-001', other.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();

    const personal = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actor.id, connectionFamilyId: 'test-personal',
    });
    const org = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id,
      connectionFamilyId: 'test-org-api', secretRefId: 'vault:org-conn',
    });

    await expectServiceError(
      service.revokeConnection({ organisationId: 'org-001', actorUserId: other.id, connectionId: personal.id }),
      'forbidden',
    );
    await expectServiceError(
      service.revokeConnection({ organisationId: 'org-001', actorUserId: admin.id, connectionId: personal.id }),
      'forbidden',
    );

    await service.revokeConnection({ organisationId: 'org-001', actorUserId: actor.id, connectionId: personal.id });
    const personalPersisted = await new AIConnectionRepository(pool).getConnection('org-001', personal.id);
    expect(personalPersisted?.status).toBe('revoked');
    expect(personalPersisted?.revokedAt).toBeInstanceOf(Date);

    // Re-revoke is a conflict
    await expectServiceError(
      service.revokeConnection({ organisationId: 'org-001', actorUserId: actor.id, connectionId: personal.id }),
      'conflict',
    );

    // ordinary member cannot revoke org connection
    await expectServiceError(
      service.revokeConnection({ organisationId: 'org-001', actorUserId: actor.id, connectionId: org.id }),
      'forbidden',
    );
    await service.revokeConnection({ organisationId: 'org-001', actorUserId: admin.id, connectionId: org.id });

    // no DELETE — both rows still exist
    const rows = await pool.query(
      'SELECT id, status FROM ai_connections WHERE organisation_id = $1 ORDER BY id',
      ['org-001'],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.every((row) => row.status === 'revoked')).toBe(true);

    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    const revocations = audits.filter((event) => event.eventType === 'ai.connection.revoked');
    expect(revocations.map((e) => e.subjectId).sort()).toEqual([personal.id, org.id].sort());
  });

  it('returns not_found for unknown connection id in revocation', async () => {
    const actor = await seedUser('nf.actor');
    await seedMember('org-001', actor.id, 'owner');
    const service = makeService();
    await expectServiceError(
      service.revokeConnection({
        organisationId: 'org-001', actorUserId: actor.id, connectionId: randomUUID(),
      }),
      'not_found',
    );
  });

  it('rejects personal registration when policy only offers environment strategy', async () => {
    const actor = await seedUser('env.only.actor');
    await seedMember('org-001', actor.id, 'member');
    const registry = createConnectionFamilyPolicyRegistry([
      {
        id: 'personal-env-only',
        providerId: 'test',
        displayName: 'Personal env-only',
        executionMode: 'subscription',
        harnessId: 'test-harness',
        allowedOwnership: ['personal'],
        credentialStrategies: ['environment'],
        delegatable: false,
        requiresRunner: false,
        persistentSupported: false,
      },
    ]);
    const service = makeService(registry);
    await expectServiceError(
      service.registerPersonalConnection({
        organisationId: 'org-001',
        actorUserId: actor.id,
        connectionFamilyId: 'personal-env-only',
      }),
      'policy_blocked',
    );
  });

  it('permits personal registration when the sole strategy is runner_managed or none', async () => {
    const actorRunner = await seedUser('personal.runner');
    const actorNone = await seedUser('personal.none');
    await seedMember('org-001', actorRunner.id, 'member');
    await seedMember('org-001', actorNone.id, 'member');
    const registry = createConnectionFamilyPolicyRegistry([
      {
        id: 'personal-runner',
        providerId: 'test',
        displayName: 'Personal runner-only',
        executionMode: 'subscription',
        harnessId: 'test-harness',
        allowedOwnership: ['personal'],
        credentialStrategies: ['runner_managed'],
        delegatable: false,
        requiresRunner: false,
        persistentSupported: false,
      },
      {
        id: 'personal-none',
        providerId: 'test',
        displayName: 'Personal none-only',
        executionMode: 'subscription',
        harnessId: 'test-harness',
        allowedOwnership: ['personal'],
        credentialStrategies: ['none'],
        delegatable: false,
        requiresRunner: false,
        persistentSupported: false,
      },
    ]);
    const service = makeService(registry);
    const runner = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actorRunner.id, connectionFamilyId: 'personal-runner',
    });
    expect(runner.credentialStrategy).toBe('runner_managed');
    const none = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actorNone.id, connectionFamilyId: 'personal-none',
    });
    expect(none.credentialStrategy).toBe('none');
  });

  it('rejects organisation registration without secretRefId when policy allows multiple non-secret strategies', async () => {
    const admin = await seedUser('multi.strat.admin');
    await seedMember('org-001', admin.id, 'admin');
    const registry = createConnectionFamilyPolicyRegistry([
      {
        id: 'org-multi-nonsecret',
        providerId: 'test',
        displayName: 'Org multi non-secret',
        executionMode: 'api',
        allowedOwnership: ['organisation'],
        credentialStrategies: ['none', 'environment'],
        delegatable: false,
        requiresRunner: false,
        persistentSupported: false,
      },
      {
        id: 'org-runner-env',
        providerId: 'test',
        displayName: 'Org runner+env',
        executionMode: 'api',
        allowedOwnership: ['organisation'],
        credentialStrategies: ['runner_managed', 'environment'],
        delegatable: false,
        requiresRunner: false,
        persistentSupported: false,
      },
    ]);
    const service = makeService(registry);
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001', actorUserId: admin.id, connectionFamilyId: 'org-multi-nonsecret',
      }),
      'policy_blocked',
    );
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001', actorUserId: admin.id, connectionFamilyId: 'org-runner-env',
      }),
      'policy_blocked',
    );
    const persisted = await pool.query(
      `SELECT id FROM ai_connections WHERE organisation_id = 'org-001'`,
    );
    expect(persisted.rowCount).toBe(0);
  });

  it('permits organisation registration when policy allows exactly one non-secret strategy', async () => {
    const admin = await seedUser('single.strat.admin');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();
    const summary = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id, connectionFamilyId: 'test-org-none',
    });
    expect(summary.credentialStrategy).toBe('none');
    expect(summary.credentialConfigured).toBe(false);
  });

  it('rejects organisation registration with secretRefId when external_secret_ref is not allowed', async () => {
    const admin = await seedUser('extsec.admin');
    await seedMember('org-001', admin.id, 'admin');
    const service = makeService();
    await expectServiceError(
      service.registerOrganisationConnection({
        organisationId: 'org-001',
        actorUserId: admin.id,
        connectionFamilyId: 'test-org-none',
        secretRefId: 'vault:should-not-attach',
      }),
      'policy_blocked',
    );
  });

  it('rolls back registration when audit append fails inside the transaction', async () => {
    const actor = await seedUser('rollback.reg');
    await seedMember('org-001', actor.id, 'member');
    const service = makeService();

    await pool.query(`
      CREATE FUNCTION reject_ai_reg_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'ai.connection.personal.registered' THEN
          RAISE EXCEPTION 'forced ai registration audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_ai_reg_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_ai_reg_audit();
    `);

    try {
      await expect(
        service.registerPersonalConnection({
          organisationId: 'org-001', actorUserId: actor.id, connectionFamilyId: 'test-personal',
        }),
      ).rejects.toThrow(/forced ai registration audit failure/);
      const persisted = await pool.query(
        `SELECT id FROM ai_connections WHERE organisation_id = 'org-001'`,
      );
      expect(persisted.rowCount).toBe(0);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_ai_reg_audit_trigger ON audit_events;
        DROP FUNCTION IF EXISTS reject_ai_reg_audit();
      `);
    }
  });

  it('rolls back revocation when audit append fails inside the transaction', async () => {
    const actor = await seedUser('rollback.rev');
    await seedMember('org-001', actor.id, 'member');
    const service = makeService();
    const summary = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: actor.id, connectionFamilyId: 'test-personal',
    });

    await pool.query(`
      CREATE FUNCTION reject_ai_rev_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'ai.connection.revoked' THEN
          RAISE EXCEPTION 'forced ai revocation audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_ai_rev_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_ai_rev_audit();
    `);

    try {
      await expect(
        service.revokeConnection({
          organisationId: 'org-001', actorUserId: actor.id, connectionId: summary.id,
        }),
      ).rejects.toThrow(/forced ai revocation audit failure/);
      const persisted = await new AIConnectionRepository(pool).getConnection('org-001', summary.id);
      expect(persisted?.status).toBe('configured');
      expect(persisted?.revokedAt).toBeUndefined();
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_ai_rev_audit_trigger ON audit_events;
        DROP FUNCTION IF EXISTS reject_ai_rev_audit();
      `);
    }
  });
});
