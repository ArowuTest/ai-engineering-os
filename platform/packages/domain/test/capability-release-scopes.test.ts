import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

type Api = {
  createCapabilityRecord(input: Record<string, unknown>): Record<string, unknown>;
  createCapabilityReleasePolicy(input: Record<string, unknown>): Record<string, unknown>;
  evaluateCapabilityEligibility(input: Record<string, unknown>): { selectable: boolean; reasons: string[] };
};
const api = domain as unknown as Api;
const now = new Date('2026-08-19T18:45:00.000Z');
const capability = () => api.createCapabilityRecord({
  id: 'harness.codex', kind: 'harness', source: 'ecc', sourceRef: 'harnesses/codex',
  displayName: 'Codex', maturity: 'supported', governanceState: 'approved',
  executionVerification: 'verified', createdBy: 'bootstrap', createdAt: now,
});
const context = (overrides: Record<string, unknown> = {}) => ({
  organisationId: 'org-001', projectId: 'project-001', userId: 'user-001',
  projectRole: 'engineer', teamIds: ['team-red'], cohortIds: ['cohort-a'],
  allowTrialCalibration: false, ...overrides,
});
function release(scope: string, extra: Record<string, unknown> = {}) {
  return api.createCapabilityReleasePolicy({
    id: `release.${scope}.codex`, capabilityId: 'harness.codex', scope,
    createdBy: 'admin-001', createdAt: now, ...extra,
  });
}
function decide(releases: Record<string, unknown>[], ctx = context()) {
  return api.evaluateCapabilityEligibility({
    capability: capability(), releases, context: ctx,
    technicalEligible: true, operationAuthorized: true, environmentEligible: true,
  });
}
describe('capability release scopes', () => {
  it('matches platform, organisation, project-role, team, cohort and user releases independently', () => {
    const cases = [
      release('platform'),
      release('organisation', { organisationId: 'org-001' }),
      release('project_role', { organisationId: 'org-001', projectRole: 'engineer' }),
      release('team', { organisationId: 'org-001', teamId: 'team-red' }),
      release('cohort', { organisationId: 'org-001', cohortId: 'cohort-a' }),
      release('user', { organisationId: 'org-001', userId: 'user-001' }),
    ];
    for (const item of cases) {
      expect(decide([item])).toEqual({ selectable: true, reasons: [] });
    }
  });

  it('does not leak scoped releases across tenant, role, team, cohort or user boundaries', () => {
    const cases: Array<[Record<string, unknown>, ReturnType<typeof context>]> = [
      [release('organisation', { organisationId: 'org-other' }), context()],
      [release('project_role', { organisationId: 'org-001', projectRole: 'reviewer' }), context()],
      [release('team', { organisationId: 'org-001', teamId: 'team-blue' }), context()],
      [release('cohort', { organisationId: 'org-001', cohortId: 'cohort-b' }), context()],
      [release('user', { organisationId: 'org-001', userId: 'user-other' }), context()],
    ];
    for (const [item, ctx] of cases) {
      expect(decide([item], ctx)).toEqual({ selectable: false, reasons: ['not_released'] });
    }
  });
  it('keeps execution verification separate from Admin release', () => {
    const unverified = api.createCapabilityRecord({
      id: 'harness.codex', kind: 'harness', source: 'ecc', sourceRef: 'harnesses/codex',
      displayName: 'Codex', maturity: 'supported', governanceState: 'approved',
      executionVerification: 'unverified', createdBy: 'bootstrap', createdAt: now,
    });
    expect(api.evaluateCapabilityEligibility({
      capability: unverified,
      releases: [release('platform')],
      context: context(),
      technicalEligible: true,
      operationAuthorized: true,
      environmentEligible: true,
    })).toEqual({ selectable: false, reasons: ['execution_unverified'] });
  });

  it('rejects malformed scoped releases instead of broadening them', () => {
    expect(() => release('organisation')).toThrow(/organisationId|scope/i);
    expect(() => release('user', { organisationId: 'org-001' })).toThrow(/userId|scope/i);
    expect(() => release('team', { organisationId: 'org-001' })).toThrow(/teamId|scope/i);
    expect(() => release('cohort', { organisationId: 'org-001' })).toThrow(/cohortId|scope/i);
    expect(() => release('project_role', { organisationId: 'org-001' })).toThrow(/projectRole|scope/i);
  });
});