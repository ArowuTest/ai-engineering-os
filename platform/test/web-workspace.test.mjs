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

test('authentication and collaboration routes are part of the web application', async () => {
  for (const relativePath of [
    'app/login/page.tsx',
    'app/redeem/page.tsx',
    'app/admin/access/page.tsx',
  ]) {
    await access(path.join(webRoot, relativePath));
  }

  const api = await readFile(path.join(webRoot, 'lib/api.ts'), 'utf8');
  const actions = await readFile(path.join(webRoot, 'app/actions.ts'), 'utf8');
  const login = await readFile(path.join(webRoot, 'app/login/page.tsx'), 'utf8');
  const redeem = await readFile(path.join(webRoot, 'app/redeem/page.tsx'), 'utf8');

  assert.match(api, /engineering_os_session/);
  assert.match(api, /authorization/i);
  assert.doesNotMatch(api, /headers\.set\('x-user-id'/);
  assert.match(actions, /loginAction/);
  assert.match(actions, /redeemInvitationAction/);
  assert.match(actions, /httpOnly:\s*true/);
  assert.match(login, /name="userId"/);
  assert.match(login, /name="password"/);
  assert.doesNotMatch(login, /name="email"/);
  assert.match(redeem, /name="key"/);
  assert.match(redeem, /name="userId"/);
  assert.match(redeem, /name="password"/);
  assert.doesNotMatch(redeem, /name="email"/);
});