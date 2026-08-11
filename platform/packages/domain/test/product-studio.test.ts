import { describe, expect, it } from 'vitest';
import {
  calculateProductCompleteness,
  changeProjectProductPartner,
  createConversation,
  createConversationMessage,
  createKnowledgeRecord,
  createProject,
  DomainValidationError,
  type MessageProvider,
  type ProductPartner,
} from '../src/index.js';

describe('Product Studio project state', () => {
  it('starts new projects in discovery with Auto routing by default', () => {
    const project = createProject({ organisationId: 'org-1', name: 'Studio', createdBy: 'user-1' });
    expect(project.stage).toBe('discovery');
    expect(project.preferredProductPartner).toBe('auto');
    expect(project.updatedAt).toEqual(project.createdAt);
  });

  it('changes Product Partner without changing project identity or stage', () => {
    const project = createProject({ organisationId: 'org-1', name: 'Studio', createdBy: 'user-1' });
    const changed = changeProjectProductPartner(
      project,
      'future-provider.v2' as ProductPartner,
    );
    expect(changed.id).toBe(project.id);
    expect(changed.stage).toBe('discovery');
    expect(changed.preferredProductPartner).toBe('future-provider.v2');
  });
});

describe('Product Studio conversations', () => {
  it('creates a product-discovery conversation scoped to one project', () => {
    const conversation = createConversation({
      organisationId: 'org-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      createdBy: 'user-1',
    });
    expect(conversation.purpose).toBe('product_discovery');
    expect(conversation.organisationId).toBe('org-1');
  });

  it('creates append-only message records with extensible provider attribution', () => {
    const message = createConversationMessage({
      organisationId: 'org-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      role: 'assistant',
      content: 'Challenge the monetisation assumption.',
      provider: 'future-provider' as MessageProvider,
      createdBy: 'agent-product',
    });
    expect(message.role).toBe('assistant');
    expect(message.provider).toBe('future-provider');
    expect(message.content).toBe('Challenge the monetisation assumption.');
  });

  it.each(['', 'OpenAI', 'provider name', 'x'.repeat(65)])(
    'rejects unsafe message provider attribution %j',
    (provider) => {
      expect(() =>
        createConversationMessage({
          organisationId: 'org-1',
          projectId: '11111111-1111-4111-8111-111111111111',
          conversationId: '22222222-2222-4222-8222-222222222222',
          role: 'assistant',
          content: 'Invalid provider attribution.',
          provider: provider as MessageProvider,
          createdBy: 'agent-product',
        }),
      ).toThrowError(DomainValidationError);
    },
  );

  it('rejects unsupported message roles', () => {
    expect(() => createConversationMessage({
      organisationId: 'org-1', projectId: 'p', conversationId: 'c',
      role: 'owner' as never, content: 'No', createdBy: 'user-1',
    })).toThrowError(DomainValidationError);
  });
});

describe('Product completeness', () => {
  it('measures category coverage and excludes rejected records', () => {
    const base = {
      organisationId: 'org-1', projectId: 'project-1', createdBy: 'user-1', source: 'discovery',
    };
    const records = [
      createKnowledgeRecord({ ...base, category: 'vision', title: 'Vision', content: 'Build better software.' }),
      createKnowledgeRecord({ ...base, category: 'security', title: 'Security', content: 'Least privilege.', status: 'confirmed' }),
      createKnowledgeRecord({ ...base, category: 'risks', title: 'Risk', content: 'Quota risk.', status: 'rejected' }),
    ];

    const completeness = calculateProductCompleteness(records);
    expect(completeness.coveredCategories).toEqual(expect.arrayContaining(['vision', 'security']));
    expect(completeness.coveredCategories).not.toContain('risks');
    expect(completeness.missingCategories).toContain('risks');
    expect(completeness.percentage).toBe(17);
  });

  it('ignores unrecognised categories when calculating coverage', () => {
    const record = createKnowledgeRecord({
      organisationId: 'org-1', projectId: 'project-1', createdBy: 'user-1', source: 'upload',
      category: 'other_notes', title: 'Note', content: 'Useful but not part of completeness.',
    });
    expect(calculateProductCompleteness([record]).percentage).toBe(0);
  });
});
