import { randomUUID } from 'node:crypto';
import { DomainValidationError, requireNonBlank } from './validation.js';

export const KNOWLEDGE_STATUSES = [
  'proposed',
  'inferred',
  'confirmed',
  'approved',
  'superseded',
  'rejected',
] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface ProductKnowledge {
  id: string;
  organisationId: string;
  projectId: string;
  category: string;
  title: string;
  content: string;
  source: string;
  status: KnowledgeStatus;
  revision: number;
  createdBy: string;
  createdAt: Date;
}

export interface CreateKnowledgeInput {
  organisationId: string;
  projectId: string;  category: string;
  title: string;
  content: string;
  source: string;
  status?: KnowledgeStatus;
  createdBy: string;
}

export interface ReviseKnowledgeInput {
  title?: string;
  content?: string;
  status?: KnowledgeStatus;
  createdBy: string;
}

function requireKnowledgeStatus(value: unknown): KnowledgeStatus {
  if (typeof value !== 'string' || !KNOWLEDGE_STATUSES.includes(value as KnowledgeStatus)) {
    throw new DomainValidationError('status', 'status must be a recognised knowledge lifecycle value');
  }
  return value as KnowledgeStatus;
}

export function createKnowledgeRecord(input: CreateKnowledgeInput): ProductKnowledge {
  return {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    category: requireNonBlank(input.category, 'category'),    title: requireNonBlank(input.title, 'title'),
    content: requireNonBlank(input.content, 'content'),
    source: requireNonBlank(input.source, 'source'),
    status: requireKnowledgeStatus(input.status ?? 'proposed'),
    revision: 1,
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: new Date(),
  };
}

export function reviseKnowledgeRecord(
  current: ProductKnowledge,
  input: ReviseKnowledgeInput,
): ProductKnowledge {
  return {
    ...current,
    title: input.title === undefined ? current.title : requireNonBlank(input.title, 'title'),
    content: input.content === undefined ? current.content : requireNonBlank(input.content, 'content'),
    status: input.status === undefined ? current.status : requireKnowledgeStatus(input.status),
    revision: current.revision + 1,
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: new Date(),
  };
}
