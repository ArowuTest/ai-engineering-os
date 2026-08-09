import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InvitationRepository,
  MembershipRepository,
  SessionRepository,
  UserRepository,
} from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

describe('authentication persistence', () => {
  beforeEach(async () => resetDatabase());
  afterAll(async () => closeDatabase());

  it('installs a 30-minute organisation invitation default and hash-only secret columns', async () => {
    const organisation = await pool.query<{ invitation_ttl_minutes: number }>(
      `SELECT invitation_ttl_minutes FROM organisations WHERE id = 'org-001'`,
    );
    expect(organisation.rows[0]?.invitation_ttl_minutes).toBe(30);

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('invitations', 'auth_sessions')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('token_hash');
    expect(names).not.toContain('token');
    expect(names).not.toContain('invitation_key');
  });

  it('creates and resolves a user by normalized User ID', async () => {
    const users = new UserRepository(pool);
    const user = {
      id: randomUUID(),
      userId: 'owner.one',
      passwordHash: 'scrypt$test$hash',
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await users.create(user);
    expect(await users.getByUserId('owner.one')).toMatchObject({
      id: user.id,
      userId: 'owner.one',
      status: 'active',
    });
    expect(await users.getById(user.id)).toMatchObject({ userId: 'owner.one' });
  });

  it('separates organisation membership from project membership', async () => {
    const users = new UserRepository(pool);
    const memberships = new MembershipRepository(pool);
    const userId = randomUUID();
    await users.create({
      id: userId,
      userId: 'project.member',
      passwordHash: 'scrypt$test$hash',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const projectId = randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO projects
        (id, organisation_id, name, created_by, created_at, stage,
         preferred_product_partner, updated_at)
       VALUES ($1, 'org-001', 'Scoped Project', 'bootstrap', $2,
               'discovery', 'auto', $2)`,
      [projectId, now],
    );

    await memberships.grantOrganisation({
      organisationId: 'org-001', userId, role: 'member', createdBy: 'bootstrap', now,
    });
    await memberships.grantProject({
      organisationId: 'org-001', projectId, userId, role: 'reviewer', createdBy: 'bootstrap', now,
    });

    expect(await memberships.getOrganisation('org-001', userId)).toMatchObject({ role: 'member', status: 'active' });
    expect(await memberships.getProject('org-001', projectId, userId)).toMatchObject({ role: 'reviewer', status: 'active' });

    await memberships.revokeProject('org-001', projectId, userId, now);
    expect(await memberships.getProject('org-001', projectId, userId)).toMatchObject({ status: 'revoked' });
    expect(await memberships.getOrganisation('org-001', userId)).toMatchObject({ status: 'active' });
  });

  it('persists invitation hashes and project grants, then consumes the invitation', async () => {
    const invitations = new InvitationRepository(pool);
    const invitationId = randomUUID();
    const projectId = randomUUID();
    const now = new Date('2026-08-09T12:00:00Z');
    await pool.query(
      `INSERT INTO projects
        (id, organisation_id, name, created_by, created_at, stage,
         preferred_product_partner, updated_at)
       VALUES ($1, 'org-001', 'Invite Project', 'bootstrap', $2,
               'discovery', 'auto', $2)`,
      [projectId, now],
    );

    await invitations.create({
      id: invitationId,
      organisationId: 'org-001',
      tokenHash: 'a'.repeat(64),
      organisationRole: 'member',
      status: 'pending',
      issuedBy: 'bootstrap',
      issuedAt: now,
      expiresAt: new Date('2026-08-09T12:30:00Z'),
    }, [{ projectId, role: 'contributor' }]);

    expect(await invitations.getByTokenHash('a'.repeat(64))).toMatchObject({ id: invitationId, status: 'pending' });
    expect(await invitations.listProjectGrants(invitationId)).toEqual([{ projectId, role: 'contributor' }]);

    const consumedBy = randomUUID();
    await invitations.markConsumed(invitationId, consumedBy, new Date('2026-08-09T12:10:00Z'));
    expect(await invitations.getById(invitationId)).toMatchObject({ status: 'consumed', consumedByUserId: consumedBy });
  });

  it('resolves only active, unexpired sessions and supports immediate revocation', async () => {
    const users = new UserRepository(pool);
    const sessions = new SessionRepository(pool);
    const userId = randomUUID();
    const now = new Date('2026-08-09T12:00:00Z');
    await users.create({
      id: userId,
      userId: 'session.user',
      passwordHash: 'scrypt$test$hash',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    await sessions.create({
      id: randomUUID(),
      userId,
      tokenHash: 'b'.repeat(64),
      createdAt: now,
      expiresAt: new Date('2026-08-10T12:00:00Z'),
    });
    expect(await sessions.getActiveByTokenHash('b'.repeat(64), now)).toMatchObject({ userId });

    await sessions.revokeAllForUser(userId, new Date('2026-08-09T12:05:00Z'));
    expect(await sessions.getActiveByTokenHash('b'.repeat(64), new Date('2026-08-09T12:06:00Z'))).toBeNull();
  });
});
