import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeApp, prepareRuntimeDatabase } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  pool,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

// Critical A: exercises the REAL production dependency composition (`createRuntimeApp`)
// rather than the test harness's custom `buildApp({ knowledgeCandidates: ... })`. A
// regression where `knowledgeCandidates` is missing from production wiring must fail
// here — the studio handler must still surface `latestFailedExtractionRun` when a
// failed extraction run exists for the project.
describe('createRuntimeApp production composition surfaces durable retry state', () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it('returns latestFailedExtractionRun from /projects/:id/studio via createRuntimeApp', async () => {
    const environment = {
      DATABASE_URL: databaseUrl,
      BOOTSTRAP_ORGANISATION_ID: 'org-001',
      BOOTSTRAP_ORGANISATION_NAME: 'Organisation One',
      BOOTSTRAP_OWNER_USER_ID: 'runtime.owner',
      BOOTSTRAP_OWNER_PASSWORD: 'Owner-password-2026!',
      ALLOW_DEV_IDENTITY_HEADERS: 'false',
    };
    const runtime = createRuntimeApp(environment);
    try {
      await prepareRuntimeDatabase(runtime.pool, environment);

      const login = await runtime.app.inject({
        method: 'POST', url: '/auth/login',
        payload: { userId: 'runtime.owner', password: 'Owner-password-2026!' },
      });
      expect(login.statusCode).toBe(200);
      const token = (login.json() as { token: string }).token;

      const created = await runtime.app.inject({
        method: 'POST', url: '/projects',
        headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
        payload: { name: 'Runtime Product', preferredProductPartner: 'anthropic' },
      });
      expect(created.statusCode).toBe(201);
      const projectId = (created.json() as { id: string }).id;

      const convRes = await pool.query<{ id: string }>(
        `SELECT id FROM conversations WHERE organisation_id = 'org-001' AND project_id = $1`,
        [projectId],
      );
      const conversationId = convRes.rows[0]!.id;

      const userMessageId = randomUUID();
      const assistantMessageId = randomUUID();
      const runId = randomUUID();
      const now = new Date();

      await pool.query(
        `INSERT INTO conversation_messages (id, organisation_id, project_id, conversation_id, role, content, created_by, created_at)
         VALUES ($1, 'org-001', $2, $3, 'user', 'hello', 'runtime.owner', $4)`,
        [userMessageId, projectId, conversationId, now],
      );
      await pool.query(
        `INSERT INTO conversation_messages (id, organisation_id, project_id, conversation_id, role, content, provider, created_by, created_at)
         VALUES ($1, 'org-001', $2, $3, 'assistant', 'reply', 'anthropic', 'agent:anthropic', $4)`,
        [assistantMessageId, projectId, conversationId, new Date(now.getTime() + 1)],
      );
      await pool.query(
        `INSERT INTO knowledge_extraction_runs (
           id, organisation_id, project_id, conversation_id,
           source_user_message_id, source_assistant_message_id,
           provider, model, route_id, response_contract_version,
           status, failure_code, failure_message, created_at, completed_at
         ) VALUES ($1, 'org-001', $2, $3, $4, $5,
                   'anthropic', 'claude-3', 'anthropic-test-api', 'chat_and_structured_v1',
                   'failed', 'candidate_validation_failed', 'invalid category', $6, $7)`,
        [
          runId, projectId, conversationId,
          userMessageId, assistantMessageId,
          new Date(now.getTime() + 2), new Date(now.getTime() + 3),
        ],
      );

      const studio = await runtime.app.inject({
        method: 'GET', url: `/projects/${projectId}/studio`,
        headers: { authorization: `Bearer ${token}`, 'x-organisation-id': 'org-001' },
      });
      expect(studio.statusCode).toBe(200);
      const body = studio.json() as {
        latestFailedExtractionRun: null | { id: string; status: string; failureCode: string };
      };
      expect(body.latestFailedExtractionRun).not.toBeNull();
      expect(body.latestFailedExtractionRun!.id).toBe(runId);
      expect(body.latestFailedExtractionRun!.status).toBe('failed');
      expect(body.latestFailedExtractionRun!.failureCode).toBe('candidate_validation_failed');
    } finally {
      await runtime.close();
    }
  });
});
