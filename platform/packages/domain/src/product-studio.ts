import { randomUUID } from 'node:crypto';
import type { ProductKnowledge } from './product-knowledge.js';
import {
  DomainValidationError,
  requireNonBlank,
  requireStableIdentifier,
} from './validation.js';

export const CONVERSATION_PURPOSES = ['product_discovery'] as const;
export type ConversationPurpose = (typeof CONVERSATION_PURPOSES)[number];

export const CONVERSATION_ROLES = ['user', 'assistant', 'system'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export type MessageProvider = string;

export interface ProductConversation {
  id: string;
  organisationId: string;
  projectId: string;
  purpose: ConversationPurpose;
  createdBy: string;
  createdAt: Date;
}

export interface CreateConversationInput {
  organisationId: string;
  projectId: string;
  createdBy: string;
}

export interface ConversationMessage {
  id: string;
  organisationId: string;
  projectId: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  provider?: MessageProvider;
  createdBy: string;
  createdAt: Date;
}

export interface CreateConversationMessageInput {
  organisationId: string;
  projectId: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  provider?: MessageProvider;
  createdBy: string;
}

function requireRole(value: unknown): ConversationRole {
  if (typeof value !== 'string' || !CONVERSATION_ROLES.includes(value as ConversationRole)) {
    throw new DomainValidationError('role', 'role must be user, assistant, or system');
  }
  return value as ConversationRole;
}

function requireProvider(value: unknown): MessageProvider {
  return requireStableIdentifier(value, 'provider');
}

export function createConversation(input: CreateConversationInput): ProductConversation {
  return {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    purpose: 'product_discovery',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: new Date(),
  };
}

export function createConversationMessage(input: CreateConversationMessageInput): ConversationMessage {
  const message: ConversationMessage = {
    id: randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    conversationId: requireNonBlank(input.conversationId, 'conversationId'),
    role: requireRole(input.role),
    content: requireNonBlank(input.content, 'content'),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: new Date(),
  };

  if (input.provider !== undefined) message.provider = requireProvider(input.provider);
  return message;
}

export const PRODUCT_COMPLETENESS_CATEGORIES = [
  'vision',
  'objectives',
  'users',
  'business_model',
  'functional_requirements',
  'non_functional_requirements',
  'business_rules',
  'integrations',
  'security',
  'data',
  'user_journeys',
  'risks',
] as const;

export interface ProductCompleteness {
  percentage: number;
  coveredCategories: string[];
  missingCategories: string[];
}

export function calculateProductCompleteness(records: ProductKnowledge[]): ProductCompleteness {
  const covered = new Set(
    records
      .filter((record) => record.status !== 'rejected')
      .map((record) => record.category)
      .filter((category) => PRODUCT_COMPLETENESS_CATEGORIES.includes(category as never)),
  );

  const coveredCategories = PRODUCT_COMPLETENESS_CATEGORIES.filter((category) => covered.has(category));
  const missingCategories = PRODUCT_COMPLETENESS_CATEGORIES.filter((category) => !covered.has(category));

  return {
    percentage: Math.round((coveredCategories.length / PRODUCT_COMPLETENESS_CATEGORIES.length) * 100),
    coveredCategories: [...coveredCategories],
    missingCategories: [...missingCategories],
  };
}
