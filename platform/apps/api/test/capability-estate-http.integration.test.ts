import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { MembershipRepository, PlatformMembershipRepository, UserRepository } from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

async function seedUser(userId: string, password: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await new UserRepository(pool).create({
    id, userId, passwordHash: await hashPassword(password), status: 'active',
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function seedOrganisationMember(
  accountId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<void> {
  const now = new Date();
  await new MembershipRepository(pool).grantOrganisation({
    organisationId: 'org-001', userId: accountId, role,
    createdBy: 'test', now,
  });
  if (role === 'owner') {
    await new PlatformMembershipRepository(pool).grantAdmin({ userId: accountId, createdBy: 'test', now });
  }
}
async function seedProject(memberId?: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage,
       preferred_product_partner, updated_at)
     VALUES ($1, 'org-001', 'Capability Project', 'test', $2,
       'discovery', 'auto', $2)`,
    [id, now],
  );
  if (memberId) {
    await new MembershipRepository(pool).grantProject({
      organisationId: 'org-001', projectId: id, userId: memberId,
      role: 'engineer', createdBy: 'test', now,
    });
  }
  return id;
}

function runtime() {
  return createRuntimeApp({
    DATABASE_URL: databaseUrl,
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_MODEL: 'gpt-test',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ANTHROPIC_MODEL: 'claude-test',
    ALLOW_DEV_IDENTITY_HEADERS: 'false',
  });
}

async function login(app: ReturnType<typeof runtime>['app'], userId: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { userId, password } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}
const capabilityPayload = {
  id: 'model.openai-api',
  kind: 'model_route',
  source: 'model_gateway',
  sourceRef: 'openai-api',
  displayName: 'OpenAI API',
  maturity: 'supported',
  governanceState: 'approved',
  executionVerification: 'verified',
};

describe('governed capability estate HTTP boundary', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('lets Admin catalogue capabilities with audit and forbids ordinary members', async () => {
    const owner = await seedUser('cap.owner', 'Cap-owner-2026!');
    const member = await seedUser('cap.member', 'Cap-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const instance = runtime();
    const ownerToken = await login(instance.app, 'cap.owner', 'Cap-owner-2026!');
    const memberToken = await login(instance.app, 'cap.member', 'Cap-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };

    const forbidden = await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: memberHeaders, payload: capabilityPayload,
    });
    expect(forbidden.statusCode).toBe(403);
    const created = await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload: capabilityPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject(capabilityPayload);

    const listed = await instance.app.inject({
      method: 'GET', url: '/admin/capabilities', headers: ownerHeaders,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([expect.objectContaining(capabilityPayload)]);

    const audit = await pool.query<{ event_type: string; subject_id: string }>(
      `SELECT event_type, subject_id FROM audit_events
       WHERE organisation_id IS NULL AND event_type='capability.catalogued'`,
    );
    expect(audit.rows).toEqual([{ event_type: 'capability.catalogued', subject_id: capabilityPayload.id }]);
    await instance.close();
  });

  it('exposes only released and independently technically eligible model routes to a project user', async () => {
    const owner = await seedUser('route.owner', 'Route-owner-2026!');
    const member = await seedUser('route.member', 'Route-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const projectId = await seedProject(member);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'route.owner', 'Route-owner-2026!');
    const memberToken = await login(instance.app, 'route.member', 'Route-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };

    for (const payload of [
      capabilityPayload,
      { ...capabilityPayload, id: 'model.missing-route', sourceRef: 'missing-route', displayName: 'Missing Route' },
      { ...capabilityPayload, id: 'model.unreleased', sourceRef: 'openai-api', displayName: 'Unreleased Route' },
    ]) {
      const response = await instance.app.inject({
        method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload,
      });
      expect(response.statusCode).toBe(201);
    }

    for (const capabilityId of ['model.openai-api', 'model.missing-route']) {
      const release = await instance.app.inject({
        method: 'POST', url: `/admin/capabilities/${capabilityId}/releases`, headers: ownerHeaders,
        payload: { scope: 'project', projectId },
      });
      expect(release.statusCode).toBe(201);
    }

    const visible = await instance.app.inject({
      method: 'GET', url: `/projects/${projectId}/capabilities?kind=model_route`, headers: memberHeaders,
    });
    expect(visible.statusCode).toBe(200);
    const body = visible.json() as Array<Record<string, unknown>>;
    expect(body.map((item) => item.id)).toEqual(['model.openai-api']);
    expect(body[0]).not.toHaveProperty('credential');
    await instance.close();
  });

  it('keeps raw model discovery Admin-only instead of exposing it as a user catalogue', async () => {
    const owner = await seedUser('discover.owner', 'Discover-owner-2026!');
    const member = await seedUser('discover.member', 'Discover-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const instance = runtime();
    const ownerToken = await login(instance.app, 'discover.owner', 'Discover-owner-2026!');
    const memberToken = await login(instance.app, 'discover.member', 'Discover-member-2026!');
    const unauthenticated = await instance.app.inject({ method: 'GET', url: '/model-routes', headers: { 'x-organisation-id': 'org-001' } });
    expect(unauthenticated.statusCode).toBe(401);
    const memberResponse = await instance.app.inject({
      method: 'GET', url: '/model-routes',
      headers: { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' },
    });
    expect(memberResponse.statusCode).toBe(403);
    const ownerResponse = await instance.app.inject({
      method: 'GET', url: '/model-routes',
      headers: { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' },
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect((ownerResponse.json() as Array<{ id: string }>).map((route) => route.id)).toEqual([
      'openai-api', 'anthropic-api',
    ]);
    await instance.close();
  }, 90_000);

  it('makes disable and release revocation immediately remove user selectability with audit', async () => {
    const owner = await seedUser('govern.owner', 'Govern-owner-2026!');
    const member = await seedUser('govern.member', 'Govern-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const projectId = await seedProject(member);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'govern.owner', 'Govern-owner-2026!');
    const memberToken = await login(instance.app, 'govern.member', 'Govern-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };
    expect((await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload: capabilityPayload,
    })).statusCode).toBe(201);
    const released = await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/releases`,
      headers: ownerHeaders, payload: { scope: 'project', projectId },
    });
    expect(released.statusCode).toBe(201);
    const releaseId = (released.json() as { id: string }).id;
    const eligibleUrl = `/projects/${projectId}/capabilities?kind=model_route`;
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: capabilityPayload.id })]);
    const disabled = await instance.app.inject({
      method: 'PATCH', url: `/admin/capabilities/${capabilityPayload.id}`,
      headers: ownerHeaders, payload: { governanceState: 'disabled' },
    });
    expect(disabled.statusCode).toBe(200);
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([]);
    const approved = await instance.app.inject({
      method: 'PATCH', url: `/admin/capabilities/${capabilityPayload.id}`,
      headers: ownerHeaders, payload: { governanceState: 'approved' },
    });
    expect(approved.statusCode).toBe(200);
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: capabilityPayload.id })]);
    const revoked = await instance.app.inject({
      method: 'DELETE', url: `/admin/capabilities/${capabilityPayload.id}/releases/${releaseId}`,
      headers: ownerHeaders,
    });
    expect(revoked.statusCode).toBe(204);
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([]);
    const audit = await pool.query<{ event_type: string; organisation_id: string | null }>(
      `SELECT event_type, organisation_id FROM audit_events
       WHERE event_type IN ('capability.state.changed','capability.release.revoked') ORDER BY sequence`,
    );
    expect(audit.rows).toEqual([
      { event_type: 'capability.state.changed', organisation_id: null },
      { event_type: 'capability.state.changed', organisation_id: null },
      { event_type: 'capability.release.revoked', organisation_id: 'org-001' },
    ]);
    await instance.close();
  }, 90_000);

  it('resolves Auto deterministically from only approved released live candidates', async () => {
    const owner = await seedUser('auto.owner', 'Auto-owner-2026!');
    const member = await seedUser('auto.member', 'Auto-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const projectId = await seedProject(member);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'auto.owner', 'Auto-owner-2026!');
    const memberToken = await login(instance.app, 'auto.member', 'Auto-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };
    const candidates = [
      capabilityPayload,
      {
        ...capabilityPayload,
        id: 'model.anthropic-api', sourceRef: 'anthropic-api', displayName: 'Anthropic API',
      },
      {
        ...capabilityPayload,
        id: 'model.unreleased-fast', sourceRef: 'openai-api', displayName: 'Unreleased Fast',
      },
    ];
    for (const payload of candidates) {
      expect((await instance.app.inject({
        method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload,
      })).statusCode).toBe(201);
    }
    for (const capabilityId of ['model.openai-api', 'model.anthropic-api']) {
      expect((await instance.app.inject({
        method: 'POST', url: `/admin/capabilities/${capabilityId}/releases`,
        headers: ownerHeaders, payload: { scope: 'project', projectId },
      })).statusCode).toBe(201);
    }
    const autoUrl = `/projects/${projectId}/capabilities/auto?kind=model_route`;
    const first = await instance.app.inject({ method: 'GET', url: autoUrl, headers: memberHeaders });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ id: 'model.openai-api', sourceRef: 'openai-api' });

    expect((await instance.app.inject({
      method: 'PATCH', url: '/admin/capabilities/model.openai-api',
      headers: ownerHeaders, payload: { governanceState: 'disabled' },
    })).statusCode).toBe(200);
    const fallback = await instance.app.inject({ method: 'GET', url: autoUrl, headers: memberHeaders });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json()).toMatchObject({ id: 'model.anthropic-api', sourceRef: 'anthropic-api' });
    await instance.close();
  }, 90_000);

  it('keeps durable project eligibility independent from release and audits policy changes', async () => {
    const owner = await seedUser('elig.owner', 'Elig-owner-2026!');
    const member = await seedUser('elig.member', 'Elig-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const projectId = await seedProject(member);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'elig.owner', 'Elig-owner-2026!');
    const memberToken = await login(instance.app, 'elig.member', 'Elig-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };

    expect((await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload: capabilityPayload,
    })).statusCode).toBe(201);
    expect((await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/releases`,
      headers: ownerHeaders, payload: { scope: 'organisation' },
    })).statusCode).toBe(201);
    const eligibleUrl = `/projects/${projectId}/capabilities?kind=model_route`;
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: capabilityPayload.id })]);

    const denied = await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/eligibility`,
      headers: ownerHeaders,
      payload: { scope: 'project', projectId, decision: 'deny' },
    });
    expect(denied.statusCode).toBe(201);
    const policyId = (denied.json() as { id: string }).id;
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([]);

    const revoked = await instance.app.inject({
      method: 'DELETE', url: `/admin/capabilities/${capabilityPayload.id}/eligibility/${policyId}`,
      headers: ownerHeaders,
    });
    expect(revoked.statusCode).toBe(204);
    expect((await instance.app.inject({ method: 'GET', url: eligibleUrl, headers: memberHeaders })).json())
      .toEqual([expect.objectContaining({ id: capabilityPayload.id })]);

    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE organisation_id='org-001'
       AND event_type IN ('capability.eligibility.created','capability.eligibility.revoked') ORDER BY sequence`,
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'capability.eligibility.created', 'capability.eligibility.revoked',
    ]);
    await instance.close();
  }, 90_000);
  it('keeps API fallback routes in the existing execution pool behind capability governance', async () => {
    const owner = await seedUser('pool.owner', 'Pool-owner-2026!');
    const member = await seedUser('pool.member', 'Pool-member-2026!');
    await seedOrganisationMember(owner, 'owner');
    await seedOrganisationMember(member, 'member');
    const projectId = await seedProject(member);
    const instance = runtime();
    const ownerToken = await login(instance.app, 'pool.owner', 'Pool-owner-2026!');
    const memberToken = await login(instance.app, 'pool.member', 'Pool-member-2026!');
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, 'x-organisation-id': 'org-001' };
    const memberHeaders = { authorization: `Bearer ${memberToken}`, 'x-organisation-id': 'org-001' };

    expect((await instance.app.inject({
      method: 'POST', url: '/admin/capabilities', headers: ownerHeaders, payload: capabilityPayload,
    })).statusCode).toBe(201);
    expect((await instance.app.inject({
      method: 'POST', url: `/admin/capabilities/${capabilityPayload.id}/releases`,
      headers: ownerHeaders, payload: { scope: 'project', projectId },
    })).statusCode).toBe(201);

    const response = await instance.app.inject({
      method: 'GET', url: `/projects/${projectId}/ai-connections`, headers: memberHeaders,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { apiFallbackRoutes: Array<{ routeId: string }> };
    expect(body.apiFallbackRoutes.map((route) => route.routeId)).toEqual(['openai-api']);
    await instance.close();
  }, 90_000);});
