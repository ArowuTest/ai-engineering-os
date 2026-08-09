import type {
  ConversationMessage,
  ProductKnowledge,
  Project,
} from '@engineering-os/domain';
import type { ModelMessage, ModelProvider, ModelRequest } from '@engineering-os/model-gateway';

export interface BuildProductPartnerRequestInput {
  project: Project;
  knowledge: ProductKnowledge[];
  messages: ConversationMessage[];
  newUserContent: string;
}

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
    'Ask focused questions when a material decision is unresolved. Prefer concrete product language over implementation jargon unless architecture is directly relevant.',
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
    requiredCapabilities: ['chat'],
    routing,
  };
}
