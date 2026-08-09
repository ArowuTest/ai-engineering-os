import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../apps/web');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(webRoot, relativePath), 'utf8'));
}

test('web workspace exposes standard Next.js lifecycle scripts', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.private, true);
  for (const script of ['dev', 'build', 'start']) {
    assert.equal(typeof pkg.scripts?.[script], 'string');
  }
});

test('Product Studio routes and central API client exist', async () => {
  for (const relativePath of [
    'app/page.tsx',
    'app/projects/new/page.tsx',
    'app/projects/[id]/page.tsx',
    'lib/api.ts',
  ]) {
    await access(path.join(webRoot, relativePath));
  }
});

test('Product Studio primary composer uses the live Product Partner route', async () => {
  const api = await readFile(path.join(webRoot, 'lib/api.ts'), 'utf8');
  const actions = await readFile(path.join(webRoot, 'app/actions.ts'), 'utf8');
  const page = await readFile(path.join(webRoot, 'app/projects/[id]/page.tsx'), 'utf8');

  assert.match(api, /\/model-routes/);
  assert.match(api, /\/product-partner-turn/);
  assert.match(actions, /sendProductPartnerTurnAction/);
  assert.match(page, /action=\{sendProductPartnerTurnAction\}/);
  assert.match(page, /action=\{appendMessageAction\}/);
  assert.doesNotMatch(page, /Live provider execution is intentionally not enabled/);
});
