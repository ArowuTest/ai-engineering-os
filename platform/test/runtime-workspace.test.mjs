import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(here, '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(platformRoot, relativePath), 'utf8'));
}

test('API workspace has executable development and start commands', async () => {
  const pkg = await readJson('apps/api/package.json');
  assert.match(pkg.scripts?.dev ?? '', /tsx/);
  assert.match(pkg.scripts?.start ?? '', /tsx/);
});

test('development environment documents bootstrap identity and web API URL', async () => {
  const env = await readFile(path.join(platformRoot, '.env.example'), 'utf8');
  assert.match(env, /DEV_BOOTSTRAP_ORGANISATION_ID=org-001/);
  assert.match(env, /DEV_ORGANISATION_ID=org-001/);
  assert.match(env, /API_BASE_URL=http:\/\/127\.0\.0\.1:3100/);
});
