import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  createConversationMessage,
  createKnowledgeExtractionRun,
  createProject,
} from '@engineering-os/domain';
import {
  ConversationRepository,
  KnowledgeCandidateRepository,
  ProjectRepository,
} from '../src/index.js';
import {
  closeDatabase,
  pool,
  resetDatabase,
} from './database-test-harness.js';

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('knowledge extraction source message roles', () => {
  it('rejects swapped user/assistant source roles even inside the same conversation', async () => {
    const projects = new ProjectRepository(pool);
    const conversations = new ConversationRepository(pool);
    const repository = new KnowledgeCandidateRepository(pool);

    const project = createProject({
      organisationId: 'org-001',
      name: 'Source Role Project',
      createdBy: 'user-001',
    });
    await projects.create(project);
    const conversation = createConversation({
      organisationId: 'org-001',
      projectId: project.id,
      createdBy: 'user-001',
    });
    await conversations.create(conversation);

    const userMessage = createConversationMessage({
      organisationId: 'org-001',
      projectId: project.id,
      conversationId: conversation.id,
      role: 'user',
      content: 'The user statement.',
      createdBy: 'user-001',
    });
    const assistantMessage = createConversationMessage({
      organisationId: 'org-001',
      projectId: project.id,
      conversationId: conversation.id,
      role: 'assistant',
      content: 'The assistant answer.',
      provider: 'openai',
      createdBy: 'product-partner:openai',
    });
    await conversations.appendMessage(userMessage);
    await conversations.appendMessage(assistantMessage);

    const swapped = createKnowledgeExtractionRun({
      organisationId: 'org-001',
      projectId: project.id,
      conversationId: conversation.id,
      sourceUserMessageId: assistantMessage.id,
      sourceAssistantMessageId: userMessage.id,
      provider: 'openai',
      model: 'gpt-5.6',
      routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });

    await expect(repository.createRun(swapped)).rejects.toThrow(
      'extraction source message roles are invalid',
    );
  });
});
