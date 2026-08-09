import { describe, expect, it } from 'vitest';
import {
  createConversationMessage,
  createKnowledgeRecord,
  createProject,
} from '@engineering-os/domain';
import { buildProductPartnerRequest } from '../src/product-partner-context.js';

const project = createProject({
  organisationId: 'org-1',
  name: 'Enterprise Livestream',
  description: 'PPV, subscription, sponsored and telco-bundled streaming.',
  preferredProductPartner: 'anthropic',
  createdBy: 'user-1',
});

const knowledge = [
  createKnowledgeRecord({
    organisationId: 'org-1', projectId: project.id,
    category: 'vision', title: 'Audience',
    content: 'Serve promoters, telcos and consumers at enterprise scale.',
    source: 'product_studio_user', status: 'confirmed', createdBy: 'user-1',
  }),
  createKnowledgeRecord({
    organisationId: 'org-1', projectId: project.id,
    category: 'risks', title: 'Rights',
    content: 'Rights ownership still needs validation.',
    source: 'product_partner', status: 'inferred', createdBy: 'agent-1',
  }),
];

const conversationId = '11111111-1111-4111-8111-111111111111';
const messages = [
  createConversationMessage({
    organisationId: 'org-1', projectId: project.id, conversationId,
    role: 'user', content: 'I want flexible monetisation.', createdBy: 'user-1',
  }),
  createConversationMessage({
    organisationId: 'org-1', projectId: project.id, conversationId,
    role: 'assistant', content: 'Which monetisation modes are mandatory?',
    provider: 'openai', createdBy: 'agent-openai',
  }),
];

describe('Product Partner context', () => {
  it('builds governed context and preserves durable history in order', () => {
    const request = buildProductPartnerRequest({
      project,
      knowledge,
      messages,
      newUserContent: 'PPV, subscriptions, sponsorship and telco bundles.',
    });

    expect(request.role).toBe('product_partner');
    expect(request.requiredCapabilities).toEqual(['chat']);
    expect(request.routing).toEqual({
      subscriptionFirst: false,
      allowMeteredApi: true,
      preferredProvider: 'anthropic',
    });

    const system = request.messages[0]?.content ?? '';
    expect(request.messages[0]?.role).toBe('system');
    expect(system).toContain('Enterprise Livestream');
    expect(system).toContain('Canonical Product Knowledge');
    expect(system).toContain('do not invent approved requirements');
    expect(system).toContain('Serve promoters, telcos and consumers at enterprise scale.');
    expect(system).toContain('"status":"inferred"');
    expect(system).toContain('"source":"product_partner"');

    expect(request.messages.slice(1).map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'I want flexible monetisation.' },
      { role: 'assistant', content: 'Which monetisation modes are mandatory?' },
      { role: 'user', content: 'PPV, subscriptions, sponsorship and telco bundles.' },
    ]);
  });

  it('leaves provider preference unset in Auto mode', () => {
    const autoProject = { ...project, preferredProductPartner: 'auto' as const };
    const request = buildProductPartnerRequest({
      project: autoProject,
      knowledge: [],
      messages: [],
      newUserContent: 'Start discovery.',
    });
    expect(request.routing.preferredProvider).toBeUndefined();
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: 'Start discovery.' });
  });
});
