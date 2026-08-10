import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import {
  AuditRepository,
  DatabaseUnitOfWork,
  InvitationRepository,
  MembershipRepository,
  ProjectRepository,
  SessionRepository,
  UserRepository,
} from '@engineering-os/database';
import { AuthService, AuthServiceError } from '../src/auth-service.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const ownerPassword = 'Owner-password-2026!';

async function setupOwner() {
  const now = new Date('2026-08-09T12:00:00Z');
  const user = {
    id: randomUUID(), userId: 'platform.owner',
    passwordHash: await hashPassword(ownerPassword), status: 'active' as const,
    createdAt: now, updatedAt: now,
  };
  const users = new UserRepository(pool);
  const memberships = new MembershipRepository(pool);
  await users.create(user);
  await memberships.grantOrganisation({
    organisationId: 'org-001', userId: user.id, role: 'owner', createdBy: 'bootstrap', now,
  });
  return user;
}

async function setupProject(name: string) {
  const now = new Date('2026-08-09T12:00:00Z');
  const id = randomUUID();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, 'org-001', $2, 'bootstrap', $3, 'discovery', 'auto', $3)`,
    [id, name, now],
  );
  return id;
}

function service() {
  return new AuthService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    users: new UserRepository(pool),
    memberships: new MembershipRepository(pool),
    invitations: new InvitationRepository(pool),
    sessions: new SessionRepository(pool),
    audit: new AuditRepository(pool),
  });
}

async function expectAuthError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error('expected auth error');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthServiceError);
    expect((error as AuthServiceError).code).toBe(code);
  }
}

describe('AuthService', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('creates a hash-only configurable-TTL invitation and redeems it exactly once', async () => {
    const owner = await setupOwner();
    const projectId = await setupProject('Invite Project');
    const auth = service();
    const issuedAt = new Date('2026-08-09T12:00:00Z');

    const created = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id,
      organisationRole: 'member',
      projectGrants: [{ projectId, role: 'contributor' }],
      ttlMinutes: 45, now: issuedAt,
    });
    expect(created.key.length).toBeGreaterThan(30);
    expect(created.expiresAt.toISOString()).toBe('2026-08-09T12:45:00.000Z');

    const stored = await new InvitationRepository(pool).getById(created.invitationId);
    expect(stored?.tokenHash).not.toBe(created.key);
    expect(stored?.status).toBe('pending');

    const redeemed = await auth.redeemInvitation({
      key: created.key, userId: 'Alice.Product', password: 'Alice-password-2026!',
      now: new Date('2026-08-09T12:10:00Z'),
    });
    expect(redeemed.userId).toBe('alice.product');
    expect(await new MembershipRepository(pool).getOrganisation('org-001', redeemed.id)).toMatchObject({
      role: 'member', status: 'active',
    });
    expect(await new MembershipRepository(pool).getProject('org-001', projectId, redeemed.id)).toMatchObject({
      role: 'contributor', status: 'active',
    });
    expect((await new InvitationRepository(pool).getById(created.invitationId))?.status).toBe('consumed');

    await expectAuthError(auth.redeemInvitation({
      key: created.key, userId: 'alice.second', password: 'Another-password-2026!',
      now: new Date('2026-08-09T12:11:00Z'),
    }), 'invitation_invalid');
    expect(await new UserRepository(pool).getByUserId('alice.second')).toBeNull();

    const audits = await new AuditRepository(pool).listByOrganisation('org-001');
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(created.key);
    expect(serialized).not.toContain('Alice-password-2026!');
    expect(audits.map((event) => event.eventType)).toContain('auth.invitation.redeemed');
  });

  it('rejects an expired invitation without creating a user', async () => {
    const owner = await setupOwner();
    const auth = service();
    const created = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id,
      organisationRole: 'member', projectGrants: [], ttlMinutes: 10,
      now: new Date('2026-08-09T12:00:00Z'),
    });

    await expectAuthError(auth.redeemInvitation({
      key: created.key, userId: 'late.user', password: 'Late-password-2026!',
      now: new Date('2026-08-09T12:11:00Z'),
    }), 'invitation_expired');
    expect(await new UserRepository(pool).getByUserId('late.user')).toBeNull();
    expect((await new InvitationRepository(pool).getById(created.invitationId))?.status).toBe('expired');
  });

  it('logs in by User ID/password, stores only a session hash, and logout revokes it', async () => {
    await setupOwner();
    const auth = service();
    const now = new Date('2026-08-09T12:15:00Z');

    await expectAuthError(auth.login({
      userId: 'platform.owner', password: 'Wrong-password-2026!', now,
    }), 'invalid_credentials');

    const login = await auth.login({ userId: 'Platform.Owner', password: ownerPassword, now });
    expect(login.token.length).toBeGreaterThan(30);
    const tokenHash = (await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM auth_sessions WHERE id = $1', [login.sessionId],
    )).rows[0]?.token_hash;
    expect(tokenHash).toBeDefined();
    expect(tokenHash).not.toBe(login.token);

    expect(await auth.resolveSession(login.token, new Date('2026-08-09T12:16:00Z'))).toMatchObject({
      userId: 'platform.owner',
    });
    await auth.logout(login.token, new Date('2026-08-09T12:17:00Z'));
    expect(await auth.resolveSession(login.token, new Date('2026-08-09T12:18:00Z'))).toBeNull();
  });

  it('revokes one project without removing access to another project', async () => {
    const owner = await setupOwner();
    const projectOne = await setupProject('Project One');
    const projectTwo = await setupProject('Project Two');
    const auth = service();
    const invitation = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id, organisationRole: 'member',
      projectGrants: [
        { projectId: projectOne, role: 'contributor' },
        { projectId: projectTwo, role: 'viewer' },
      ],
      now: new Date('2026-08-09T12:00:00Z'),
    });
    const member = await auth.redeemInvitation({
      key: invitation.key, userId: 'multi.project', password: 'Multi-project-2026!',
      now: new Date('2026-08-09T12:05:00Z'),
    });
    const login = await auth.login({
      userId: 'multi.project', password: 'Multi-project-2026!',
      now: new Date('2026-08-09T12:06:00Z'),
    });

    expect(await auth.authorizeProject(login.token, 'org-001', projectOne, new Date('2026-08-09T12:06:30Z'))).toMatchObject({ projectRole: 'contributor' });
    expect(await auth.authorizeProject(login.token, 'org-001', projectTwo, new Date('2026-08-09T12:06:30Z'))).toMatchObject({ projectRole: 'viewer' });

    await auth.revokeProjectAccess({
      organisationId: 'org-001', projectId: projectOne,
      actorUserId: owner.id, targetUserId: member.id,
      now: new Date('2026-08-09T12:07:00Z'),
    });
    expect(await auth.authorizeProject(login.token, 'org-001', projectOne, new Date('2026-08-09T12:07:30Z'))).toBeNull();
    expect(await auth.authorizeProject(login.token, 'org-001', projectTwo, new Date('2026-08-09T12:07:30Z'))).toMatchObject({ projectRole: 'viewer' });
  });

  it('grants and changes project access without changing organisation membership', async () => {
    const owner = await setupOwner();
    const projectId = await setupProject('Grant Project');
    const auth = service();
    const invitation = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id,
      organisationRole: 'member', projectGrants: [],
      now: new Date('2026-08-09T12:00:00Z'),
    });
    const member = await auth.redeemInvitation({
      key: invitation.key, userId: 'grant.me', password: 'Grant-password-2026!',
      now: new Date('2026-08-09T12:05:00Z'),
    });

    await auth.grantProjectAccess({
      organisationId: 'org-001', projectId, actorUserId: owner.id,
      targetUserId: member.id, role: 'reviewer', now: new Date('2026-08-09T12:06:00Z'),
    });
    expect(await new MembershipRepository(pool).getProject('org-001', projectId, member.id)).toMatchObject({ role: 'reviewer', status: 'active' });

    await auth.grantProjectAccess({
      organisationId: 'org-001', projectId, actorUserId: owner.id,
      targetUserId: member.id, role: 'viewer', now: new Date('2026-08-09T12:07:00Z'),
    });
    expect(await new MembershipRepository(pool).getProject('org-001', projectId, member.id)).toMatchObject({ role: 'viewer', status: 'active' });
    expect(await new MembershipRepository(pool).getOrganisation('org-001', member.id)).toMatchObject({ role: 'member', status: 'active' });
  });
  it('suspends a user and invalidates active sessions immediately', async () => {
    const owner = await setupOwner();
    const auth = service();
    const invitation = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id,
      organisationRole: 'member', projectGrants: [],
      now: new Date('2026-08-09T12:00:00Z'),
    });
    const member = await auth.redeemInvitation({
      key: invitation.key, userId: 'suspend.me', password: 'Suspend-password-2026!',
      now: new Date('2026-08-09T12:05:00Z'),
    });
    const login = await auth.login({
      userId: 'suspend.me', password: 'Suspend-password-2026!',
      now: new Date('2026-08-09T12:06:00Z'),
    });
    expect(await auth.resolveSession(login.token, new Date('2026-08-09T12:06:30Z'))).not.toBeNull();

    await auth.setUserStatus({
      organisationId: 'org-001', actorUserId: owner.id,
      targetUserId: member.id, status: 'suspended',
      now: new Date('2026-08-09T12:07:00Z'),
    });
    expect(await auth.resolveSession(login.token, new Date('2026-08-09T12:07:30Z'))).toBeNull();
    await expectAuthError(auth.login({
      userId: 'suspend.me', password: 'Suspend-password-2026!',
      now: new Date('2026-08-09T12:08:00Z'),
    }), 'account_suspended');
  });

  it('does not allow a normal member to create invitations', async () => {
    const owner = await setupOwner();
    const auth = service();
    const invitation = await auth.createInvitation({
      organisationId: 'org-001', actorUserId: owner.id,
      organisationRole: 'member', projectGrants: [],
      now: new Date('2026-08-09T12:00:00Z'),
    });
    const member = await auth.redeemInvitation({
      key: invitation.key, userId: 'normal.member', password: 'Normal-password-2026!',
      now: new Date('2026-08-09T12:05:00Z'),
    });
    await expectAuthError(auth.createInvitation({
      organisationId: 'org-001', actorUserId: member.id,
      organisationRole: 'member', projectGrants: [],
      now: new Date('2026-08-09T12:06:00Z'),
    }), 'forbidden');
  });

  it('lists safe people/access data for administrators', async () => {
    const owner = await setupOwner();
    const projectId = await setupProject('People Project');
    const auth = service();
    const invite = await auth.createInvitation({ organisationId: 'org-001', actorUserId: owner.id, organisationRole: 'member', projectGrants: [{ projectId, role: 'reviewer' }] });
    await auth.redeemInvitation({ key: invite.key, userId: 'listed.user', password: 'Listed-password-2026!' });
    const people = await auth.listPeople({ organisationId: 'org-001', actorUserId: owner.id });
    expect(people.some((person) => person.userId === 'listed.user' && person.projects[0]?.role === 'reviewer')).toBe(true);
    expect(JSON.stringify(people)).not.toMatch(/password_hash|passwordHash|token_hash|tokenHash/i);
  });

  it('updates the organisation invitation TTL policy', async () => {
    const owner = await setupOwner();
    const auth = service();
    await auth.setInvitationPolicy({ organisationId: 'org-001', actorUserId: owner.id, ttlMinutes: 90 });
    expect(await new InvitationRepository(pool).getDefaultTtlMinutes('org-001')).toBe(90);
    const invite = await auth.createInvitation({ organisationId: 'org-001', actorUserId: owner.id, organisationRole: 'member', projectGrants: [], now: new Date('2026-08-09T12:00:00Z') });
    expect(invite.expiresAt.toISOString()).toBe('2026-08-09T13:30:00.000Z');
  });

  it('cancels a pending invitation so it can never be redeemed', async () => {
    const owner = await setupOwner();
    const auth = service();
    const invite = await auth.createInvitation({ organisationId: 'org-001', actorUserId: owner.id, organisationRole: 'member', projectGrants: [] });
    await auth.cancelInvitation({ organisationId: 'org-001', actorUserId: owner.id, invitationId: invite.invitationId });
    expect((await new InvitationRepository(pool).getById(invite.invitationId))?.status).toBe('revoked');
    await expectAuthError(auth.redeemInvitation({ key: invite.key, userId: 'cancelled.user', password: 'Cancelled-password-2026!' }), 'invitation_invalid');
  });

  it('revokes organisation access while retaining historical account identity', async () => {
    const owner = await setupOwner();
    const auth = service();
    const invite = await auth.createInvitation({ organisationId: 'org-001', actorUserId: owner.id, organisationRole: 'member', projectGrants: [] });
    const member = await auth.redeemInvitation({ key: invite.key, userId: 'revoked.member', password: 'Revoked-password-2026!' });
    await auth.revokeOrganisationAccess({ organisationId: 'org-001', actorUserId: owner.id, targetUserId: member.id });
    expect(await new UserRepository(pool).getById(member.id)).toMatchObject({ userId: 'revoked.member' });
    expect(await new MembershipRepository(pool).getOrganisation('org-001', member.id)).toMatchObject({ status: 'revoked' });
  });

  it('rolls back invitation creation when mandatory audit persistence fails', async () => {
    const owner = await setupOwner();
    const auth = service();
    await pool.query(`
      CREATE FUNCTION reject_auth_invitation_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'auth.invitation.created' THEN
          RAISE EXCEPTION 'forced auth audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_auth_invitation_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_auth_invitation_audit();
    `);

    try {
      await expect(auth.createInvitation({
        organisationId: 'org-001', actorUserId: owner.id,
        organisationRole: 'member', projectGrants: [],
        now: new Date('2026-08-09T12:00:00Z'),
      })).rejects.toThrow(/forced auth audit failure/);
      expect((await pool.query('SELECT id FROM invitations')).rowCount).toBe(0);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_auth_invitation_audit_trigger ON audit_events;
        DROP FUNCTION IF EXISTS reject_auth_invitation_audit();
      `);
    }
  });
});
