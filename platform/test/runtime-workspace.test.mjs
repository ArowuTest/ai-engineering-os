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

test('environment example defaults to real auth and explicit first-owner bootstrap', async () => {
  const env = await readFile(path.join(platformRoot, '.env.example'), 'utf8');
  assert.match(env, /ALLOW_DEV_IDENTITY_HEADERS=false/);
  assert.match(env, /BOOTSTRAP_ORGANISATION_ID=org-001/);
  assert.match(env, /BOOTSTRAP_OWNER_USER_ID=/);
  assert.match(env, /BOOTSTRAP_OWNER_PASSWORD=/);
  assert.match(env, /DEV_ORGANISATION_ID=org-001/);
  assert.match(env, /API_BASE_URL=http:\/\/127\.0\.0\.1:3100/);
  assert.doesNotMatch(env, /DEV_USER_ID=/);
});
