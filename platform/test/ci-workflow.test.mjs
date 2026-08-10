import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

async function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

test('routine CI runs for platform branches', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /platform-\*/);
});

test('routine CI does not use the inherited cross-platform package-manager matrix', async () => {
  const workflow = await readWorkflow();
  assert.doesNotMatch(workflow, /pm:\s*\[npm, pnpm, yarn, bun\]/);
  assert.doesNotMatch(workflow, /os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
});

test('routine CI does not upload bulk test artifacts', async () => {
  const workflow = await readWorkflow();
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /path:\s*\|\s*[\s\S]*tests\//);
});

test('routine CI builds the Product Studio web application', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /npm run build --workspace @engineering-os\/web/);
});


test('ECC compatibility validates the preserved upstream README, not the product README', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /node scripts\/ci\/validate-derivative-ecc-catalog\.js --text/);
  assert.doesNotMatch(workflow, /node scripts\/ci\/catalog\.js --text/);
});
