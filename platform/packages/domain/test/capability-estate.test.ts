import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

type EstateApi = {
  createCapabilityRecord(input: Record<string, unknown>): Record<string, unknown>;
  createCapabilityReleasePolicy(input: Record<string, unknown>): Record<string, unknown>;
  evaluateCapabilityEligibility(input: Record<string, unknown>): {
    selectable: boolean;
    reasons: string[];
  };
};

function estateApi(): EstateApi {
  const candidate = domain as unknown as Partial<EstateApi>;
  expect(typeof candidate.createCapabilityRecord).toBe('function');
  expect(typeof candidate.createCapabilityReleasePolicy).toBe('function');
  expect(typeof candidate.evaluateCapabilityEligibility).toBe('function');
  return candidate as EstateApi;
}

const now = new Date('2026-08-19T18:35:00.000Z');

function approvedCapability(api: EstateApi, overrides: Record<string, unknown> = {}) {
  return api.createCapabilityRecord({
    id: 'agent.backend', kind: 'agent', source: 'ecc', sourceRef: 'agents/backend',
    displayName: 'Backend', maturity: 'supported', governanceState: 'approved',
    executionVerification: 'verified', createdBy: 'bootstrap', createdAt: now,
    ...overrides,
  });
}
function projectRelease(api: EstateApi) {
  return api.createCapabilityReleasePolicy({
    id: 'release.backend.project', capabilityId: 'agent.backend',
    scope: 'project', organisationId: 'org-001', projectId: 'project-001',
    createdBy: 'admin-001', createdAt: now,
  });
}

function eligibilityInput(
  capability: Record<string, unknown>,
  releases: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    capability, releases,
    context: {
      organisationId: 'org-001', projectId: 'project-001', userId: 'user-001',
      projectRole: 'engineer', teamIds: [], cohortIds: [], allowTrialCalibration: false,
    },
    technicalEligible: true,
    operationAuthorized: true,
    environmentEligible: true,
    ...overrides,
  };
}

describe('governed capability estate', () => {
  it('keeps catalogue approval separate from Admin release', () => {
    const api = estateApi();
    const capability = approvedCapability(api);    expect(api.evaluateCapabilityEligibility(eligibilityInput(capability, []))).toEqual({
      selectable: false,
      reasons: ['not_released'],
    });
    expect(api.evaluateCapabilityEligibility(
      eligibilityInput(capability, [projectRelease(api)]),
    )).toEqual({ selectable: true, reasons: [] });
  });

  it('does not let release create technical, operation, or environment authority', () => {
    const api = estateApi();
    const capability = approvedCapability(api);
    const releases = [projectRelease(api)];
    expect(api.evaluateCapabilityEligibility(eligibilityInput(capability, releases, {
      technicalEligible: false,
    }))).toEqual({ selectable: false, reasons: ['technical_ineligible'] });
    expect(api.evaluateCapabilityEligibility(eligibilityInput(capability, releases, {
      operationAuthorized: false,
    }))).toEqual({ selectable: false, reasons: ['operation_unauthorized'] });
    expect(api.evaluateCapabilityEligibility(eligibilityInput(capability, releases, {
      environmentEligible: false,
    }))).toEqual({ selectable: false, reasons: ['environment_ineligible'] });
  });

  it('keeps trial and disabled catalogue entries out of ordinary user selection', () => {
    const api = estateApi();
    const releases = [projectRelease(api)];    const trial = approvedCapability(api, { governanceState: 'trial_calibration' });
    expect(api.evaluateCapabilityEligibility(eligibilityInput(trial, releases))).toEqual({
      selectable: false,
      reasons: ['trial_only'],
    });
    const disabled = approvedCapability(api, { governanceState: 'disabled' });
    expect(api.evaluateCapabilityEligibility(eligibilityInput(disabled, releases))).toEqual({
      selectable: false,
      reasons: ['disabled'],
    });
  });

  it('does not let a release for another project leak into this project', () => {
    const api = estateApi();
    const capability = approvedCapability(api);
    const other = api.createCapabilityReleasePolicy({
      id: 'release.backend.other', capabilityId: 'agent.backend',
      scope: 'project', organisationId: 'org-001', projectId: 'project-other',
      createdBy: 'admin-001', createdAt: now,
    });
    expect(api.evaluateCapabilityEligibility(eligibilityInput(capability, [other]))).toEqual({
      selectable: false,
      reasons: ['not_released'],
    });
  });
});