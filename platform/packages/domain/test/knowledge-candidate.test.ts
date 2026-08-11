import { describe, expect, it } from 'vitest';
import {
  createKnowledgeExtractionRun,
  createPendingKnowledgeCandidate,
  DomainValidationError,
  fingerprintKnowledgeCandidate,
  KNOWLEDGE_CANDIDATE_CATEGORIES,
  parseKnowledgeCandidateProposals,
  parseProductPartnerEnvelope,
} from '../src/index.js';

const scope = {
  organisationId: 'org-001',
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  extractionRunId: '33333333-3333-4333-8333-333333333333',
};

describe('Product Knowledge candidate domain', () => {
  it('creates a received extraction run with route provenance', () => {
    const run = createKnowledgeExtractionRun({
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      conversationId: scope.conversationId,
      sourceUserMessageId: '44444444-4444-4444-8444-444444444444',
      sourceAssistantMessageId: '55555555-5555-4555-8555-555555555555',
      provider: 'future-provider',
      model: 'future-model-v1',
      routeId: 'future-provider-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });

    expect(run.status).toBe('received');
    expect(run.provider).toBe('future-provider');
    expect(run.routeId).toBe('future-provider-api');
    expect(run.completedAt).toBeUndefined();
  });

  it('creates only pending candidates and trims proposal text', () => {
    const candidate = createPendingKnowledgeCandidate({
      ...scope,
      category: 'business_rules',
      title: '  Pass scope  ',
      content: '  A paid pass grants access to one event.  ',
      basis: 'user_stated',
    });

    expect(candidate.status).toBe('pending');
    expect(candidate.title).toBe('Pass scope');
    expect(candidate.content).toBe('A paid pass grants access to one event.');
    expect(candidate.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses one canonical non-aliased extraction category vocabulary', () => {
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).toContain('vision');
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).toContain('security');
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).toContain('architecture_decisions');
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).not.toContain('product_vision');
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).not.toContain('security_requirements');
    expect(KNOWLEDGE_CANDIDATE_CATEGORIES).not.toContain('open_questions');
  });

  it.each([
    [{ category: 'unknown_category' }, 'category'],
    [{ basis: 'assistant_fact' }, 'basis'],
    [{ title: '   ' }, 'title'],
    [{ content: '' }, 'content'],
  ])('rejects invalid candidate input %#', (override, field) => {
    expect(() => createPendingKnowledgeCandidate({
      ...scope,
      category: 'business_rules',
      title: 'Pass scope',
      content: 'A paid pass grants access to one event.',
      basis: 'user_stated',
      ...override,
    } as never)).toThrow(field);
  });

  it('normalises case and whitespace when fingerprinting', () => {
    const first = fingerprintKnowledgeCandidate({
      category: 'business_rules',
      title: 'Pass Scope',
      content: 'A paid   pass grants access to ONE event.',
    });
    const second = fingerprintKnowledgeCandidate({
      category: 'BUSINESS_RULES',
      title: '  pass scope ',
      content: ' a PAID pass grants access to one event. ',
    });
    const changed = fingerprintKnowledgeCandidate({
      category: 'business_rules',
      title: 'Pass Scope',
      content: 'A paid pass grants access to two events.',
    });

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });

  it('parses the answer independently from candidate semantic validation', () => {
    const envelope = parseProductPartnerEnvelope(JSON.stringify({
      answer: 'The product should clarify entitlement scope.',
      candidates: [{
        category: 'not-a-real-category',
        title: 'Bad candidate',
        content: 'This candidate is semantically invalid.',
        basis: 'user_stated',
      }],
    }));

    expect(envelope.answer).toBe('The product should clarify entitlement scope.');
    expect(() => parseKnowledgeCandidateProposals(envelope.candidates)).toThrow(DomainValidationError);
  });

  it('preserves a valid answer even when candidates is not an array', () => {
    const envelope = parseProductPartnerEnvelope(JSON.stringify({
      answer: 'The conversational answer is still usable.',
      candidates: { malformed: true },
    }));

    expect(envelope.answer).toBe('The conversational answer is still usable.');
    expect(() => parseKnowledgeCandidateProposals(envelope.candidates)).toThrow(DomainValidationError);
  });

  it('rejects model attempts to manufacture review state', () => {
    expect(() => parseKnowledgeCandidateProposals([{
      category: 'business_rules',
      title: 'Pass scope',
      content: 'One pass per event.',
      basis: 'user_stated',
      status: 'accepted',
    }])).toThrow(DomainValidationError);
  });

  it('parses valid model proposals without creating canonical knowledge', () => {
    const proposals = parseKnowledgeCandidateProposals([{
      category: 'risks',
      title: 'Rights clearance',
      content: 'Livestream and VOD rights require confirmation.',
      basis: 'assistant_inferred',
    }]);

    expect(proposals).toEqual([{
      category: 'risks',
      title: 'Rights clearance',
      content: 'Livestream and VOD rights require confirmation.',
      basis: 'assistant_inferred',
    }]);
  });
});
