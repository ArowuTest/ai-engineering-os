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
        structuredOutput: false,
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
      assistantMessage: {
        role: 'assistant',
        content: 'Who owns the livestream and VOD rights?',
        provider: 'anthropic',
      },
      execution: {
        provider: 'anthropic', model: 'anthropic-test-model', routeId: 'anthropic-test-api',
        executionMode: 'api', costType: 'metered_api', inputTokens: 22, outputTokens: 9,
      },
    });

    const studio = await app.inject({ method: 'GET', url: `/projects/${project.id}/studio`, headers });
    expect(studio.json().messages).toHaveLength(2);
    expect(studio.json().messages.map((message: { role: string; content: string }) => [message.role, message.content])).toEqual([
      ['user', 'We need PPV and telco bundle access.'],
      ['assistant', 'Who owns the livestream and VOD rights?'],
    ]);
    await app.close();
  });

  it('rebuilds the next request from durable history and canonical Product Knowledge', async () => {
    const captured: ModelRequest[] = [];
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 10, async (request) => {
      captured.push(request);
      return { content: 'First answer.' };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');

    await app.inject({
      method: 'POST', url: `/projects/${project.id}/knowledge`, headers,
      payload: {
        category: 'business_rules', title: 'Pass scope', content: 'A pass grants one event only.',
        source: 'product_owner', status: 'confirmed',
      },
    });
    await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Challenge my pass model.' },
    });

    const secondGateway = new ModelGateway();
    secondGateway.register(adapter('anthropic', 10, async (request) => {
      captured.push(request);
      return { content: 'Second answer.' };
    }));
    const secondApp = testApp(secondGateway);
    await secondApp.inject({
      method: 'PATCH', url: `/projects/${project.id}/product-partner`, headers,
      payload: { preferredProductPartner: 'anthropic' },
    });
    const second = await secondApp.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Continue with Claude.' },
    });
    expect(second.statusCode).toBe(201);

    const request = captured[1];
    expect(request?.routing.preferredProvider).toBe('anthropic');
    expect(request?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('A pass grants one event only.') }),
      { role: 'user', content: 'Challenge my pass model.' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Continue with Claude.' },
    ]));
    await app.close();
    await secondApp.close();
  });

  it('uses Auto routing without pinning a provider', async () => {
    let captured: ModelRequest | undefined;
    const gateway = new ModelGateway();
    gateway.register(adapter('google', 1, async (request) => {
      captured = request;
      return { content: 'Gemini selected.' };
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'auto');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Help define the audience.' },
    });
    expect(response.statusCode).toBe(201);
    expect(captured?.routing.preferredProvider).toBeUndefined();
    expect(response.json().assistantMessage.provider).toBe('google');
    await app.close();
  });

  it('does not persist the user message when provider execution fails', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 1, async () => {
      throw new ProviderExecutionError('openai', new Error('upstream unavailable'));
    }));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'This should not persist yet.' },
    });
    expect(response.statusCode).toBe(502);

    const conversation = await conversations.getByProject('org-001', project.id);
    expect(conversation).not.toBeNull();
    const messages = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(messages).toEqual([]);
    await app.close();
  });

  it('rolls back both messages when the mandatory assistant audit event fails', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('openai', 1, async () => ({ content: 'A valid answer.' })));
    const app = testApp(gateway);
    const project = await createProject(app, 'openai');

    await pool.query(`
      CREATE OR REPLACE FUNCTION reject_assistant_live_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'product_partner.assistant_message.created' THEN
          RAISE EXCEPTION 'forced assistant audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER test_reject_assistant_live_audit
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_assistant_live_audit()
    `);

    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Persist atomically.' },
    });
    expect(response.statusCode).toBe(500);

    const conversation = await conversations.getByProject('org-001', project.id);
    const messages = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(messages).toEqual([]);
    expect((await audit.listByProject('org-001', project.id)).map((event) => event.eventType)).not.toContain(
      'product_partner.user_message.created',
    );
    await app.close();
  });

  it('keeps same-provider model switches continuous because history is platform-owned', async () => {
    const requests: ModelRequest[] = [];
    const firstGateway = new ModelGateway();
    firstGateway.register(adapter('openai', 1, async (request) => {
      requests.push(request);
      return { content: 'First model response.' };
    }));
    const firstApp = testApp(firstGateway);
    const project = await createProject(firstApp, 'openai');
    await firstApp.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Start with model A.' },
    });
    await firstApp.close();

    const secondGateway = new ModelGateway();
    const switched = adapter('openai', 1, async (request) => {
      requests.push(request);
      return { content: 'Second model response.' };
    });
    switched.route.model = 'openai-test-model-b';
    secondGateway.register(switched);
    const secondApp = testApp(secondGateway);
    const response = await secondApp.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Continue on model B.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().execution.model).toBe('openai-test-model-b');
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      { role: 'user', content: 'Start with model A.' },
      { role: 'assistant', content: 'First model response.' },
      { role: 'user', content: 'Continue on model B.' },
    ]));
    await secondApp.close();
  });

  it('returns a controlled 503 when no eligible provider route is configured', async () => {
    const app = testApp(new ModelGateway());
    const project = await createProject(app, 'auto');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Hello?' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('No eligible model execution route');
    await app.close();
  });

  it('refuses blank adapter output instead of persisting an empty assistant message', async () => {
    const gateway = new ModelGateway();
    gateway.register(adapter('anthropic', 1, async () => ({ content: '   ' })));
    const app = testApp(gateway);
    const project = await createProject(app, 'anthropic');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers,
      payload: { content: 'Give me an answer.' },
    });
    expect(response.statusCode).toBe(502);
    const conversation = await conversations.getByProject('org-001', project.id);
    const messages = await conversations.listMessages('org-001', project.id, conversation!.id);
    expect(messages).toEqual([]);
    await app.close();
  });
});
