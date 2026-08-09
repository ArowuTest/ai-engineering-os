import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(here, '..');

async function readJson(relativePath) {
  const content = await readFile(path.join(platformRoot, relativePath), 'utf8');
  return JSON.parse(content);
}

test('platform manifest defines isolated workspaces and verification scripts', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ['apps/*', 'packages/*']);
  for (const script of ['test', 'test:unit', 'test:integration', 'typecheck']) {
    assert.equal(typeof pkg.scripts?.[script], 'string', `missing ${script} script`);
  }
});
test('docker compose defines the isolated PostgreSQL development service', async () => {
  const compose = await readFile(path.join(platformRoot, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /postgres:/);
  assert.match(compose, /55432:5432/);
  assert.match(compose, /POSTGRES_DB:\s*engineering_os_test/);
});

test('environment example uses the Docker PostgreSQL database', async () => {
  const env = await readFile(path.join(platformRoot, '.env.example'), 'utf8');
  assert.match(env, /DATABASE_URL=postgresql:\/\/[^\r\n]+@localhost:55432\/engineering_os_test/);
});
test('TypeScript base config always includes at least one real TypeScript input', async () => {
  const tsconfig = await readJson('tsconfig.base.json');
  assert.equal(Array.isArray(tsconfig.files) && tsconfig.files.length === 0, false);
  assert.ok(
    tsconfig.include?.includes('vitest.config.ts'),
    'vitest.config.ts must keep the base configuration type-checkable before app packages exist',
  );
});
test('top-level verification serialises PostgreSQL integration suites', async () => {
  const pkg = await readJson('package.json');
  assert.match(pkg.scripts.test, /npm run test:unit.*npm run test:integration/);
  assert.match(pkg.scripts['test:integration'], /--no-file-parallelism/);
  assert.match(pkg.scripts['test:integration'], /--maxWorkers=1/);
});
