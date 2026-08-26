import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const webRoot = new URL('../apps/web/', import.meta.url);
const read = (path) => readFile(new URL(path, webRoot), 'utf8');

test('root shell hides signed-in navigation when no authenticated session exists', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /cookies\(\)/);
  assert.match(layout, /SESSION_COOKIE/);
  assert.match(layout, /const authenticated = Boolean\(/);
  assert.match(layout, /authenticated \? \(/);
  assert.match(layout, /Sign out/);
});

test('new project keeps provider preference behind progressive disclosure', async () => {
  const page = await read('app/projects/new/page.tsx');
  assert.match(page, /<details className="project-advanced">/);
  assert.match(page, /<summary>Advanced setup<\/summary>/);
  assert.match(page, /name="preferredProductPartner"/);
  assert.match(page, /defaultValue="auto"/);
  assert.match(page, /Auto select/);
});

test('navigation contrast and advanced-control touch target meet the browser findings', async () => {
  const css = await read('app/globals.css');
  assert.doesNotMatch(css, /\.muted-link\s*\{\s*color:\s*#a2abb5/i);
  assert.match(css, /\.composer-advanced\s*>\s*summary\s*\{[^}]*min-height:\s*24px/s);
  assert.match(css, /\.project-advanced\s*>\s*summary\s*\{[^}]*min-height:\s*24px/s);
});
