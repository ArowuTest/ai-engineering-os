import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditRepository,
  ConversationRepository,
  DatabaseUnitOfWork,
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

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('live Product Partner turn', () => {
  it('persists user and assistant messages after successful provider execution', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 10, async () => ({
      content: 'Who owns the livestream and VOD rights?',
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
    });

    const conversation = await conversations.getByProject('org-001', project.id);
    expect(conversation).not.toBeNull();
    const stored = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(stored.map(({ role, content, provider }) => ({ role, content, provider }))).toEqual([
      { role: 'user', content: 'We need PPV and telco bundle access.', provider: undefined },
      { role: 'assistant', content: 'Who owns the livestream and VOD rights?', provider: 'anthropic' },
    ]);

    const events = await audit.listByProject('org-001', project.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'project.created',
      'product_partner.user_message.created',
      'product_partner.assistant_message.created',
    ]);
    await app.close();
  });

  it('switches provider without losing prior conversation context', async () => {
    const gateway = new ModelGateway();
    const googleRequests: ModelRequest[] = [];
    gateway.register(adapter('openai', 10, async () => ({ content: 'First response from GPT.' })));
    gateway.register(adapter('google', 20, async (request) => {
      googleRequests.push(request);
      return { content: 'Second response from Gemini.' };
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
    gateway.register(adapter('google', 30, async () => ({ content: 'Auto-selected Gemini.' })));
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
    gateway.register(adapter('openai', 10, async () => ({ content: 'Should not run.' })));
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
    gateway.register(adapter('anthropic', 10, async () => ({ content: 'Valid response.' })));
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
});
