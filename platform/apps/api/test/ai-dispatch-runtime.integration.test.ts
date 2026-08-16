import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeApp } from '../src/server.js';
import {
  closeDatabase,
  databaseUrl,
  resetDatabase,
} from '../../../packages/database/test/database-test-harness.js';

beforeEach(async () => resetDatabase(), 30_000);
afterAll(async () => closeDatabase());

describe('runner dispatch runtime composition', () => {
  it('composes the real dispatch service instead of an unconfigured runner route', async () => {
    const runtime = createRuntimeApp({ DATABASE_URL: databaseUrl });
    try {
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/runner/v1/claim',
        headers: { authorization: 'Bearer invalid' },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    } finally {
      await runtime.close();
    }
  });
});
