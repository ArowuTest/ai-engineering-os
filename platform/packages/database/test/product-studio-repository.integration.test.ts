import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changeProjectProductPartner,
  createConversation,
  createConversationMessage,
  createProject,
} from '@engineering-os/domain';
import { ConversationRepository, ProjectRepository } from '../src/index.js';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const projects = new ProjectRepository(pool);
const conversations = new ConversationRepository(pool);

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('Product Studio persistence', () => {
  it('round-trips lifecycle and partner state and lists only one organisation', async () => {
    const first = createProject({
      organisationId: 'org-001', name: 'First', preferredProductPartner: 'google', createdBy: 'user-1',
    });
    const other = createProject({ organisationId: 'org-002', name: 'Other', createdBy: 'user-2' });
    await projects.create(first);
    await projects.create(other);

    const loaded = await projects.getById('org-001', first.id);
    expect(loaded?.preferredProductPartner).toBe('google');
    expect(loaded?.stage).toBe('discovery');
    expect((await projects.listByOrganisation('org-001')).map((project) => project.id)).toEqual([first.id]);
  });

  it('persists a Product Partner change', async () => {
    const project = createProject({ organisationId: 'org-001', name: 'Studio', createdBy: 'user-1' });
    await projects.create(project);
    const changed = changeProjectProductPartner(project, 'anthropic');
    await projects.updateProductPartner(changed);

    expect((await projects.getById('org-001', project.id))?.preferredProductPartner).toBe('anthropic');
  });

  it('persists discovery conversation messages in append order', async () => {
    const project = createProject({ organisationId: 'org-001', name: 'Studio', createdBy: 'user-1' });
    await projects.create(project);
    const conversation = createConversation({
      organisationId: 'org-001', projectId: project.id, createdBy: 'user-1',
    });
    await conversations.create(conversation);
    const first = createConversationMessage({
      organisationId: 'org-001', projectId: project.id, conversationId: conversation.id,
      role: 'user', content: 'I want to build a platform.', createdBy: 'user-1',
    });
    const second = createConversationMessage({
      organisationId: 'org-001', projectId: project.id, conversationId: conversation.id,
      role: 'assistant', provider: 'openai', content: 'Who are the primary users?', createdBy: 'agent-product',
    });
    await conversations.appendMessage(first);
    await conversations.appendMessage(second);

    const messages = await conversations.listMessages('org-001', project.id, conversation.id);
    expect(messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(messages[1]?.provider).toBe('openai');
    expect(await conversations.getByProject('org-002', project.id)).toBeNull();
  });
});
