import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityRecord,
  createCapabilityReleasePolicy,
} from '@engineering-os/domain';
import {
  AuditRepository,
  CapabilityEstateRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  PlatformMembershipRepository,
  ProjectRepository,
  UserRepository,
} from '@engineering-os/database';
import { ModelGateway } from '@engineering-os/model-gateway';
import { CapabilityEstateService, CapabilityEstateServiceError } from '../src/capability-estate-service.js';
import {
  closeDatabase, pool, resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const now = new Date('2026-08-19T23:10:00.000Z');
async function seedUser(userId: string) {
  const id = randomUUID();
  await new UserRepository(pool).create({
    id, userId, passwordHash: 'test-hash', status: 'active', createdAt: now, updatedAt: now,
  });
  return id;
}

function service(discover: () => Promise<Array<Record<string, unknown>>>) {
  return new CapabilityEstateService({
    unitOfWork: new DatabaseUnitOfWork(pool),
    capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool),
    platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool),
    modelGateway: new ModelGateway(),
    eccCapabilityDiscovery: discover,
  } as never);
}

beforeEach(async () => resetDatabase());
afterAll(async () => closeDatabase());

describe('ECC capability refresh', () => {
  it('requires Platform Admin before discovery is invoked', async () => {
    const ordinaryId = await seedUser('refresh.ordinary');
    let discoveryCalls = 0;
    const store = service(async () => {
      discoveryCalls += 1;
      return [];
    });
    await expect(store.refreshEccInventory({ actorUserId: ordinaryId, now }))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(discoveryCalls).toBe(0);
  });

  it('reconciles ECC metadata without auto-publishing or downgrading existing Admin state', async () => {
    const adminId = await seedUser('refresh.admin');
    await new PlatformMembershipRepository(pool).grantAdmin({
      userId: adminId, createdBy: 'bootstrap', now,
    });
    const capabilities = new CapabilityEstateRepository(pool);
    const approved = createCapabilityRecord({
      id: 'ecc.skill.security-review', kind: 'skill', source: 'ecc',
      sourceRef: 'skills/security-review-old', displayName: 'Old Security Review',
      maturity: 'experimental', governanceState: 'approved', executionVerification: 'verified',
      createdBy: 'bootstrap', createdAt: now,
    });
    await capabilities.createCapability(approved);
    const release = createCapabilityReleasePolicy({
      id: 'release.security-review', capabilityId: approved.id, scope: 'organisation',
      organisationId: 'org-001', createdBy: 'admin-001', createdAt: now,
    });
    await capabilities.createRelease(release);

    const refreshedAt = new Date(now.getTime() + 60_000);
    const store = service(async () => [
      {
        id: approved.id, kind: 'skill', source: 'ecc', sourceRef: 'skills/security-review',
        displayName: 'Security Review', maturity: 'supported',
        governanceState: 'discovered', executionVerification: 'unverified',
      },
      {
        id: 'ecc.harness.codex', kind: 'harness', source: 'ecc', sourceRef: 'harness:codex',
        displayName: 'Codex', maturity: 'supported',
        governanceState: 'discovered', executionVerification: 'unverified',
      },
    ]);
    const result = await store.refreshEccInventory({ actorUserId: adminId, now: refreshedAt });
    expect(result).toMatchObject({ discovered: 2, reconciled: 2 });
    expect(await capabilities.getCapability(approved.id)).toMatchObject({
      sourceRef: 'skills/security-review', displayName: 'Security Review', maturity: 'supported',
      governanceState: 'approved', executionVerification: 'verified',
    });
    expect(await capabilities.listReleases(approved.id)).toEqual([release]);
    expect(await capabilities.getCapability('ecc.harness.codex')).toMatchObject({
      governanceState: 'discovered', executionVerification: 'unverified',
    });
    expect(await capabilities.listReleases('ecc.harness.codex')).toEqual([]);
    const platformAudit = await new AuditRepository(pool).listPlatform();
    expect(platformAudit).toEqual([
      expect.objectContaining({
        eventType: 'capability.catalogue.refreshed',
        subjectType: 'capability_catalogue', subjectId: 'ecc',
        metadata: expect.objectContaining({ discovered: 2, reconciled: 2 }),
      }),
    ]);
  });
});
