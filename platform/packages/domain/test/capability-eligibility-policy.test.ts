import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';
import {
  createCapabilityRecord,
  createCapabilityReleasePolicy,
  evaluateCapabilityEligibility,
} from '../src/index.js';

type EligibilityFactory = (input: Record<string, unknown>) => Record<string, unknown>;
function createEligibility(input: Record<string, unknown>) {
  const factory = (domain as unknown as { createCapabilityEligibilityPolicy?: EligibilityFactory })
    .createCapabilityEligibilityPolicy;
  expect(typeof factory).toBe('function');
  return factory!(input);
}

const capability = createCapabilityRecord({
  id: 'harness.codex', kind: 'harness', source: 'ecc', sourceRef: 'codex',
  displayName: 'Codex', maturity: 'supported', governanceState: 'approved',
  executionVerification: 'verified', createdBy: 'bootstrap',
  createdAt: new Date('2026-08-19T20:40:00.000Z'),
});
const release = createCapabilityReleasePolicy({
  id: 'release.codex.org', capabilityId: capability.id, scope: 'organisation',
  organisationId: 'org-001', createdBy: 'admin-001',
  createdAt: new Date('2026-08-19T20:40:00.000Z'),
});
const context = {
  organisationId: 'org-001', projectId: 'project-001', userId: 'user-001',
  projectRole: 'engineer', teamIds: ['team-a'], cohortIds: ['cohort-a'],
  allowTrialCalibration: false,
};
function decide(policies: Record<string, unknown>[]) {
  return (evaluateCapabilityEligibility as unknown as (input: Record<string, unknown>) => unknown)({
    capability, releases: [release], eligibilityPolicies: policies, context,
    technicalEligible: true, operationAuthorized: true, environmentEligible: true,
  });
}

describe('capability eligibility policy', () => {
  it('lets a durable project deny override an otherwise valid release', () => {
    const deny = createEligibility({
      id: 'elig.codex.project-deny', capabilityId: capability.id, scope: 'project',
      organisationId: 'org-001', projectId: 'project-001', decision: 'deny',
      createdBy: 'admin-001', createdAt: new Date('2026-08-19T20:40:00.000Z'),
    });
    expect(decide([deny])).toEqual({ selectable: false, reasons: ['policy_ineligible'] });
  });

  it('treats active allow policies as an explicit eligibility allow-list', () => {
    const allow = createEligibility({
      id: 'elig.codex.project-allow', capabilityId: capability.id, scope: 'project',
      organisationId: 'org-001', projectId: 'project-001', decision: 'allow',
      createdBy: 'admin-001', createdAt: new Date('2026-08-19T20:40:00.000Z'),
    });
    expect(decide([allow])).toEqual({ selectable: true, reasons: [] });
    const otherContext = { ...context, projectId: 'project-002' };
    const decision = (evaluateCapabilityEligibility as unknown as (input: Record<string, unknown>) => unknown)({
      capability, releases: [release], eligibilityPolicies: [allow], context: otherContext,
      technicalEligible: true, operationAuthorized: true, environmentEligible: true,
    });
    expect(decision).toEqual({ selectable: false, reasons: ['policy_ineligible'] });
  });

  it('never lets eligibility allow bypass release or execution authority', () => {
    const allow = createEligibility({
      id: 'elig.codex.user-allow', capabilityId: capability.id, scope: 'user',
      organisationId: 'org-001', userId: 'user-001', decision: 'allow',
      createdBy: 'admin-001', createdAt: new Date('2026-08-19T20:40:00.000Z'),
    });
    const decision = (evaluateCapabilityEligibility as unknown as (input: Record<string, unknown>) => unknown)({
      capability, releases: [], eligibilityPolicies: [allow], context,
      technicalEligible: true, operationAuthorized: true, environmentEligible: true,
    });
    expect(decision).toEqual({ selectable: false, reasons: ['not_released'] });
  });

  it('rejects malformed policy scope instead of broadening it', () => {
    expect(() => createEligibility({
      id: 'elig.bad', capabilityId: capability.id, scope: 'project',
      organisationId: 'org-001', decision: 'deny', createdBy: 'admin-001',
    })).toThrow(/projectId|scope/i);
  });
});