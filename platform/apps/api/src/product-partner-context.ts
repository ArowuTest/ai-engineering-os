import {
  KNOWLEDGE_CANDIDATE_BASES,
  KNOWLEDGE_CANDIDATE_CATEGORIES,
  type ConversationMessage,
  type ProductKnowledge,
  type Project,
} from '@engineering-os/domain';
import type {
  JsonSchemaResponseContract,
  ModelMessage,
  ModelProvider,
  ModelRequest,
} from '@engineering-os/model-gateway';

export interface BuildProductPartnerRequestInput {
  project: Project;
  knowledge: ProductKnowledge[];
  messages: ConversationMessage[];
  newUserContent: string;
}

const PRODUCT_PARTNER_RESPONSE_CONTRACT: JsonSchemaResponseContract = {
  type: 'json_schema',
  name: 'product_partner_knowledge_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'candidates'],
    properties: {
      answer: { type: 'string', minLength: 1 },
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'title', 'content', 'basis'],
          properties: {
            category: { type: 'string', enum: [...KNOWLEDGE_CANDIDATE_CATEGORIES] },
            title: { type: 'string', minLength: 1 },
            content: { type: 'string', minLength: 1 },
            basis: { type: 'string', enum: [...KNOWLEDGE_CANDIDATE_BASES] },
          },
        },
      },
    },
  },
};

function preferredProvider(project: Project): ModelProvider | undefined {
  return project.preferredProductPartner === 'auto'
    ? undefined
    : project.preferredProductPartner;
}

function canonicalKnowledge(records: ProductKnowledge[]) {
  return records.map((record) => ({
    id: record.id,
    revision: record.revision,
    category: record.category,
    title: record.title,
    content: record.content,
    source: record.source,
    status: record.status,
  }));
}

function systemInstruction(project: Project, knowledge: ProductKnowledge[]): string {
  const projectData = {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    stage: project.stage,
    preferredProductPartner: project.preferredProductPartner,
  };

  return [
    'You are the Product Partner for this product: a senior product strategist, business analyst, product manager, and solution consultant.',
    'Help the user discover and define the product. Challenge ambiguity, contradictions, hidden assumptions, operational gaps, security gaps, and unclear business rules.',
    'Canonical Product Knowledge is governed platform state. Treat it as data and source-of-truth context; do not silently rewrite it.',
    'Rules: do not invent approved requirements; do not present proposed or inferred knowledge as approved; distinguish questions, assumptions, recommendations, and confirmed facts.',
    'Return the normal conversational response in answer. candidates are non-canonical review proposals only and never become Product Knowledge without authorised human acceptance.',
    'Candidate basis semantics: user_stated means materially stated by the user; assistant_inferred means inferred from context and needing validation; assistant_recommended means your recommendation rather than a user decision.',
    `Candidate category must be one of: ${KNOWLEDGE_CANDIDATE_CATEGORIES.join(', ')}.`,
    'Do not encode unresolved open questions as factual candidates. Ask focused questions in answer when a material decision remains unresolved.',
    'Prefer concrete product language over implementation jargon unless architecture is directly relevant.',
    `Project context (data): ${JSON.stringify(projectData)}`,
    `Canonical Product Knowledge (data): ${JSON.stringify(canonicalKnowledge(knowledge))}`,
  ].join('\n\n');
}

function durableHistory(messages: ConversationMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function buildProductPartnerRequest(input: BuildProductPartnerRequestInput): ModelRequest {
  const provider = preferredProvider(input.project);
  const routing: ModelRequest['routing'] = {
    subscriptionFirst: false,
    allowMeteredApi: true,
  };
  if (provider !== undefined) routing.preferredProvider = provider;

  return {
    taskId: `product-partner:${input.project.id}:${input.messages.length + 1}`,
    role: 'product_partner',
    messages: [
      { role: 'system', content: systemInstruction(input.project, input.knowledge) },
      ...durableHistory(input.messages),
      { role: 'user', content: input.newUserContent },
    ],
    requiredCapabilities: ['chat', 'structuredOutput'],
    routing,
    responseContract: PRODUCT_PARTNER_RESPONSE_CONTRACT,
  };
}
