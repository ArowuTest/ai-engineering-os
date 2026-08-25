import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as database from '../src/index.js';
import * as domain from '@engineering-os/domain';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const now = new Date('2026-08-19T21:55:00.000Z');

type PlatformRepo = {
  grantAdmin(input: { userId: string; createdBy: string; now: Date }): Promise<void>;
  get(userId: string): Promise<{ userId: string; role: 'admin'; status: 'active' | 'revoked' } | null>;
  revokeAdmin(userId: string, when: Date): Promise<void>;
};

function platformRepo(): PlatformRepo {
  const Ctor = (database as unknown as { PlatformMembershipRepository?: new (db: typeof pool) => PlatformRepo })
    .PlatformMembershipRepository;
  expect(typeof Ctor).toBe('function');
  return new Ctor!(pool);
}

async function seedUser(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, user_id, password_hash, status, created_at, updated_at)
     VALUES ($1, $2, 'scrypt$test$hash', 'active', $3, $3)`,
    [id, `platform.${id.slice(0, 8)}`, now],
  );
  return id;
}

describe('platform administration authority', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('creates an explicit platform membership surface independent from organisation membership', async () => {
    const table = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.platform_memberships')::text AS name`,
    );
    expect(table.rows[0]?.name).toBe('platform_memberships');
    const userId = await seedUser();
    const repo = platformRepo();
    await repo.grantAdmin({ userId, createdBy: 'bootstrap', now });
    expect(await repo.get(userId)).toMatchObject({ userId, role: 'admin', status: 'active' });
    const orgMemberships = await pool.query(
      'SELECT organisation_id FROM organisation_memberships WHERE user_id=$1', [userId],
    );
    expect(orgMemberships.rowCount).toBe(0);
  });

  it('revokes platform authority without changing tenant memberships', async () => {
    const userId = await seedUser();
    await pool.query(
      `INSERT INTO organisation_memberships
       (organisation_id,user_id,role,status,created_by,created_at,updated_at)
       VALUES ('org-001',$1,'admin','active','bootstrap',$2,$2)`, [userId, now],
    );
    const repo = platformRepo();
    await repo.grantAdmin({ userId, createdBy: 'bootstrap', now });
    await repo.revokeAdmin(userId, new Date(now.getTime() + 60_000));
    expect(await repo.get(userId)).toMatchObject({ status: 'revoked' });
    const org = await pool.query<{ status: string }>(
      `SELECT status FROM organisation_memberships WHERE organisation_id='org-001' AND user_id=$1`, [userId],
    );
    expect(org.rows[0]?.status).toBe('active');
  });

  it('persists append-only platform audit events without inventing a tenant', async () => {
    const createAuditEvent = (domain as unknown as {
      createPlatformAuditEvent?: (input: Record<string, unknown>) => { organisationId?: string; projectId?: string; eventType: string };
    }).createPlatformAuditEvent;
    expect(typeof createAuditEvent).toBe('function');
    const event = createAuditEvent!({
      eventType: 'capability.catalogue.refreshed', actorType: 'user', actorId: 'platform-admin',
      subjectType: 'capability_catalogue', subjectId: 'ecc', metadata: { discovered: 1 },
    });
    expect(event.organisationId).toBeUndefined();
    const audit = new database.AuditRepository(pool) as database.AuditRepository & {
      listPlatform(): Promise<Array<{ eventType: string; organisationId?: string }>>;
    };
    await audit.append(event as never);
    const platformEvents = await audit.listPlatform();
    expect(platformEvents).toEqual([
      expect.objectContaining({ eventType: 'capability.catalogue.refreshed' }),
    ]);
    expect(platformEvents[0]).not.toHaveProperty('organisationId');
    await expect(pool.query(`UPDATE audit_events SET event_type='tampered' WHERE event_type='capability.catalogue.refreshed'`))
      .rejects.toThrow('append-only');
  });
});
