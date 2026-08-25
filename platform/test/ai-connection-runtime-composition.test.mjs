import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

test('server composes managed credentials, provider adapters and dynamic routes', async () => {
  const server = await read('apps/api/src/server.ts');
  assert.match(server, /AIConnectionSecretRepository/);
  assert.match(server, /createConfiguredAIConnectionSecretProtector/);
  assert.match(server, /createConfiguredAIConnectionProviderAdapters/);
  assert.match(server, /createRepositoryAIConnectionCredentialResolver/);
  assert.match(server, /createConnectionModelRouteCatalogue/);
  assert.match(server, /connectionModelRoutes/);
  assert.match(server, /providerAdapters/);
  assert.match(server, /credentialProtector/);
  assert.match(server, /credentialResolver/);
});
test('Product Partner uses an execution-scoped dynamic adapter resolver', async () => {
  const service = await read('apps/api/src/product-partner-turn-service.ts');
  const app = await read('apps/api/src/app.ts');
  assert.match(service, /dynamicAdapterResolver\?:/);
  const uses = service.match(/dynamicAdapterResolver/g) ?? [];
  assert.ok(uses.length >= 3, 'resolver must be declared and used on structured and recovery calls');
  assert.match(app, /resolveConnectionModelAdapter/);
  assert.match(app, /dynamicAdapterResolver/);
});

test('runtime exposes managed secret settings without embedding a default key', async () => {
  const server = await read('apps/api/src/server.ts');
  assert.match(server, /AIOS_CONNECTION_SECRET_MASTER_KEY\?: string/);
  assert.match(server, /AIOS_CONNECTION_SECRET_KEY_VERSION\?: string/);
  assert.doesNotMatch(server, /AIOS_CONNECTION_SECRET_MASTER_KEY\s*:\s*['"][A-Za-z0-9+/=]+['"]/);
});
