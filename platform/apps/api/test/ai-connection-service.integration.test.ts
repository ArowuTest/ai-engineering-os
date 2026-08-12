import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AIConnectionRepository,
  AuditRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  ProjectRepository,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import type { ModelAdapter, ModelRoute } from '@engineering-os/model-gateway';
import type { OrganisationRole } from '@engineering-os/domain';
import { createHash, randomBytes } from 'node:crypto';
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
    id: 'test-personal-delegatable',
    providerId: 'test',
    displayName: 'Test Personal Delegatable',
    executionMode: 'subscription',
    harnessId: 'test-harness',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: true,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'test-personal-persistent',
    providerId: 'test',
    displayName: 'Test Personal Persistent',
    executionMode: 'subscription',
    harnessId: 'test-harness',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: true,
    requiresRunner: false,
    persistentSupported: true,
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

function makeService(
  registry: ConnectionFamilyPolicyRegistry = makeRegistry(),
  modelGateway: ModelGateway = new ModelGateway(),
) {
  return new AIConnectionService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    aiConnections: new AIConnectionRepository(pool),
    memberships: new MembershipRepository(pool),
    projects: new ProjectRepository(pool),
    sessions: new SessionRepository(pool),
    policy: registry,
    modelGateway,
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

  // ---------- Task 4: project sharing modes and owner usage windows ----------

  async function seedProject(organisationId: string, name = 'project A'): Promise<string> {
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

  async function seedProjectMembership(
    organisationId: string,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await pool.query(
      `INSERT INTO project_memberships
        (organisation_id, project_id, user_id, role, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'contributor', 'active', 'bootstrap', $4, $4)`,
      [organisationId, projectId, userId, now],
    );
  }

  async function registerDelegatablePersonal(
    service: AIConnectionService,
    orgId: string,
    actorId: string,
    familyId = 'test-personal-delegatable',
  ) {
    return service.registerPersonalConnection({
      organisationId: orgId,
      actorUserId: actorId,
      connectionFamilyId: familyId,
    });
  }

  it('absence of any share means Do Not Share (no rows)', async () => {
    const owner = await seedUser('share.doi.owner');
    await seedMember('org-001', owner.id, 'member');
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    const rows = await pool.query(
      `SELECT id FROM ai_connection_project_shares WHERE connection_id = $1`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('first share always creates an active online_only row (signature has no mode)', async () => {
    const owner = await seedUser('share.first.owner');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);

    await service.shareConnectionWithProject({
      organisationId: 'org-001',
      actorUserId: owner.id,
      projectId,
      connectionId: conn.id,
    });

    const rows = await pool.query(
      `SELECT mode, revoked_at FROM ai_connection_project_shares
       WHERE organisation_id = 'org-001' AND project_id = $1 AND connection_id = $2`,
      [projectId, conn.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].mode).toBe('online_only');
    expect(rows.rows[0].revoked_at).toBeNull();
  });

  it('sharing a nondelegatable family fails closed with policy_blocked', async () => {
    const owner = await seedUser('share.nondelegatable');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    // 'test-personal' has delegatable: false
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001',
      actorUserId: owner.id,
      connectionFamilyId: 'test-personal',
    });
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      }),
      'policy_blocked',
    );
  });

  it('sharing project A does not create share for project B', async () => {
    const owner = await seedUser('share.scope.owner');
    await seedMember('org-001', owner.id, 'member');
    const projectA = await seedProject('org-001', 'A');
    const projectB = await seedProject('org-001', 'B');
    await seedProjectMembership('org-001', projectA, owner.id);
    await seedProjectMembership('org-001', projectB, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId: projectA, connectionId: conn.id,
    });
    const rows = await pool.query(
      `SELECT project_id FROM ai_connection_project_shares WHERE connection_id = $1`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].project_id).toBe(projectA);
  });

  it('non-owner cannot enable/mode-change/revoke another persons share (including org admin)', async () => {
    const owner = await seedUser('share.owner.only');
    const other = await seedUser('share.other');
    const admin = await seedUser('share.admin');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', other.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, other.id);
    // admin is not project member; still forbidden for another user's share
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);

    // other member cannot enable share on someone else's connection
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: other.id, projectId, connectionId: conn.id,
      }),
      'forbidden',
    );
    // admin also cannot opt owner's connection in
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
      }),
      'forbidden',
    );

    // now owner enables share, then non-owners cannot switch mode or revoke
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await expectServiceError(
      service.setProjectShareMode({
        organisationId: 'org-001', actorUserId: other.id, projectId, connectionId: conn.id, mode: 'persistent',
      }),
      'forbidden',
    );
    await expectServiceError(
      service.setProjectShareMode({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id, mode: 'persistent',
      }),
      'forbidden',
    );
    await expectServiceError(
      service.revokeProjectShare({
        organisationId: 'org-001', actorUserId: other.id, projectId, connectionId: conn.id,
      }),
      'forbidden',
    );
    await expectServiceError(
      service.revokeProjectShare({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
      }),
      'forbidden',
    );
  });

  it('ordinary owner without project access cannot share; org owner sharing own connection may access project', async () => {
    const memberOwner = await seedUser('share.member.owner');
    const orgOwner = await seedUser('share.org.owner');
    await seedMember('org-001', memberOwner.id, 'member');
    await seedMember('org-001', orgOwner.id, 'owner');
    const projectId = await seedProject('org-001');
    // memberOwner has NO project membership
    const service = makeService();
    const memberConn = await registerDelegatablePersonal(service, 'org-001', memberOwner.id);
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: memberOwner.id, projectId, connectionId: memberConn.id,
      }),
      'forbidden',
    );

    // Org owner has implicit project access
    const ownerConn = await registerDelegatablePersonal(service, 'org-001', orgOwner.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: orgOwner.id, projectId, connectionId: ownerConn.id,
    });
    const row = await pool.query(
      `SELECT mode FROM ai_connection_project_shares WHERE connection_id = $1 AND revoked_at IS NULL`,
      [ownerConn.id],
    );
    expect(row.rowCount).toBe(1);
  });

  it('persistent mode: unsupported family -> policy_blocked; supported family swaps rows preserving history', async () => {
    const owner = await seedUser('share.persistent.owner');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();

    // family without persistentSupported
    const noPersistConn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-delegatable');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: noPersistConn.id,
    });
    await expectServiceError(
      service.setProjectShareMode({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: noPersistConn.id, mode: 'persistent',
      }),
      'policy_blocked',
    );

    // family with persistentSupported
    const persistConn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-persistent');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: persistConn.id,
    });
    await service.setProjectShareMode({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: persistConn.id, mode: 'persistent',
    });

    const rows = await pool.query(
      `SELECT id, mode, revoked_at FROM ai_connection_project_shares
       WHERE connection_id = $1 ORDER BY created_at ASC`,
      [persistConn.id],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].mode).toBe('online_only');
    expect(rows.rows[0].revoked_at).not.toBeNull();
    expect(rows.rows[1].mode).toBe('persistent');
    expect(rows.rows[1].revoked_at).toBeNull();
  });

  it('setProjectShareMode with unknown mode is rejected', async () => {
    const owner = await seedUser('share.mode.invalid');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-persistent');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await expectServiceError(
      service.setProjectShareMode({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
        mode: 'weird_mode' as unknown as 'persistent',
      }),
      'policy_blocked',
    );
  });

  it('usage window round-trips valid values and rejects inverted windows', async () => {
    const owner = await seedUser('share.window.owner');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);

    const from = new Date('2026-08-01T00:00:00.000Z');
    const until = new Date('2026-08-31T00:00:00.000Z');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom: from, availableUntil: until },
    });
    const row = await pool.query(
      `SELECT available_from, available_until FROM ai_connection_project_shares
       WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(new Date(row.rows[0].available_from).toISOString()).toBe(from.toISOString());
    expect(new Date(row.rows[0].available_until).toISOString()).toBe(until.toISOString());

    await expectServiceError(
      service.updateProjectShareUsagePolicy({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
        usagePolicy: { availableFrom: until, availableUntil: from },
      }),
      'policy_blocked',
    );
  });

  it('org admin can only narrow existing usage window (never widen or clear); owner can change freely', async () => {
    const owner = await seedUser('share.win.owner');
    const admin = await seedUser('share.win.admin');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    const from = new Date('2026-08-10T00:00:00.000Z');
    const until = new Date('2026-08-20T00:00:00.000Z');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom: from, availableUntil: until },
    });

    // admin cannot widen (earlier availableFrom)
    await expectServiceError(
      service.updateProjectShareUsagePolicy({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
        usagePolicy: { availableFrom: new Date('2026-08-05T00:00:00.000Z'), availableUntil: until },
      }),
      'forbidden',
    );
    // admin cannot widen (later availableUntil)
    await expectServiceError(
      service.updateProjectShareUsagePolicy({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
        usagePolicy: { availableFrom: from, availableUntil: new Date('2026-08-25T00:00:00.000Z') },
      }),
      'forbidden',
    );
    // admin cannot clear
    await expectServiceError(
      service.updateProjectShareUsagePolicy({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
        usagePolicy: {},
      }),
      'forbidden',
    );

    // admin CAN narrow (later availableFrom, earlier availableUntil)
    await service.updateProjectShareUsagePolicy({
      organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: conn.id,
      usagePolicy: {
        availableFrom: new Date('2026-08-12T00:00:00.000Z'),
        availableUntil: new Date('2026-08-18T00:00:00.000Z'),
      },
    });
    let row = await pool.query(
      `SELECT available_from, available_until FROM ai_connection_project_shares
       WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(new Date(row.rows[0].available_from).toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(new Date(row.rows[0].available_until).toISOString()).toBe('2026-08-18T00:00:00.000Z');

    // owner can widen back
    await service.updateProjectShareUsagePolicy({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom: from, availableUntil: until },
    });
    row = await pool.query(
      `SELECT available_from, available_until FROM ai_connection_project_shares
       WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(new Date(row.rows[0].available_from).toISOString()).toBe(from.toISOString());
    expect(new Date(row.rows[0].available_until).toISOString()).toBe(until.toISOString());

    // owner can clear
    await service.updateProjectShareUsagePolicy({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: {},
    });
    row = await pool.query(
      `SELECT available_from, available_until FROM ai_connection_project_shares
       WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(row.rows[0].available_from).toBeNull();
    expect(row.rows[0].available_until).toBeNull();
  });

  it('revoke removes active share and preserves history; re-share creates a new online_only row', async () => {
    const owner = await seedUser('share.revoker');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-persistent');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await service.setProjectShareMode({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id, mode: 'persistent',
    });
    await service.revokeProjectShare({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    let rows = await pool.query(
      `SELECT id, mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1 ORDER BY created_at`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.every((r) => r.revoked_at !== null)).toBe(true);

    // re-share -> new active online_only row
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    rows = await pool.query(
      `SELECT mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1 ORDER BY created_at`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(3);
    const active = rows.rows.filter((r) => r.revoked_at === null);
    expect(active.length).toBe(1);
    expect(active[0].mode).toBe('online_only');
  });

  it('conflict when trying to enable share while active share already exists', async () => {
    const owner = await seedUser('share.conflict');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      }),
      'conflict',
    );
  });

  it('revoked personal connection cannot be shared', async () => {
    const owner = await seedUser('share.revoked.conn');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    await service.revokeConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionId: conn.id,
    });
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      }),
      'conflict',
    );
  });

  it('org-scoped connection cannot be shared as a personal project share', async () => {
    const admin = await seedUser('share.org.only');
    await seedMember('org-001', admin.id, 'admin');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, admin.id);
    const service = makeService();
    const orgConn = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id,
      connectionFamilyId: 'test-org-api', secretRefId: 'vault:x',
    });
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: admin.id, projectId, connectionId: orgConn.id,
      }),
      'forbidden',
    );
  });

  it('project must belong to same organisation as connection', async () => {
    const owner = await seedUser('share.cross.org');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-002', owner.id, 'member');
    const projectInOrg2 = await seedProject('org-002');
    await seedProjectMembership('org-002', projectInOrg2, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id);
    await expectServiceError(
      service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: owner.id,
        projectId: projectInOrg2, connectionId: conn.id,
      }),
      'not_found',
    );
  });

  it('emits ai.connection.project_share.enabled|mode_changed|policy_changed|revoked audit events', async () => {
    const owner = await seedUser('share.audit.owner');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-persistent');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await service.setProjectShareMode({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id, mode: 'persistent',
    });
    await service.updateProjectShareUsagePolicy({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom: new Date('2026-08-15T00:00:00.000Z') },
    });
    await service.revokeProjectShare({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });

    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    const types = audits.map((e) => e.eventType);
    expect(types).toContain('ai.connection.project_share.enabled');
    expect(types).toContain('ai.connection.project_share.mode_changed');
    expect(types).toContain('ai.connection.project_share.policy_changed');
    expect(types).toContain('ai.connection.project_share.revoked');
  });

  it('audit failure rolls back share enable/mode/policy/revoke', async () => {
    const owner = await seedUser('share.audit.rollback');
    await seedMember('org-001', owner.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    const service = makeService();
    const conn = await registerDelegatablePersonal(service, 'org-001', owner.id, 'test-personal-persistent');

    async function withBlockingTrigger(eventType: string, work: () => Promise<void>) {
      await pool.query(`
        CREATE FUNCTION reject_share_audit()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type = '${eventType}' THEN
            RAISE EXCEPTION 'forced share audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER reject_share_audit_trigger
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_share_audit();
      `);
      try {
        await expect(work()).rejects.toThrow(/forced share audit failure/);
      } finally {
        await pool.query(`
          DROP TRIGGER IF EXISTS reject_share_audit_trigger ON audit_events;
          DROP FUNCTION IF EXISTS reject_share_audit();
        `);
      }
    }

    await withBlockingTrigger('ai.connection.project_share.enabled', async () => {
      await service.shareConnectionWithProject({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      });
    });
    let rows = await pool.query(
      `SELECT id FROM ai_connection_project_shares WHERE connection_id = $1`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(0);

    // Enable for real so subsequent operations have a target
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    const activeIdBefore = (
      await pool.query(
        `SELECT id FROM ai_connection_project_shares
         WHERE connection_id = $1 AND revoked_at IS NULL`,
        [conn.id],
      )
    ).rows[0].id;

    await withBlockingTrigger('ai.connection.project_share.mode_changed', async () => {
      await service.setProjectShareMode({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id, mode: 'persistent',
      });
    });
    rows = await pool.query(
      `SELECT id, mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].id).toBe(activeIdBefore);
    expect(rows.rows[0].mode).toBe('online_only');
    expect(rows.rows[0].revoked_at).toBeNull();

    await withBlockingTrigger('ai.connection.project_share.policy_changed', async () => {
      await service.updateProjectShareUsagePolicy({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
        usagePolicy: { availableFrom: new Date('2026-08-15T00:00:00.000Z') },
      });
    });
    rows = await pool.query(
      `SELECT available_from FROM ai_connection_project_shares WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(rows.rows[0].available_from).toBeNull();

    await withBlockingTrigger('ai.connection.project_share.revoked', async () => {
      await service.revokeProjectShare({
        organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      });
    });
    rows = await pool.query(
      `SELECT id FROM ai_connection_project_shares WHERE connection_id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  // ---------- Task 5: project execution-pool eligibility and tier ordering ----------

  async function seedActiveSession(userId: string, expiresAt = new Date(Date.now() + 60 * 60 * 1000)) {
    await new SessionRepository(pool).create({
      id: randomUUID(),
      userId,
      tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
      createdAt: new Date(Date.now() - 1000),
      expiresAt,
    });
  }

  async function setConnectionStatusRaw(
    organisationId: string,
    connectionId: string,
    status: 'configured' | 'available' | 'reauth_required' | 'disabled' | 'revoked',
  ) {
    await pool.query(
      `UPDATE ai_connections SET status = $3, updated_at = now() WHERE organisation_id = $1 AND id = $2`,
      [organisationId, connectionId, status],
    );
  }

  const POOL_TEST_POLICIES: readonly TrustedConnectionFamilyPolicy[] = [
    {
      id: 'pool-personal-online',
      providerId: 'test',
      displayName: 'Pool Personal Online-only',
      executionMode: 'subscription',
      harnessId: 'test',
      allowedOwnership: ['personal'],
      credentialStrategies: ['runner_managed'],
      delegatable: true,
      requiresRunner: false,
      persistentSupported: false,
    },
    {
      id: 'pool-personal-persistent',
      providerId: 'test',
      displayName: 'Pool Personal Persistent',
      executionMode: 'subscription',
      harnessId: 'test',
      allowedOwnership: ['personal'],
      credentialStrategies: ['runner_managed'],
      delegatable: true,
      requiresRunner: false,
      persistentSupported: true,
    },
    {
      id: 'pool-personal-runner',
      providerId: 'test',
      displayName: 'Pool Personal Runner Required',
      executionMode: 'subscription',
      harnessId: 'test',
      allowedOwnership: ['personal'],
      credentialStrategies: ['runner_managed'],
      delegatable: true,
      requiresRunner: true,
      persistentSupported: false,
    },
    {
      id: 'pool-personal-nondel',
      providerId: 'test',
      displayName: 'Pool Personal Nondelegatable',
      executionMode: 'subscription',
      harnessId: 'test',
      allowedOwnership: ['personal'],
      credentialStrategies: ['runner_managed'],
      delegatable: false,
      requiresRunner: false,
      persistentSupported: false,
    },
    {
      id: 'pool-org-api',
      providerId: 'test',
      displayName: 'Pool Org API',
      executionMode: 'api',
      allowedOwnership: ['organisation'],
      credentialStrategies: ['external_secret_ref'],
      delegatable: false,
      requiresRunner: false,
      persistentSupported: false,
    },
    {
      id: 'pool-org-runner',
      providerId: 'test',
      displayName: 'Pool Org Runner Required',
      executionMode: 'api',
      allowedOwnership: ['organisation'],
      credentialStrategies: ['external_secret_ref'],
      delegatable: false,
      requiresRunner: true,
      persistentSupported: false,
    },
  ];

  function makePoolRegistry(): ConnectionFamilyPolicyRegistry {
    return createConnectionFamilyPolicyRegistry(POOL_TEST_POLICIES);
  }

  function fakeRoute(overrides: Partial<ModelRoute> & { id: string; provider: string; model: string; executionMode: ModelRoute['executionMode']; }): ModelAdapter {
    const route: ModelRoute = {
      id: overrides.id,
      provider: overrides.provider,
      model: overrides.model,
      executionMode: overrides.executionMode,
      costType: overrides.costType ?? 'metered_api',
      available: overrides.available ?? true,
      priority: overrides.priority ?? 0,
      capabilities: overrides.capabilities ?? {
        chat: true,
        tools: false,
        vision: false,
        files: false,
        mcp: false,
        localWorkspace: false,
        headless: false,
        structuredOutput: false,
      },
    };
    return {
      route,
      async execute() { throw new Error('not used in pool tests'); },
    };
  }

  it('listProjectExecutionPool: requester own available connection is eligible without any share, and appears in requester tier (not project_pool)', async () => {
    const requester = await seedUser('pool.req.own');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());

    // Requester registers a nondelegatable personal (still visible to self)
    const own = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: requester.id, connectionFamilyId: 'pool-personal-nondel',
    });
    await setConnectionStatusRaw('org-001', own.id, 'available');

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const req = result.entries.filter((e) => e.tier === 'requester');
    expect(req.length).toBe(1);
    expect(req[0]?.connectionId).toBe(own.id);
    expect(req[0]?.eligible).toBe(true);
    expect(req[0]?.reasons).toEqual([]);
    // No entry for the same connection in project_pool tier.
    expect(result.entries.some((e) => e.tier === 'project_pool' && e.connectionId === own.id)).toBe(false);
    // No secretRefId leaks
    expect(JSON.stringify(result)).not.toContain('secretRefId');
  });

  it('listProjectExecutionPool: requester own non-available connection reports connection_unavailable', async () => {
    const requester = await seedUser('pool.req.notavail');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());

    const own = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: requester.id, connectionFamilyId: 'pool-personal-online',
    });
    // stays 'configured'

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const entry = result.entries.find((e) => e.tier === 'requester' && e.connectionId === own.id);
    expect(entry).toBeDefined();
    expect(entry?.eligible).toBe(false);
    expect(entry?.reasons).toContain('connection_unavailable');
  });

  it('listProjectExecutionPool: requester who is also share owner is NOT duplicated (only requester tier)', async () => {
    const requester = await seedUser('pool.req.samesharer');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const own = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: requester.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', own.id, 'available');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: requester.id, projectId, connectionId: own.id,
    });

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const matching = result.entries.filter((e) => e.connectionId === own.id);
    expect(matching.length).toBe(1);
    expect(matching[0]?.tier).toBe('requester');
  });

  it('listProjectExecutionPool: owner-shared connection appears once in requester tier with durable active-share metadata after DB round-trip', async () => {
    const requester = await seedUser('pool.req.ownshare.meta');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const own = await service.registerPersonalConnection({
      organisationId: 'org-001',
      actorUserId: requester.id,
      connectionFamilyId: 'pool-personal-persistent',
    });
    await setConnectionStatusRaw('org-001', own.id, 'available');
    const availableFrom = new Date('2027-03-01T00:00:00.000Z');
    const availableUntil = new Date('2027-04-01T00:00:00.000Z');
    await service.shareConnectionWithProject({
      organisationId: 'org-001',
      actorUserId: requester.id,
      projectId,
      connectionId: own.id,
      usagePolicy: { availableFrom, availableUntil },
    });
    await service.setProjectShareMode({
      organisationId: 'org-001',
      actorUserId: requester.id,
      projectId,
      connectionId: own.id,
      mode: 'persistent',
    });

    const persistedShare = await new AIConnectionRepository(pool).getActiveProjectShare(
      'org-001', projectId, own.id,
    );
    expect(persistedShare).not.toBeNull();

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const matching = result.entries.filter((e) => e.connectionId === own.id);
    expect(matching.length).toBe(1);
    const entry = matching[0]!;
    expect(entry.tier).toBe('requester');
    expect(entry.ownerUserId).toBe(requester.id);
    // Durable, safe share metadata is exposed alongside the requester entry.
    expect(entry.share).toBeDefined();
    expect(entry.share?.id).toBe(persistedShare?.id);
    expect(entry.share?.mode).toBe('persistent');
    expect(entry.share?.availableFrom?.toISOString()).toBe(availableFrom.toISOString());
    expect(entry.share?.availableUntil?.toISOString()).toBe(availableUntil.toISOString());
    // No credential material leaks through the pool response.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secretRefId');
    expect(serialized).not.toContain('credentialStrategy');
  });

  it('listProjectExecutionPool: requester-owned unshared connection has no share metadata', async () => {
    const requester = await seedUser('pool.req.unshared.meta');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const own = await service.registerPersonalConnection({
      organisationId: 'org-001',
      actorUserId: requester.id,
      connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', own.id, 'available');

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const entry = result.entries.find(
      (e) => e.tier === 'requester' && e.connectionId === own.id,
    );
    expect(entry).toBeDefined();
    expect(entry?.share).toBeUndefined();
  });

  it('listProjectExecutionPool: contributed project_pool entry also carries durable share metadata', async () => {
    const owner = await seedUser('pool.owner.share.meta');
    const requester = await seedUser('pool.req.share.meta');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    const availableFrom = new Date('2027-05-01T00:00:00.000Z');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom },
    });
    await seedActiveSession(owner.id);

    const persistedShare = await new AIConnectionRepository(pool).getActiveProjectShare(
      'org-001', projectId, conn.id,
    );
    expect(persistedShare).not.toBeNull();

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const entry = result.entries.find(
      (e) => e.tier === 'project_pool' && e.connectionId === conn.id,
    );
    expect(entry?.share?.id).toBe(persistedShare?.id);
    expect(entry?.share?.mode).toBe('online_only');
    expect(entry?.share?.availableFrom?.toISOString()).toBe(availableFrom.toISOString());
    expect(entry?.share?.availableUntil).toBeUndefined();
    // Organisation-tier entries never expose a share.
    for (const orgEntry of result.entries.filter((e) => e.tier === 'organisation')) {
      expect(orgEntry.share).toBeUndefined();
    }
  });

  it('listProjectExecutionPool: contributed online_only with active owner session -> eligible; without session -> owner_offline', async () => {
    const owner = await seedUser('pool.owner.online');
    const requester = await seedUser('pool.req.online');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });

    // No session yet -> owner_offline
    let result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    let entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.eligible).toBe(false);
    expect(entry?.reasons).toContain('owner_offline');
    expect(entry?.shareMode).toBe('online_only');
    expect(entry?.ownerUserId).toBe(owner.id);

    // Seed active session -> eligible
    await seedActiveSession(owner.id);
    result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.eligible).toBe(true);
    expect(entry?.reasons).toEqual([]);
  });

  it('listProjectExecutionPool: persistent share stays eligible without owner session when family supports persistent', async () => {
    const owner = await seedUser('pool.owner.persist');
    const requester = await seedUser('pool.req.persist');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-persistent',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    await service.setProjectShareMode({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id, mode: 'persistent',
    });

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.eligible).toBe(true);
    expect(entry?.shareMode).toBe('persistent');
    expect(entry?.reasons).toEqual([]);
  });

  it('listProjectExecutionPool: runner-required family in project_pool and organisation tiers returns runner_unavailable', async () => {
    const owner = await seedUser('pool.owner.runner');
    const requester = await seedUser('pool.req.runner');
    const admin = await seedUser('pool.admin.runner');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());

    const contributed = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-runner',
    });
    await setConnectionStatusRaw('org-001', contributed.id, 'available');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: contributed.id,
    });
    await seedActiveSession(owner.id);

    const orgConn = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id,
      connectionFamilyId: 'pool-org-runner', secretRefId: 'vault:runner',
    });
    await setConnectionStatusRaw('org-001', orgConn.id, 'available');

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const shared = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === contributed.id);
    expect(shared?.eligible).toBe(false);
    expect(shared?.reasons).toContain('runner_unavailable');
    const org = result.entries.find((e) => e.tier === 'organisation' && e.connectionId === orgConn.id);
    expect(org?.eligible).toBe(false);
    expect(org?.reasons).toContain('runner_unavailable');
  });

  it('listProjectExecutionPool: usage window boundaries (start-inclusive; end-exclusive)', async () => {
    const owner = await seedUser('pool.owner.window');
    const requester = await seedUser('pool.req.window');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    await seedActiveSession(owner.id, new Date('2099-01-01T00:00:00.000Z'));
    const from = new Date('2027-01-01T00:00:00.000Z');
    const until = new Date('2027-02-01T00:00:00.000Z');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
      usagePolicy: { availableFrom: from, availableUntil: until },
    });

    // Before start
    let result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
      now: new Date('2026-12-31T23:59:59.999Z'),
    });
    let entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.reasons).toContain('usage_window_not_started');

    // Exactly at start -> allowed
    result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
      now: from,
    });
    entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.reasons).not.toContain('usage_window_not_started');
    expect(entry?.reasons).not.toContain('usage_window_expired');
    expect(entry?.eligible).toBe(true);

    // Exactly at end -> expired
    result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
      now: until,
    });
    entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.reasons).toContain('usage_window_expired');
    expect(entry?.eligible).toBe(false);
  });

  it('listProjectExecutionPool: policy downgrade (delegatable now false) makes existing share ineligible; share history unchanged', async () => {
    const owner = await seedUser('pool.owner.downgrade');
    const requester = await seedUser('pool.req.downgrade');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    // Use registry where family IS delegatable to allow share creation.
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    await seedActiveSession(owner.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });

    // Now build a downgraded registry where the same family is nondelegatable.
    const downgraded = createConnectionFamilyPolicyRegistry([
      { ...POOL_TEST_POLICIES.find((p) => p.id === 'pool-personal-online')!, delegatable: false },
    ]);
    const downgradedService = makeService(downgraded);
    const result = await downgradedService.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const entry = result.entries.find((e) => e.tier === 'project_pool' && e.connectionId === conn.id);
    expect(entry?.eligible).toBe(false);
    expect(entry?.reasons).toContain('policy_not_delegatable');
    // Share history unchanged
    const shareRows = await pool.query(
      `SELECT id, mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1`,
      [conn.id],
    );
    expect(shareRows.rowCount).toBe(1);
    expect(shareRows.rows[0].revoked_at).toBeNull();
    expect(shareRows.rows[0].mode).toBe('online_only');
  });

  it('listProjectExecutionPool: multiple contributed shares are deterministic; NOT project-owner-first biased', async () => {
    const alice = await seedUser('pool.alice');
    const bob = await seedUser('pool.bob');
    const requester = await seedUser('pool.req.multi');
    await seedMember('org-001', alice.id, 'member');
    await seedMember('org-001', bob.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, alice.id);
    await seedProjectMembership('org-001', projectId, bob.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const c1 = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: alice.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', c1.id, 'available');
    await seedActiveSession(alice.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: alice.id, projectId, connectionId: c1.id,
    });
    const c2 = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: bob.id, connectionFamilyId: 'pool-personal-persistent',
    });
    await setConnectionStatusRaw('org-001', c2.id, 'available');
    await seedActiveSession(bob.id);
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: bob.id, projectId, connectionId: c2.id,
    });

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const shared = result.entries.filter((e) => e.tier === 'project_pool');
    expect(shared.length).toBe(2);
    // Deterministic order: providerId, connectionFamilyId, connectionId
    const sortedIds = [...shared].sort((a, b) => {
      const p = a.providerId.localeCompare(b.providerId);
      if (p !== 0) return p;
      const f = a.connectionFamilyId.localeCompare(b.connectionFamilyId);
      if (f !== 0) return f;
      return a.connectionId.localeCompare(b.connectionId);
    });
    expect(shared.map((e) => e.connectionId)).toEqual(sortedIds.map((e) => e.connectionId));
  });

  it('listProjectExecutionPool: organisation tier appears third and does not require delegatable=true', async () => {
    const requester = await seedUser('pool.req.orgtier');
    const admin = await seedUser('pool.admin.orgtier');
    await seedMember('org-001', requester.id, 'member');
    await seedMember('org-001', admin.id, 'admin');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());

    const own = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: requester.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', own.id, 'available');
    const orgConn = await service.registerOrganisationConnection({
      organisationId: 'org-001', actorUserId: admin.id, connectionFamilyId: 'pool-org-api', secretRefId: 'vault:x',
    });
    await setConnectionStatusRaw('org-001', orgConn.id, 'available');

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    const tiers = result.entries.map((e) => e.tier);
    // Order: requester (any) -> project_pool (0) -> organisation (any)
    // Ensure strict tier ordering: no organisation entry appears before a requester entry
    const firstOrgIdx = tiers.indexOf('organisation');
    const lastReqIdx = tiers.lastIndexOf('requester');
    const lastProjIdx = tiers.lastIndexOf('project_pool');
    expect(firstOrgIdx).toBeGreaterThan(-1);
    expect(firstOrgIdx).toBeGreaterThan(lastReqIdx);
    if (lastProjIdx !== -1) expect(firstOrgIdx).toBeGreaterThan(lastProjIdx);

    const orgEntry = result.entries.find((e) => e.tier === 'organisation' && e.connectionId === orgConn.id);
    expect(orgEntry?.eligible).toBe(true);
    expect(orgEntry?.reasons).toEqual([]);
    expect(orgEntry?.ownerUserId).toBeUndefined();
  });

  it('listProjectExecutionPool: cross-organisation and non-member forbidden; no leakage', async () => {
    const insider = await seedUser('pool.insider');
    const outsider = await seedUser('pool.outsider');
    await seedMember('org-001', insider.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, insider.id);
    const service = makeService(makePoolRegistry());

    await expectServiceError(
      service.listProjectExecutionPool({
        organisationId: 'org-001', projectId, requesterUserId: outsider.id,
      }),
      'forbidden',
    );
    await expectServiceError(
      service.listProjectExecutionPool({
        organisationId: 'org-999', projectId, requesterUserId: insider.id,
      }),
      'forbidden',
    );
    // Insider without project access
    const insider2 = await seedUser('pool.insider2');
    await seedMember('org-001', insider2.id, 'member');
    await expectServiceError(
      service.listProjectExecutionPool({
        organisationId: 'org-001', projectId, requesterUserId: insider2.id,
      }),
      'forbidden',
    );
    // Project that doesn't exist
    await expectServiceError(
      service.listProjectExecutionPool({
        organisationId: 'org-001', projectId: randomUUID(), requesterUserId: insider.id,
      }),
      'not_found',
    );
  });

  it('listProjectExecutionPool: apiFallbackRoutes includes only executionMode=api routes', async () => {
    const requester = await seedUser('pool.req.api');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, requester.id);
    const gateway = new ModelGateway();
    gateway.register(fakeRoute({ id: 'test-api-1', provider: 'openai', model: 'gpt-x', executionMode: 'api' }));
    gateway.register(fakeRoute({ id: 'test-api-2', provider: 'anthropic', model: 'claude-y', executionMode: 'api', available: false }));
    gateway.register(fakeRoute({ id: 'test-sub-1', provider: 'test', model: 'sub-model', executionMode: 'subscription', costType: 'included_subscription' }));
    gateway.register(fakeRoute({ id: 'test-man-1', provider: 'test', model: 'man-model', executionMode: 'manual', costType: 'manual' }));
    const service = makeService(makePoolRegistry(), gateway);

    const result = await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    expect(result.apiFallbackRoutes.map((r) => r.routeId).sort()).toEqual(['test-api-1', 'test-api-2']);
    for (const r of result.apiFallbackRoutes) {
      expect(r.executionMode).toBe('api');
      expect(r).toHaveProperty('available');
      expect(r).toHaveProperty('capabilities');
      expect(r).toHaveProperty('costType');
      expect(r).toHaveProperty('providerId');
      expect(r).toHaveProperty('model');
    }
    // Routes are NOT merged into entries
    for (const e of result.entries) {
      expect(e.tier).not.toBe('api' as unknown as typeof e.tier);
    }
  });

  it('listProjectExecutionPool: pool read does not mutate state (no audit, no share writes)', async () => {
    const owner = await seedUser('pool.owner.pure');
    const requester = await seedUser('pool.req.pure');
    await seedMember('org-001', owner.id, 'member');
    await seedMember('org-001', requester.id, 'member');
    const projectId = await seedProject('org-001');
    await seedProjectMembership('org-001', projectId, owner.id);
    await seedProjectMembership('org-001', projectId, requester.id);
    const service = makeService(makePoolRegistry());
    const conn = await service.registerPersonalConnection({
      organisationId: 'org-001', actorUserId: owner.id, connectionFamilyId: 'pool-personal-online',
    });
    await setConnectionStatusRaw('org-001', conn.id, 'available');
    await service.shareConnectionWithProject({
      organisationId: 'org-001', actorUserId: owner.id, projectId, connectionId: conn.id,
    });
    const auditsBefore = await new AuditRepository(pool).listByOrganisation('org-001');
    const sharesBefore = await pool.query(`SELECT id, mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1`, [conn.id]);

    await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
    });
    await service.listProjectExecutionPool({
      organisationId: 'org-001', projectId, requesterUserId: requester.id,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });

    const auditsAfter = await new AuditRepository(pool).listByOrganisation('org-001');
    const sharesAfter = await pool.query(`SELECT id, mode, revoked_at FROM ai_connection_project_shares WHERE connection_id = $1`, [conn.id]);
    expect(auditsAfter.length).toBe(auditsBefore.length);
    expect(sharesAfter.rowCount).toBe(sharesBefore.rowCount);
  });
});
