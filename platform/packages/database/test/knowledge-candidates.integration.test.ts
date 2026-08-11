import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  createConversationMessage,
  createKnowledgeExtractionRun,
  createPendingKnowledgeCandidate,
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

const organisationId = 'org-001';
const otherOrganisationId = 'org-002';

async function seedTurn() {
  const projects = new ProjectRepository(pool);
  const conversations = new ConversationRepository(pool);
  const project = createProject({
    organisationId,
    name: 'Extraction Project',
    preferredProductPartner: 'openai',
    createdBy: 'user-001',
  });
  await projects.create(project);

  const conversation = createConversation({
    organisationId,
    projectId: project.id,
    createdBy: 'user-001',
  });
  await conversations.create(conversation);

  const userMessage = createConversationMessage({
    organisationId,
    projectId: project.id,
    conversationId: conversation.id,
    role: 'user',
    content: 'A pass is valid for one event.',
    createdBy: 'user-001',
  });
  const assistantMessage = createConversationMessage({
    organisationId,
    projectId: project.id,
    conversationId: conversation.id,
    role: 'assistant',
    content: 'That rule should be reviewed.',
    provider: 'openai',
    createdBy: 'product-partner:openai',
  });
  await conversations.appendMessage(userMessage);
  await conversations.appendMessage(assistantMessage);

  return { project, conversation, userMessage, assistantMessage };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('knowledge extraction persistence', () => {
  it('persists a received run and pending candidate inside the exact project scope', async () => {
    const seeded = await seedTurn();
    const repository = new KnowledgeCandidateRepository(pool);
    const run = createKnowledgeExtractionRun({
      organisationId,
      projectId: seeded.project.id,
      conversationId: seeded.conversation.id,
      sourceUserMessageId: seeded.userMessage.id,
      sourceAssistantMessageId: seeded.assistantMessage.id,
      provider: 'openai',
      model: 'gpt-5.6',
      routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });
    await repository.createRun(run);

    const candidate = createPendingKnowledgeCandidate({
      organisationId,
      projectId: seeded.project.id,
      extractionRunId: run.id,
      category: 'business_rules',
      title: 'Pass scope',
      content: 'A pass is valid for one event.',
      basis: 'user_stated',
    });
    await repository.insertCandidate(candidate);

    expect(await repository.getRunById(organisationId, seeded.project.id, run.id)).toMatchObject({
      id: run.id,
      status: 'received',
      routeId: 'openai-api',
    });
    expect(await repository.listByProject(organisationId, seeded.project.id, 'pending')).toMatchObject([
      { id: candidate.id, status: 'pending', fingerprint: candidate.fingerprint },
    ]);
    expect(await repository.listByProject(otherOrganisationId, seeded.project.id, 'pending')).toEqual([]);
  });

  it('prevents a run from linking source messages outside its project/conversation scope', async () => {
    const first = await seedTurn();
    const projects = new ProjectRepository(pool);
    const conversations = new ConversationRepository(pool);
    const secondProject = createProject({
      organisationId,
      name: 'Second Project',
      createdBy: 'user-001',
    });
    await projects.create(secondProject);
    const secondConversation = createConversation({
      organisationId,
      projectId: secondProject.id,
      createdBy: 'user-001',
    });
    await conversations.create(secondConversation);
    const foreignAssistant = createConversationMessage({
      organisationId,
      projectId: secondProject.id,
      conversationId: secondConversation.id,
      role: 'assistant',
      content: 'Foreign answer',
      provider: 'openai',
      createdBy: 'product-partner:openai',
    });
    await conversations.appendMessage(foreignAssistant);

    const repository = new KnowledgeCandidateRepository(pool);
    const invalidRun = createKnowledgeExtractionRun({
      organisationId,
      projectId: first.project.id,
      conversationId: first.conversation.id,
      sourceUserMessageId: first.userMessage.id,
      sourceAssistantMessageId: foreignAssistant.id,
      provider: 'openai',
      model: 'gpt-5.6',
      routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });

    await expect(repository.createRun(invalidRun)).rejects.toThrow();
  });

  it('allows only received to succeeded or failed run transitions', async () => {
    const seeded = await seedTurn();
    const repository = new KnowledgeCandidateRepository(pool);
    const run = createKnowledgeExtractionRun({
      organisationId,
      projectId: seeded.project.id,
      conversationId: seeded.conversation.id,
      sourceUserMessageId: seeded.userMessage.id,
      sourceAssistantMessageId: seeded.assistantMessage.id,
      provider: 'openai', model: 'gpt-5.6', routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });
    await repository.createRun(run);
    await repository.markRunSucceeded(organisationId, seeded.project.id, run.id, new Date());

    await expect(
      repository.markRunFailed(
        organisationId,
        seeded.project.id,
        run.id,
        'late_failure',
        'Must not overwrite a completed run',
        new Date(),
      ),
    ).rejects.toThrow('extraction run is not received');
  });

  it('keeps candidate source evidence immutable and review decision one-time', async () => {
    const seeded = await seedTurn();
    const repository = new KnowledgeCandidateRepository(pool);
    const run = createKnowledgeExtractionRun({
      organisationId,
      projectId: seeded.project.id,
      conversationId: seeded.conversation.id,
      sourceUserMessageId: seeded.userMessage.id,
      sourceAssistantMessageId: seeded.assistantMessage.id,
      provider: 'openai', model: 'gpt-5.6', routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });
    await repository.createRun(run);
    const candidate = createPendingKnowledgeCandidate({
      organisationId,
      projectId: seeded.project.id,
      extractionRunId: run.id,
      category: 'business_rules',
      title: 'Pass scope',
      content: 'A pass is valid for one event.',
      basis: 'user_stated',
    });
    await repository.insertCandidate(candidate);

    await expect(
      pool.query('UPDATE knowledge_candidates SET original_content = $1 WHERE id = $2', [
        'Mutated source evidence', candidate.id,
      ]),
    ).rejects.toThrow('candidate source evidence is immutable');

    const locked = await repository.getCandidateForUpdate(
      organisationId,
      seeded.project.id,
      candidate.id,
    );
    expect(locked?.status).toBe('pending');
    await repository.rejectCandidateDecision(
      organisationId,
      seeded.project.id,
      candidate.id,
      'reviewer-001',
      new Date(),
      'Not a confirmed user rule',
    );
    await expect(
      repository.rejectCandidateDecision(
        organisationId,
        seeded.project.id,
        candidate.id,
        'reviewer-002',
        new Date(),
        'Second decision must fail',
      ),
    ).rejects.toThrow('candidate is not pending');
  });

  it('suppresses duplicate pending fingerprints within project/category but not across projects', async () => {
    const seeded = await seedTurn();
    const repository = new KnowledgeCandidateRepository(pool);
    const run = createKnowledgeExtractionRun({
      organisationId,
      projectId: seeded.project.id,
      conversationId: seeded.conversation.id,
      sourceUserMessageId: seeded.userMessage.id,
      sourceAssistantMessageId: seeded.assistantMessage.id,
      provider: 'openai', model: 'gpt-5.6', routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });
    await repository.createRun(run);

    const first = createPendingKnowledgeCandidate({
      organisationId,
      projectId: seeded.project.id,
      extractionRunId: run.id,
      category: 'business_rules', title: 'Pass scope',
      content: 'A pass is valid for one event.', basis: 'user_stated',
    });
    const duplicate = createPendingKnowledgeCandidate({
      organisationId,
      projectId: seeded.project.id,
      extractionRunId: run.id,
      category: 'business_rules', title: 'PASS SCOPE',
      content: 'A pass is valid for   one event.', basis: 'user_stated',
    });
    await repository.insertCandidate(first);
    await expect(repository.insertCandidate(duplicate)).rejects.toThrow();
  });

  it('cascades extraction evidence when its project is deleted', async () => {
    const seeded = await seedTurn();
    const repository = new KnowledgeCandidateRepository(pool);
    const run = createKnowledgeExtractionRun({
      organisationId,
      projectId: seeded.project.id,
      conversationId: seeded.conversation.id,
      sourceUserMessageId: seeded.userMessage.id,
      sourceAssistantMessageId: seeded.assistantMessage.id,
      provider: 'openai', model: 'gpt-5.6', routeId: 'openai-api',
      responseContractVersion: 'product_partner_knowledge_v1',
    });
    await repository.createRun(run);
    const candidate = createPendingKnowledgeCandidate({
      organisationId,
      projectId: seeded.project.id,
      extractionRunId: run.id,
      category: 'risks', title: 'Rights risk', content: 'Rights must be confirmed.',
      basis: 'assistant_inferred',
    });
    await repository.insertCandidate(candidate);

    await pool.query('DELETE FROM projects WHERE organisation_id = $1 AND id = $2', [
      organisationId, seeded.project.id,
    ]);
    expect((await pool.query('SELECT 1 FROM knowledge_extraction_runs WHERE id = $1', [run.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM knowledge_candidates WHERE id = $1', [candidate.id])).rowCount).toBe(0);
  });
});
