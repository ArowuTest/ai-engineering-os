import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
  KnowledgeCandidateRepository,
  KnowledgeRepository,
  ProjectRepository,
} from '@engineering-os/database';
import {
  ModelGateway,
  ProviderExecutionError,
  type ModelAdapter,
  type ModelProvider,
  type ModelRequest,
} from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import {
  closeDatabase,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

const headers = { 'x-organisation-id': 'org-001', 'x-user-id': 'user-001' };
const conversations = new ConversationRepository(pool);
const audit = new AuditRepository(pool);
const candidatesRepo = new KnowledgeCandidateRepository(pool);
const knowledgeRepo = new KnowledgeRepository(pool);

function envelope(answer: string, candidates: unknown[] = []): string {
  return JSON.stringify({ answer, candidates });
}

function adapter(
  provider: ModelProvider,
  priority: number,
  execute: ModelAdapter['execute'],
): ModelAdapter {
  return {
    route: {
      id: `${provider}-test-api`, provider, model: `${provider}-test-model`,
      executionMode: 'api', costType: 'metered_api', available: true, priority,
      capabilities: {
        chat: true,
        tools: false,
        vision: false,
        files: false,
        mcp: false,
        localWorkspace: false,
        headless: true,
        structuredOutput: true,
      },
    },
    execute,
  };
}

function testApp(gateway: ModelGateway) {
  return buildApp({
    projects: new ProjectRepository(pool),
    knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool),
    unitOfWork: new DatabaseUnitOfWork(pool),
    modelGateway: gateway,
  });
}

async function createProject(app: ReturnType<typeof testApp>, partner = 'auto') {
  const response = await app.inject({
    method: 'POST', url: '/projects', headers,
    payload: { name: 'Enterprise Streaming', preferredProductPartner: partner },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function extractionRunStatus(runId: string): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM knowledge_extraction_runs WHERE id = $1',
    [runId],
  );
  return result.rows[0]?.status ?? null;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('live Product Partner turn', () => {
  it('persists user and assistant messages after successful provider execution', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('Who owns the livestream and VOD rights?'),
      usage: { inputTokens: 22, outputTokens: 9 },
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'We need PPV and telco bundle access.' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      userMessage: { role: 'user', content: 'We need PPV and telco bundle access.' },
      assistantMessage: { role: 'assistant', provider: 'anthropic', content: 'Who owns the livestream and VOD rights?' },
      execution: { provider: 'anthropic', model: 'anthropic-test-model', routeId: 'anthropic-test-api', inputTokens: 22, outputTokens: 9 },
      extraction: { status: 'succeeded', candidateCount: 0 },
    });

    const conversation = await conversations.getByProject('org-001', project.id);
    expect(conversation).not.toBeNull();
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored.map(({ role, content, provider }) => ({ role, content, provider }))).toEqual([
      { role: 'user', content: 'We need PPV and telco bundle access.', provider: undefined },
      { role: 'assistant', content: 'Who owns the livestream and VOD rights?', provider: 'anthropic' },
    ]);
    for (const message of stored) {
      expect(message.content).not.toContain('"answer"');
      expect(message.content).not.toContain('"candidates"');
    }

    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'project.created',
      'product_partner.user_message.created',
      'product_partner.assistant_message.created',
      'knowledge_extraction_run.received',
      'knowledge_extraction_run.succeeded',
    ]);
    await app.close();
  });

  it('switches provider without losing prior conversation context', async () => {
    const gateway = new ModelGateway();
    const googleRequests: ModelRequest[] = [];
    gateway.register(adapter('openai', 10, async () => ({ content: envelope('First response from GPT.') })));
    gateway.register(adapter('google', 20, async (request) => {
      googleRequests.push(request);
      return { content: envelope('Second response from Gemini.') };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');

    await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'First discovery question.' },
    });
    const switched = await app.inject({
      method: 'PATCH', url: `/projects/${project.id}/product-partner`, headers,
      payload: { preferredProductPartner: 'google' },
    });
    expect(switched.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Continue with the same product.' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().assistantMessage.provider).toBe('google');

    const modelMessages = googleRequests[0]?.messages ?? [];
    expect(modelMessages.map(({ role, content }) => ({ role, content }))).toEqual(expect.arrayContaining([
      { role: 'user', content: 'First discovery question.' },
      { role: 'assistant', content: 'First response from GPT.' },
      { role: 'user', content: 'Continue with the same product.' },
    ]));
    expect(googleRequests[0]?.routing.preferredProvider).toBe('google');
    await app.close();
  });

  it('lets Auto choose an eligible configured route', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('google', 30, async () => ({ content: envelope('Auto-selected Gemini.') })));
    const app = testApp(gateway);
    const project = await createProject(app);
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Start discovery.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().assistantMessage.provider).toBe('google');
    await app.close();
  });

  it('returns 503 and persists no live-turn message when no route is configured', async () => {
    const app = testApp(new ModelGateway());
    const project = await createProject(app);
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'This should not become an orphan turn.' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'No live Product Partner is configured' });

    const conversation = await conversations.getByProject('org-001', project.id);
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored).toEqual([]);
    await app.close();
  });

  it('returns 502 and persists no live-turn message when provider execution fails', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 10, async () => {
      throw new ProviderExecutionError('openai', new Error('upstream secret detail'));
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Do not persist this failed turn.' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('upstream secret detail');
    expect(response.json()).toEqual({ error: 'Live Product Partner execution failed' });
    const conversation = await conversations.getByProject('org-001', project.id);
    expect(await conversations.listMessages('org-001', project.id, conversation!.id)).toEqual([]);
    await app.close();
  });

  it('treats blank model content as provider failure without persistence', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 10, async () => ({ content: '   ' })));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Require a real response.' },
    });
    expect(response.statusCode).toBe(502);
    const conversation = await conversations.getByProject('org-001', project.id);
    expect(await conversations.listMessages('org-001', project.id, conversation!.id)).toEqual([]);
    await app.close();
  });

  it('keeps live turns inside the caller organisation boundary', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 10, async () => ({ content: envelope('Should not run.') })));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/product-partner-turn`,
      headers: { ...headers, 'x-organisation-id': 'org-002' },
      payload: { content: 'Foreign organisation turn.' },
    });
    expect(response.statusCode).toBe(404);
    const conversation = await conversations.getByProject('org-001', project.id);
    expect(await conversations.listMessages('org-001', project.id, conversation!.id)).toEqual([]);
    await app.close();
  });

  it('rolls back both messages when assistant audit persistence fails', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({ content: envelope('Valid response.') })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    await pool.query(`
      CREATE FUNCTION reject_assistant_live_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'product_partner.assistant_message.created' THEN
          RAISE EXCEPTION 'forced assistant audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_assistant_live_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_assistant_live_audit();
    `);

    try {
      const response = await app.inject({
        method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
        payload: { content: 'This transaction must roll back.' },
      });
      expect(response.statusCode).toBe(500);
      const conversation = await conversations.getByProject('org-001', project.id);
      expect(await conversations.listMessages('org-001', project.id, conversation!.id)).toEqual([]);
      expect((await audit.listByProject('org-001', project.id)).map((event) => event.eventType)).toEqual(['project.created']);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_assistant_live_audit_trigger ON audit_events;
        DROP FUNCTION IF EXISTS reject_assistant_live_audit();
      `);
      await app.close();
    }

    const leakedTrigger = await pool.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'reject_assistant_live_audit_trigger'",
    );
    expect(leakedTrigger.rowCount).toBe(0);
  });

  it('persists pending candidates and marks run succeeded on the normal path', async () => {
    let modelCalls = 0;
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => {
      modelCalls += 1;
      return {
        content: envelope('Which regulations govern data residency?', [
          {
            category: 'regulatory_requirements',
            title: 'GDPR applicability',
            content: 'Product must comply with GDPR for EU customers.',
            basis: 'user_stated',
          },
          {
            category: 'stakeholders',
            title: 'Legal team owns compliance',
            content: 'The legal team validates data-residency approach.',
            basis: 'assistant_inferred',
          },
        ]),
        usage: { inputTokens: 40, outputTokens: 25 },
      };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'How do we handle customer data residency?' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(modelCalls).toBe(1);
    expect(body.assistantMessage.content).toBe('Which regulations govern data residency?');
    expect(body.assistantMessage.content).not.toContain('"answer"');
    expect(body.extraction.status).toBe('succeeded');
    expect(body.extraction.candidateCount).toBe(2);
    expect(typeof body.extraction.runId).toBe('string');

    const conversation = await conversations.getByProject('org-001', project.id);
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored).toHaveLength(2);
    expect(stored[1]!.content).toBe('Which regulations govern data residency?');

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.map((candidate) => candidate.category).sort()).toEqual(['regulatory_requirements', 'stakeholders']);
    expect(pending.every((candidate) => candidate.extractionRunId === body.extraction.runId)).toBe(true);

    const canonical = await knowledgeRepo.listByProject('org-001', project.id);
    expect(canonical).toEqual([]);

    expect(await extractionRunStatus(body.extraction.runId)).toBe('succeeded');

    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'project.created',
      'product_partner.user_message.created',
      'product_partner.assistant_message.created',
      'knowledge_extraction_run.received',
      'knowledge_candidate.created',
      'knowledge_candidate.created',
      'knowledge_extraction_run.succeeded',
    ]);
    await app.close();
  });

  it('persists the answer but marks the run failed when candidates are invalid', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('Please share your onboarding flow.', [
        {
          category: 'not_a_real_category',
          title: 'Broken',
          content: 'Should not persist.',
          basis: 'user_stated',
        },
      ]),
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Discovering onboarding steps.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.assistantMessage.content).toBe('Please share your onboarding flow.');
    expect(body.extraction.status).toBe('failed');
    expect(body.extraction.candidateCount).toBe(0);

    const conversation = await conversations.getByProject('org-001', project.id);
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored).toHaveLength(2);

    const pending = await candidatesRepo.listByProject('org-001', project.id);
    expect(pending).toEqual([]);

    const canonical = await knowledgeRepo.listByProject('org-001', project.id);
    expect(canonical).toEqual([]);

    expect(await extractionRunStatus(body.extraction.runId)).toBe('failed');
    await app.close();
  });

  it('rolls back candidate rows when candidate insertion faults but keeps the conversation', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('What acceptance criteria matter most?', [
        {
          category: 'functional_requirements',
          title: 'Fault candidate',
          content: 'Content that will fail to insert.',
          basis: 'assistant_recommended',
        },
      ]),
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    await pool.query(`
      CREATE FUNCTION reject_candidate_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced candidate insertion failure';
      END;
      $$;
      CREATE TRIGGER reject_candidate_insert_trigger
      BEFORE INSERT ON knowledge_candidates
      FOR EACH ROW EXECUTE FUNCTION reject_candidate_insert();
    `);

    try {
      const response = await app.inject({
        method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
        payload: { content: 'Force candidate persistence failure.' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.extraction.status).toBe('failed');
      expect(body.extraction.candidateCount).toBe(0);

      const conversation = await conversations.getByProject('org-001', project.id);
      expect(
        (await conversations.listMessages('org-001', project.id, conversation!.id)).length,
      ).toBe(2);
      expect(await candidatesRepo.listByProject('org-001', project.id)).toEqual([]);
      expect(await extractionRunStatus(body.extraction.runId)).toBe('failed');
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_candidate_insert_trigger ON knowledge_candidates;
        DROP FUNCTION IF EXISTS reject_candidate_insert();
      `);
      await app.close();
    }
  });

  it('collapses duplicate candidates in one envelope into a single pending row', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('Which regulations apply?', [
        {
          category: 'regulatory_requirements',
          title: 'GDPR applicability',
          content: 'Product must comply with GDPR for EU customers.',
          basis: 'user_stated',
        },
        {
          category: 'regulatory_requirements',
          title: 'GDPR APPLICABILITY',
          content: '  Product must comply with GDPR for EU customers.  ',
          basis: 'assistant_inferred',
        },
      ]),
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Regulatory question.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.extraction.status).toBe('succeeded');
    expect(body.extraction.candidateCount).toBe(1);

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.category).toBe('regulatory_requirements');
    await app.close();
  });

  it('suppresses candidates that duplicate an existing pending fingerprint', async () => {
    const gateway = new ModelGateway();
    let call = 0;
    gateway.register(adapter('anthropic', 10, async () => {
      call += 1;
      if (call === 1) {
        return {
          content: envelope('First turn.', [
            {
              category: 'regulatory_requirements',
              title: 'GDPR applicability',
              content: 'Product must comply with GDPR for EU customers.',
              basis: 'user_stated',
            },
          ]),
        };
      }
      return {
        content: envelope('Second turn.', [
          {
            category: 'regulatory_requirements',
            title: 'gdpr applicability',
            content: 'Product must comply with GDPR for EU customers.',
            basis: 'assistant_inferred',
          },
          {
            category: 'stakeholders',
            title: 'Legal team',
            content: 'Legal validates residency.',
            basis: 'assistant_inferred',
          },
        ]),
      };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    const first = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'First discovery.' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().extraction.candidateCount).toBe(1);

    const second = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Second discovery.' },
    });
    expect(second.statusCode).toBe(201);
    const body = second.json();
    expect(body.extraction.status).toBe('succeeded');
    expect(body.extraction.candidateCount).toBe(1);

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.map((c) => c.category).sort()).toEqual(['regulatory_requirements', 'stakeholders']);
    await app.close();
  });

  it('suppresses candidates that duplicate current canonical Product Knowledge', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('Restating known compliance rule.', [
        {
          category: 'regulatory_requirements',
          title: 'GDPR applicability',
          content: 'Product must comply with GDPR for EU customers.',
          basis: 'user_stated',
        },
        {
          category: 'risks',
          title: 'Rights risk',
          content: 'Rights must be confirmed.',
          basis: 'assistant_inferred',
        },
      ]),
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    const createKnowledge = await app.inject({
      method: 'POST', url: `/projects/${project.id}/knowledge`, headers,
      payload: {
        category: 'regulatory_requirements',
        title: 'GDPR applicability',
        content: 'Product must comply with GDPR for EU customers.',
        source: 'user',
        status: 'confirmed',
      },
    });
    expect(createKnowledge.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Repeat known info.' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.extraction.status).toBe('succeeded');
    expect(body.extraction.candidateCount).toBe(1);

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.category).toBe('risks');
    await app.close();
  });

  it('keeps same content under a different category eligible as a distinct candidate', async () => {
    const gateway = new ModelGateway();
    let call = 0;
    gateway.register(adapter('anthropic', 10, async () => {
      call += 1;
      if (call === 1) {
        return {
          content: envelope('First turn.', [
            {
              category: 'business_rules',
              title: 'Pass scope',
              content: 'A pass is valid for one event.',
              basis: 'user_stated',
            },
          ]),
        };
      }
      return {
        content: envelope('Second turn.', [
          {
            category: 'risks',
            title: 'Pass scope',
            content: 'A pass is valid for one event.',
            basis: 'assistant_inferred',
          },
        ]),
      };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'First.' },
    });
    const second = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Second.' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().extraction.candidateCount).toBe(1);

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.map((c) => c.category).sort()).toEqual(['business_rules', 'risks']);
    await app.close();
  });

  it('re-proposes a candidate that was previously rejected', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: envelope('Repeated proposal.', [
        {
          category: 'business_rules',
          title: 'Pass scope',
          content: 'A pass is valid for one event.',
          basis: 'user_stated',
        },
      ]),
    })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');

    const first = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'First.' },
    });
    expect(first.statusCode).toBe(201);
    const pendingInitial = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pendingInitial).toHaveLength(1);

    await pool.query(
      `UPDATE knowledge_candidates
         SET status = 'rejected', reviewer_id = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      ['reviewer-001', 'not relevant', pendingInitial[0]!.id],
    );

    const second = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Second.' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().extraction.status).toBe('succeeded');
    expect(second.json().extraction.candidateCount).toBe(1);

    const pending = await candidatesRepo.listByProject('org-001', project.id, 'pending');
    expect(pending).toHaveLength(1);
    const rejected = await candidatesRepo.listByProject('org-001', project.id, 'rejected');
    expect(rejected).toHaveLength(1);
    await app.close();
  });

  it('recovers with a single plain-chat call and marks the run failed when the structured call is unusable', async () => {
    let calls = 0;
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async (request) => {
      calls += 1;
      requests.push(request);
      if (calls === 1) return { content: 'not-json-broken-envelope' };
      return { content: 'Recovered plain answer for the user.' };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Ask a question that returns a broken envelope.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(calls).toBe(2);
    expect(requests[0]?.requiredCapabilities).toContain('structuredOutput');
    expect(requests[0]?.responseContract).toBeDefined();
    expect(requests[1]?.requiredCapabilities).not.toContain('structuredOutput');
    expect(requests[1]?.responseContract).toBeUndefined();

    expect(body.assistantMessage.content).toBe('Recovered plain answer for the user.');
    expect(body.extraction.status).toBe('failed');
    expect(body.extraction.candidateCount).toBe(0);

    const conversation = await conversations.getByProject('org-001', project.id);
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored).toHaveLength(2);
    expect(stored[0]!.role).toBe('user');
    expect(stored[0]!.content).toBe('Ask a question that returns a broken envelope.');
    expect(stored[1]!.role).toBe('assistant');
    expect(stored[1]!.content).toBe('Recovered plain answer for the user.');

    expect(await candidatesRepo.listByProject('org-001', project.id)).toEqual([]);
    expect(await extractionRunStatus(body.extraction.runId)).toBe('failed');
    await app.close();
  });
});
