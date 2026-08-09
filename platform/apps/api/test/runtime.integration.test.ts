import { describe, expect, it } from 'vitest';
import { createRuntimeApp, resolveServerConfig } from '../src/server.js';

const databaseUrl =
  'postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test';

describe('API runtime composition', () => {
  it('resolves safe host and port defaults', () => {
    expect(resolveServerConfig({})).toEqual({ host: '127.0.0.1', port: 3100 });
    expect(resolveServerConfig({ PLATFORM_HOST: '0.0.0.0', PLATFORM_PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('rejects an invalid port before starting the server', () => {
    expect(() => resolveServerConfig({ PLATFORM_PORT: 'not-a-port' })).toThrow('PLATFORM_PORT');
    expect(() => resolveServerConfig({ PLATFORM_PORT: '70000' })).toThrow('PLATFORM_PORT');
  });

  it('composes the real repositories and exposes health without listening on a socket', async () => {
    const runtime = createRuntimeApp({ DATABASE_URL: databaseUrl });
    try {
      const response = await runtime.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', modelRoutes: 0 });
    } finally {
      await runtime.close();
    }
  });
});