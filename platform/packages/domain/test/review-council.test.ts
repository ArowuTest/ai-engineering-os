import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  buildBlindReviewPacket,
  classifyReviewerOutcome,
  createArchitectureInvariant,
  createCalibrationSnapshot,
  createFindingAdjudication,
  createReviewFinding,
  createReviewRun,
  createReviewerRechallenge,
  digestReviewMaterial,
  evaluateReviewGate,
  invalidateReviewRunForSource,
  type ReviewFinding
} from '../src/index.js';

const now = new Date('2026-08-16T20:00:00.000Z');
const source = 'commit:c9d487e1\nfile:a.ts\ncontent:alpha';
const evidence = 'tests:85/85\ntypecheck:pass';
const sourceDigest = digestReviewMaterial(source);
const evidenceDigest = digestReviewMaterial(evidence);

function materialFinding(severity: 'critical' | 'important' = 'important'): ReviewFinding {
  return createReviewFinding({
    id: `finding-${severity}`,
    reviewRunId: 'review-run-1',
    reviewerAssignmentId: 'assignment-1',
    severity,
    category: 'correctness',
    summary: 'A material defect exists',
    evidenceReferences: ['src/a.ts:10-20'],
    createdAt: now
  });
}
describe('Review Council domain', () => {
  it('creates a run with exact source/evidence digests and a stable packet digest', () => {
    const run = createReviewRun({
      id: 'review-run-1', organisationId: 'org-1', projectId: 'project-1',
      sourceDigest, evidenceDigest, createdBy: 'user-1', createdAt: now
    });
    expect(run.status).toBe('collecting');
    expect(run.sourceDigest).toBe(sourceDigest);
    expect(run.evidenceDigest).toBe(evidenceDigest);
    expect(run.packetDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds the same blind packet for every comparative reviewer', () => {
    const run = createReviewRun({
      id: 'review-run-1', organisationId: 'org-1', projectId: 'project-1',
      sourceDigest, evidenceDigest, createdBy: 'user-1', createdAt: now
    });
    const first = buildBlindReviewPacket(run, { source, evidence, invariantIds: ['inv-1'] });
    const second = buildBlindReviewPacket(run, { source, evidence, invariantIds: ['inv-1'] });
    expect(first).toEqual(second);
    expect(first.packetDigest).toBe(run.packetDigest);
    expect(first).not.toHaveProperty('findings');
    expect(first).not.toHaveProperty('adjudications');
  });
  it('classifies empty, timed-out, and malformed reviewer output as availability failure', () => {
    expect(classifyReviewerOutcome({ kind: 'completed', content: '' })).toEqual({
      status: 'availability_failure', reason: 'empty_output'
    });
    expect(classifyReviewerOutcome({ kind: 'timeout' })).toEqual({
      status: 'availability_failure', reason: 'timeout'
    });
    expect(classifyReviewerOutcome({ kind: 'malformed', detail: 'invalid-json' })).toEqual({
      status: 'availability_failure', reason: 'malformed_output'
    });
    expect(classifyReviewerOutcome({ kind: 'completed', content: 'NO FINDINGS' })).toEqual({
      status: 'completed', content: 'NO FINDINGS'
    });
  });

  it('supports the locked adjudication states and private rechallenge eligibility', () => {
    const finding = materialFinding();
    const rejected = createFindingAdjudication({
      id: 'adj-1', findingId: finding.id, reviewRunId: finding.reviewRunId,
      status: 'REJECTED', rationale: 'Contradicted by exact source evidence',
      evidenceReferences: ['src/a.ts:10-20'], adjudicatedBy: 'reviewer-independent', createdAt: now
    });
    expect(createReviewerRechallenge({
      id: 'rechallenge-1', reviewRunId: finding.reviewRunId, findingId: finding.id,
      reviewerAssignmentId: finding.reviewerAssignmentId, adjudicationStatus: rejected.status,
      promptDigest: digestReviewMaterial('private rechallenge'), createdAt: now
    }).visibility).toBe('private_original_reviewer');
  });
  it('blocks acceptance on independently adjudicated material findings regardless of majority', () => {
    const finding = materialFinding('important');
    const adjudication = createFindingAdjudication({
      id: 'adj-1', findingId: finding.id, reviewRunId: finding.reviewRunId,
      status: 'CONFIRMED', rationale: 'Reproduced by deterministic test',
      evidenceReferences: ['test:review-regression'], adjudicatedBy: 'independent-adjudicator', createdAt: now
    });
    expect(evaluateReviewGate([finding], [adjudication])).toEqual({
      status: 'blocked', blockingFindingIds: [finding.id]
    });
  });

  it('also blocks a material partially-valid finding until the valid defect is resolved', () => {
    const finding = materialFinding('critical');
    const adjudication = createFindingAdjudication({
      id: 'adj-2', findingId: finding.id, reviewRunId: finding.reviewRunId,
      status: 'PARTIALLY_VALID', rationale: 'Core defect is valid but scope was overstated',
      evidenceReferences: ['src/a.ts:10-20'], adjudicatedBy: 'independent-adjudicator', createdAt: now
    });
    expect(evaluateReviewGate([finding], [adjudication]).status).toBe('blocked');
  });

  it('does not let rejected, insufficient, minor, or observation findings block acceptance', () => {
    const finding = materialFinding('important');
    const rejected = createFindingAdjudication({
      id: 'adj-3', findingId: finding.id, reviewRunId: finding.reviewRunId,
      status: 'REJECTED', rationale: 'Source disproves the claim', evidenceReferences: ['src/a.ts:10-20'],
      adjudicatedBy: 'independent-adjudicator', createdAt: now
    });
    expect(evaluateReviewGate([finding], [rejected])).toEqual({ status: 'clear', blockingFindingIds: [] });
  });
  it('invalidates prior acceptance when material source changes', () => {
    const run = createReviewRun({
      id: 'review-run-1', organisationId: 'org-1', projectId: 'project-1',
      sourceDigest, evidenceDigest, createdBy: 'user-1', createdAt: now
    });
    const changed = invalidateReviewRunForSource(run, digestReviewMaterial(`${source}\nchanged`), now);
    expect(changed.status).toBe('invalidated');
    expect(changed.invalidatedAt).toEqual(now);
    expect(changed.invalidatedBySourceDigest).not.toBe(run.sourceDigest);
    expect(() => invalidateReviewRunForSource(run, sourceDigest, now)).toThrowError(DomainValidationError);
  });

  it('records calibration as route evidence rather than a permanent reviewer-role binding', () => {
    const snapshot = createCalibrationSnapshot({
      id: 'cal-1', organisationId: 'org-1', routeId: 'openrouter-grok',
      modelId: 'grok-4.6', modelVersion: '2026-08-16', sampleSize: 12,
      usefulFindingRate: 0.5, falsePositiveRate: 0.08, availabilityRate: 0.92,
      medianLatencyMs: 8200, averageCostUsd: 0.14, createdAt: now
    });
    expect(snapshot.routeId).toBe('openrouter-grok');
    expect(snapshot).not.toHaveProperty('role');
    expect(snapshot).not.toHaveProperty('permanentRole');
  });

  it('keeps architecture invariants explicit and evidence-addressable', () => {
    const invariant = createArchitectureInvariant({
      id: 'inv-1', key: 'runner-local-auth',
      description: 'Provider login material remains runner-local', severity: 'critical', createdAt: now
    });
    expect(invariant.key).toBe('runner-local-auth');
    expect(invariant.severity).toBe('critical');
  });
  it('rejects malformed digests and invalid calibration ratios', () => {
    expect(() => createReviewRun({
      id: 'review-run-1', organisationId: 'org-1', projectId: 'project-1',
      sourceDigest: 'not-a-digest', evidenceDigest, createdBy: 'user-1', createdAt: now
    })).toThrowError(DomainValidationError);

    expect(() => createCalibrationSnapshot({
      id: 'cal-1', organisationId: 'org-1', routeId: 'route-1', modelId: 'model-1',
      modelVersion: 'v1', sampleSize: 1, usefulFindingRate: 1.1, falsePositiveRate: 0,
      availabilityRate: 1, medianLatencyMs: 1, averageCostUsd: 0, createdAt: now
    })).toThrowError(DomainValidationError);
  });

  it('forbids rechallenge for confirmed findings because rechallenge is for rejected/partial adjudication only', () => {
    expect(() => createReviewerRechallenge({
      id: 'rechallenge-2', reviewRunId: 'review-run-1', findingId: 'finding-1',
      reviewerAssignmentId: 'assignment-1', adjudicationStatus: 'CONFIRMED',
      promptDigest: digestReviewMaterial('private rechallenge'), createdAt: now
    })).toThrowError(DomainValidationError);
  });
});
