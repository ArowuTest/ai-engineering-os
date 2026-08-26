import { describe, expect, it } from 'vitest';
import {
  createContextProvenance,
  createEvidenceEnvelope,
  type EvidenceEnvelope,
} from '../src/index.js';

const observedAt = new Date('2026-08-26T12:00:00Z');

function base(): EvidenceEnvelope {
  return createEvidenceEnvelope({
    id: 'evidence-001',
    kind: 'execution',
    status: 'pass',
    source: 'model_gateway',
    summary: 'Product Partner execution completed',
    provenance: createContextProvenance({
      trustClass: 'directly_observed',
      sourceType: 'runtime',
      sourceRef: 'route:openrouter-user-route',
      observedAt,
    }),
    organisationId: 'org-001',
    projectId: 'project-001',
    subjectType: 'conversation_message',
    subjectId: 'message-001',
    attribution: {
      requesterUserId: 'user-001',
      agentId: 'agent.product-partner',
      providerId: 'openrouter',
      modelId: 'vendor/model-a',
      routeId: 'openrouter-user-route',
      connection: { id: 'connection-user-001', ownerType: 'user', ownerId: 'user-001' },
      harnessId: 'harness.auto',
      usage: { inputTokens: 7, outputTokens: 3 },
      costType: 'metered_api',
    },
  });
}

describe('generic AIOS evidence envelope', () => {
  it('captures durable subject, trust and execution attribution without credential material', () => {
    const evidence = base();
    expect(evidence).toMatchObject({
      id: 'evidence-001', kind: 'execution', status: 'pass', source: 'model_gateway',
      organisationId: 'org-001', projectId: 'project-001',
      subjectType: 'conversation_message', subjectId: 'message-001',
      attribution: {
        requesterUserId: 'user-001', providerId: 'openrouter', modelId: 'vendor/model-a',
        routeId: 'openrouter-user-route',
        connection: { id: 'connection-user-001', ownerType: 'user', ownerId: 'user-001' },
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    expect(evidence.provenance.instructionBearing).toBe(false);
  });

  it('allows unavailable future attribution dimensions to remain absent rather than fabricated', () => {
    const evidence = base();
    expect(evidence.attribution).not.toHaveProperty('runnerId');
    expect(evidence.attribution).not.toHaveProperty('environmentId');
    expect(evidence.attribution).not.toHaveProperty('budgetRef');
  });

  it('rejects instruction-bearing evidence and secret-shaped summary or cost references', () => {
    expect(() => createEvidenceEnvelope({
      ...base(),
      provenance: createContextProvenance({
        trustClass: 'canonical', sourceType: 'platform', observedAt, instructionBearing: true,
      }),
    })).toThrow(/instruction/i);
    expect(() => createEvidenceEnvelope({
      ...base(), summary: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
    })).toThrow(/secret|credential/i);
    expect(() => createEvidenceEnvelope({
      ...base(), attribution: { ...base().attribution, costReference: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
    })).toThrow(/secret|credential/i);
  });
});
