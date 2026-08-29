import { describe, expect, it } from 'vitest';
import { buildReviewCouncilEvidenceMaterial, createContextProvenance, createEvidenceEnvelope, createRuntimeCapabilityManifest } from '../src/index.js';

const now = new Date('2026-08-29T06:20:00Z');

describe('review council evidence material', () => {
  it('builds deterministic canonical evidence from source, gates, runtime and execution evidence', () => {
    const runtime = createRuntimeCapabilityManifest({
      runnerId: 'runner-a', observedAt: now,
      capabilities: [{
        id: 'browser', state: 'available', source: 'runtime_probe', supported: true,
        health: 'temporarily_unhealthy', retryability: 'retryable', reasonCode: 'transport_502',
      }],
    });
    const execution = createEvidenceEnvelope({
      id: 'evidence-001', kind: 'execution', status: 'pass', source: 'model_gateway',
      summary: 'execution completed',
      provenance: createContextProvenance({
        trustClass: 'directly_observed', sourceType: 'runtime', observedAt: now,
      }),
      organisationId: 'org-001', projectId: 'project-001', subjectType: 'task', subjectId: 'task-001',
      attribution: { providerId: 'openai', modelId: 'gpt-x', routeId: 'route-001' },
    });
    const input = {
      sourceSeal: { commit: 'abc123', tree: 'tree123', dirty: false },
      gates: [
        { id: 'typecheck', status: 'pass' as const, summary: 'TypeScript PASS' },
        { id: 'unit', status: 'pass' as const, summary: '428/428 GREEN' },
      ],
      runtimeCapabilities: [runtime], executionEvidence: [execution],
      requirementsReferences: ['SRS EXT-FR-023', 'SRS EXT-FR-021'],
      acceptanceCriteria: ['No unresolved blocking findings', 'Exact source sealed'],
      collectedAt: now,
    };
    const first = buildReviewCouncilEvidenceMaterial(input);
    const second = buildReviewCouncilEvidenceMaterial({
      ...input,
      gates: [...input.gates].reverse(),
      requirementsReferences: [...input.requirementsReferences].reverse(),
    });
    expect(first).toBe(second);
    expect(JSON.parse(first)).toMatchObject({
      schema: 'review_council_evidence_material_v1',
      sourceSeal: { commit: 'abc123', tree: 'tree123', dirty: false },
      gates: [{ id: 'typecheck', status: 'pass' }, { id: 'unit', status: 'pass' }],
      runtimeCapabilities: [{ runnerId: 'runner-a' }],
      executionEvidence: [{ id: 'evidence-001' }],
    });
  });

  it('rejects duplicate gates and secret-shaped evidence summaries', () => {
    expect(() => buildReviewCouncilEvidenceMaterial({
      gates: [{ id: 'unit', status: 'pass' }, { id: 'unit', status: 'pass' }], collectedAt: now,
    })).toThrow(/duplicate/i);
    expect(() => buildReviewCouncilEvidenceMaterial({
      gates: [{ id: 'unit', status: 'fail', summary: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }], collectedAt: now,
    })).toThrow(/secret|credential/i);
  });
});
