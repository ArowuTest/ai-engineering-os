import { describe, expect, it } from 'vitest';
import {
  createAssuranceFinding,
  createAssuranceRun,
  evaluateAssuranceReadiness,
  invalidateAssuranceRunForTarget,
  markAssuranceRunAvailabilityFailure,
  closeAssuranceFinding,
} from '../src/index.js';

const now = new Date('2026-08-20T10:30:00.000Z');
const targetDigest = 'a'.repeat(64);

function run() {
  return createAssuranceRun({
    id: 'assurance_run_001', organisationId: 'org-001',
    projectId: '11111111-1111-4111-8111-111111111111',
    profileId: 'product_requirements_v1', targetType: 'product_requirements',
    targetDigest, reviewerAgentCapabilityId: 'agent.requirements_reviewer',
    reviewerRouteId: 'anthropic-studio-api', createdBy: 'user-001', createdAt: now,
  });
}

describe('generic Assurance domain', () => {
  it('creates an exact-target collecting run with independent reviewer agent and route', () => {
    expect(run()).toMatchObject({
      profileId: 'product_requirements_v1', targetType: 'product_requirements',
      targetDigest, reviewerAgentCapabilityId: 'agent.requirements_reviewer',
      reviewerRouteId: 'anthropic-studio-api', status: 'collecting',
    });
  });

  it('creates structured findings that distinguish trained knowledge from project evidence', () => {
    const finding = createAssuranceFinding({
      id: 'assurance_finding_001', assuranceRunId: run().id,
      severity: 'important', kind: 'failure_mode', category: 'payments',
      summary: 'Unknown payment-provider state has no recovery rule.',
      rationale: 'Timeout after submission can leave entitlement state ambiguous.',
      proposedQuestion: 'How should UNKNOWN payment state be reconciled?',
      basis: 'trained_knowledge', evidenceReferences: ['knowledge:payments-flow'],
      createdAt: now,
    });
    expect(finding.basis).toBe('trained_knowledge');
    expect(finding.status).toBe('open');
  });

  it('blocks readiness for open critical or important findings', () => {
    const finding = createAssuranceFinding({
      id: 'assurance_finding_002', assuranceRunId: run().id,
      severity: 'important', kind: 'missing_requirement', category: 'resilience',
      summary: 'No recovery objective is defined.', rationale: 'Recovery expectations are unresolved.',
      basis: 'project_evidence', evidenceReferences: ['knowledge:resilience'], createdAt: now,
    });
    expect(evaluateAssuranceReadiness(run(), [finding], { reviewerCompleted: true })).toEqual({
      status: 'not_ready', blockingFindingIds: [finding.id],
    });
  });

  it('treats material research-required findings as blocking until resolved', () => {
    const finding = createAssuranceFinding({
      id: 'assurance_finding_003', assuranceRunId: run().id,
      severity: 'important', kind: 'research_required', category: 'regulation',
      summary: 'Current regulatory applicability needs verification.',
      rationale: 'The claim depends on current external regulation.',
      basis: 'trained_knowledge', evidenceReferences: [], createdAt: now,
    });
    expect(evaluateAssuranceReadiness(run(), [finding], { reviewerCompleted: true }).status)
      .toBe('not_ready');
  });

  it('records reviewer availability failure as durable insufficient evidence', () => {
    const failed = markAssuranceRunAvailabilityFailure(
      run(), 'provider_failure', new Date(now.getTime() + 500),
    );
    expect(failed).toMatchObject({
      status: 'availability_failure', availabilityReason: 'provider_failure',
    });
    expect(evaluateAssuranceReadiness(failed, [], { reviewerCompleted: false })).toEqual({
      status: 'insufficient_evidence', blockingFindingIds: [],
    });
  });

  it('is ready only after completed review with no open material findings', () => {
    const observation = createAssuranceFinding({
      id: 'assurance_finding_004', assuranceRunId: run().id,
      severity: 'observation', kind: 'recommendation', category: 'analytics',
      summary: 'Consider richer funnel telemetry.', rationale: 'Useful but not readiness-blocking.',
      basis: 'trained_knowledge', evidenceReferences: [], createdAt: now,
    });
    expect(evaluateAssuranceReadiness(run(), [observation], { reviewerCompleted: true })).toEqual({
      status: 'ready', blockingFindingIds: [],
    });
  });

  it('invalidates readiness evidence when the governed target digest changes', () => {
    const invalidated = invalidateAssuranceRunForTarget(run(), 'b'.repeat(64), new Date(now.getTime() + 1));
    expect(invalidated).toMatchObject({ status: 'invalidated', invalidatedByTargetDigest: 'b'.repeat(64) });
    expect(() => invalidateAssuranceRunForTarget(run(), targetDigest, now)).toThrow(/differ/i);
  });
});

describe('Assurance finding closure', () => {
  it('requires an explicit actor and resolution note before a material finding stops blocking', () => {
    const finding = createAssuranceFinding({
      id: 'assurance_finding_005', assuranceRunId: run().id,
      severity: 'important', kind: 'ambiguity', category: 'identity',
      summary: 'Account recovery ownership is ambiguous.',
      rationale: 'The current exact requirements state leaves recovery authority unclear.',
      basis: 'project_evidence', evidenceReferences: ['knowledge:identity'], createdAt: now,
    });
    const closed = closeAssuranceFinding(finding, {
      status: 'dismissed', resolvedBy: 'product-owner-001',
      resolutionNote: 'Not applicable: this deployment is invitation-only and has no self-service recovery.',
      resolvedAt: new Date(now.getTime() + 1000),
    });
    expect(closed).toMatchObject({ status: 'dismissed', resolvedBy: 'product-owner-001' });
    expect(closed.resolutionNote).toMatch(/invitation-only/);
    expect(evaluateAssuranceReadiness(run(), [closed], { reviewerCompleted: true }).status).toBe('ready');
  });

  it('does not permit reopening or silently re-closing a terminal finding', () => {
    const finding = createAssuranceFinding({
      id: 'assurance_finding_006', assuranceRunId: run().id,
      severity: 'important', kind: 'edge_case', category: 'billing',
      summary: 'Duplicate charge handling is unclear.', rationale: 'A retry may duplicate a payment.',
      basis: 'trained_knowledge', evidenceReferences: [], createdAt: now,
    });
    const closed = closeAssuranceFinding(finding, {
      status: 'resolved', resolvedBy: 'product-owner-001', resolutionNote: 'Existing idempotency rule covers it.',
      resolvedAt: new Date(now.getTime() + 1000),
    });
    expect(() => closeAssuranceFinding(closed, {
      status: 'dismissed', resolvedBy: 'product-owner-001', resolutionNote: 'Change my mind.',
      resolvedAt: new Date(now.getTime() + 2000),
    })).toThrow(/open/i);
  });
});
