import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityEligibilityPolicy,
  createCapabilityRecord,
  createCapabilityReleasePolicy,
} from '@engineering-os/domain';
import { CapabilityEstateRepository } from '../src/capability-estate-repository.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const now = new Date('2026-08-19T21:45:00.000Z');
const later = new Date('2026-08-19T21:46:00.000Z');

function discovered(displayName = 'ECC Security Reviewer') {
  return createCapabilityRecord({
    id: 'ecc.agent.security-reviewer',
    kind: 'agent',
    source: 'ecc',
    sourceRef: 'agents/security-reviewer.md',
    displayName,
    maturity: 'supported',
    governanceState: 'discovered',
    executionVerification: 'unverified',
    createdBy: 'discovery:ecc',
    createdAt: later,
  });
}

describe('capability discovery reconciliation', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('adds a newly discovered capability without release or eligibility state', async () => {
    const repo = new CapabilityEstateRepository(pool);
    const record = discovered();
    const reconciled = await repo.reconcileDiscoveredCapability(record);
    expect(reconciled).toEqual(record);
    expect(await repo.listReleases(record.id)).toEqual([]);
    expect(await repo.listEligibilityPolicies(record.id)).toEqual([]);
  });

  it('refreshes source metadata without downgrading Admin governance, verification, release or eligibility', async () => {
    const repo = new CapabilityEstateRepository(pool);
    const approved = createCapabilityRecord({
      ...discovered('Old name'),
      governanceState: 'approved',
      executionVerification: 'verified',
      createdBy: 'admin-001',
      createdAt: now,
    });
    await repo.createCapability(approved);
    const release = createCapabilityReleasePolicy({
      id: 'release.security-reviewer', capabilityId: approved.id, scope: 'platform',
      createdBy: 'admin-001', createdAt: now,
    });
    await repo.createRelease(release);
    const eligibility = createCapabilityEligibilityPolicy({
      id: 'elig.security-reviewer', capabilityId: approved.id, scope: 'organisation',
      organisationId: 'org-001', decision: 'allow', createdBy: 'admin-001', createdAt: now,
    });
    await repo.createEligibilityPolicy(eligibility);

    const refreshed = await repo.reconcileDiscoveredCapability(discovered('Security Reviewer'));
    expect(refreshed.displayName).toBe('Security Reviewer');
    expect(refreshed.governanceState).toBe('approved');
    expect(refreshed.executionVerification).toBe('verified');
    expect(refreshed.createdBy).toBe('admin-001');
    expect(refreshed.createdAt).toEqual(now);
    expect(await repo.listReleases(approved.id)).toEqual([release]);
    expect(await repo.listEligibilityPolicies(approved.id)).toEqual([eligibility]);
  });

  it('fails closed when a discovered stable id collides with another source or kind', async () => {
    const repo = new CapabilityEstateRepository(pool);
    await repo.createCapability(createCapabilityRecord({
      ...discovered(), source: 'manual', kind: 'workflow', sourceRef: 'manual/security-reviewer',
      displayName: 'Manual capability', createdBy: 'admin-001', createdAt: now,
    }));
    await expect(repo.reconcileDiscoveredCapability(discovered())).rejects.toThrow(/collision|source|kind/i);
    const stored = await repo.getCapability('ecc.agent.security-reviewer');
    expect(stored).toMatchObject({ source: 'manual', kind: 'workflow', displayName: 'Manual capability' });
  });
});
