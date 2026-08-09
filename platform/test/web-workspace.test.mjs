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
