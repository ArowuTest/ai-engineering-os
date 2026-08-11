import { createHash, randomUUID } from 'node:crypto';
import {
  DomainValidationError,
  requireNonBlank,
  requireStableIdentifier,
} from './validation.js';

export const KNOWLEDGE_CANDIDATE_CATEGORIES = [
  'vision',
  'problem_statement',
  'objectives',
  'stakeholders',
  'users',
  'personas',
  'business_model',
  'revenue_model',
  'functional_requirements',
  'non_functional_requirements',
  'user_journeys',
  'business_rules',
  'roles_permissions',
  'data',
  'integrations',
  'security',
  'regulatory_requirements',
  'performance_requirements',
  'availability_resilience',
  'ui_decisions',
  'architecture_decisions',
  'risks',
  'assumptions',
  'dependencies',
  'constraints',
  'decisions',
] as const;

export type KnowledgeCandidateCategory = (typeof KNOWLEDGE_CANDIDATE_CATEGORIES)[number];

export const KNOWLEDGE_CANDIDATE_BASES = [
  'user_stated',
  'assistant_inferred',
  'assistant_recommended',
] as const;

export type KnowledgeCandidateBasis = (typeof KNOWLEDGE_CANDIDATE_BASES)[number];
export type KnowledgeCandidateStatus = 'pending' | 'accepted' | 'rejected';
export type KnowledgeExtractionRunStatus = 'received' | 'succeeded' | 'failed';

export interface KnowledgeCandidateProposal {
  category: KnowledgeCandidateCategory;
  title: string;
  content: string;
  basis: KnowledgeCandidateBasis;
}

export interface KnowledgeExtractionRun {
  id: string;
  organisationId: string;
  projectId: string;
  conversationId: string;
  sourceUserMessageId: string;
  sourceAssistantMessageId: string;
  provider: string;
  model: string;
  routeId: string;
  responseContractVersion: string;
  status: KnowledgeExtractionRunStatus;
  createdAt: Date;
  completedAt?: Date;
}

export interface CreateKnowledgeExtractionRunInput {
  organisationId: string;
  projectId: string;
  conversationId: string;
  sourceUserMessageId: string;
  sourceAssistantMessageId: string;
  provider: string;
  model: string;
  routeId: string;
  responseContractVersion: string;
}

export interface KnowledgeCandidate {
  id: string;
  organisationId: string;
  projectId: string;
  extractionRunId: string;
  category: KnowledgeCandidateCategory;
  title: string;
  content: string;
  basis: KnowledgeCandidateBasis;
  status: KnowledgeCandidateStatus;
  fingerprint: string;
  createdAt: Date;
}

export interface CreatePendingKnowledgeCandidateInput extends KnowledgeCandidateProposal {
  organisationId: string;
  projectId: string;
  extractionRunId: string;
}

export interface ProductPartnerEnvelope {
  answer: string;
  candidates: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireCategory(value: unknown): KnowledgeCandidateCategory {
  if (
    typeof value !== 'string'
    || !KNOWLEDGE_CANDIDATE_CATEGORIES.includes(value as KnowledgeCandidateCategory)
  ) {
    throw new DomainValidationError('category', 'category must be a recognised Product Knowledge candidate category');
  }
  return value as KnowledgeCandidateCategory;
}

function requireBasis(value: unknown): KnowledgeCandidateBasis {
  if (
    typeof value !== 'string'
    || !KNOWLEDGE_CANDIDATE_BASES.includes(value as KnowledgeCandidateBasis)
  ) {
    throw new DomainValidationError('basis', 'basis must be user_stated, assistant_inferred, or assistant_recommended');
  }
  return value as KnowledgeCandidateBasis;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new DomainValidationError(field, `${field} contains unsupported fields: ${unexpected.join(', ')}`);
  }
}

function normaliseFingerprintText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function fingerprintKnowledgeCandidate(input: {
  category: string;
  title: string;
  content: string;
}): string {
  const material = [
    input.category.toLowerCase(),
    normaliseFingerprintText(input.title),
    normaliseFingerprintText(input.content),
  ].join('\u001f');
  return createHash('sha256').update(material).digest('hex');
}

export function createKnowledgeExtractionRun(
  input: CreateKnowledgeExtractionRunInput,
): KnowledgeExtractionRun {
  const provider = requireStableIdentifier(input.provider, 'provider');
  if (provider === 'auto') {
    throw new DomainValidationError('provider', 'provider cannot use the reserved auto routing sentinel');
  }

  return {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    conversationId: requireNonBlank(input.conversationId, 'conversationId'),
    sourceUserMessageId: requireNonBlank(input.sourceUserMessageId, 'sourceUserMessageId'),
    sourceAssistantMessageId: requireNonBlank(input.sourceAssistantMessageId, 'sourceAssistantMessageId'),
    provider,
    model: requireNonBlank(input.model, 'model'),
    routeId: requireStableIdentifier(input.routeId, 'routeId'),
    responseContractVersion: requireStableIdentifier(
      input.responseContractVersion,
      'responseContractVersion',
    ),
    status: 'received',
    createdAt: new Date(),
  };
}

export function createPendingKnowledgeCandidate(
  input: CreatePendingKnowledgeCandidateInput,
): KnowledgeCandidate {
  const category = requireCategory(input.category);
  const title = requireNonBlank(input.title, 'title');
  const content = requireNonBlank(input.content, 'content');
  const basis = requireBasis(input.basis);

  return {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    extractionRunId: requireNonBlank(input.extractionRunId, 'extractionRunId'),
    category,
    title,
    content,
    basis,
    status: 'pending',
    fingerprint: fingerprintKnowledgeCandidate({ category, title, content }),
    createdAt: new Date(),
  };
}

export function parseProductPartnerEnvelope(raw: string): ProductPartnerEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainValidationError('response', 'Product Partner response must be valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new DomainValidationError('response', 'Product Partner response must be an object');
  }

  return {
    answer: requireNonBlank(parsed.answer, 'answer'),
    candidates: parsed.candidates,
  };
}

export function parseKnowledgeCandidateProposals(value: unknown): KnowledgeCandidateProposal[] {
  if (!Array.isArray(value)) {
    throw new DomainValidationError('candidates', 'candidates must be an array');
  }

  return value.map((candidate, index) => {
    if (!isPlainObject(candidate)) {
      throw new DomainValidationError(`candidates[${index}]`, 'candidate must be an object');
    }
    assertExactKeys(candidate, ['category', 'title', 'content', 'basis'], `candidates[${index}]`);

    return {
      category: requireCategory(candidate.category),
      title: requireNonBlank(candidate.title, 'title'),
      content: requireNonBlank(candidate.content, 'content'),
      basis: requireBasis(candidate.basis),
    };
  });
}
