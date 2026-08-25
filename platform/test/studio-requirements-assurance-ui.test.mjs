import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../apps/web');
async function read(relativePath) {
  return readFile(path.join(webRoot, relativePath), 'utf8');
}

test('web API exposes Requirements Assurance readiness and governed review execution', async () => {
  const api = await read('lib/api.ts');
  assert.match(api, /interface RequirementsAssuranceState/);
  assert.match(api, /type RequirementsAssuranceReadinessStatus\s*=\s*[\s\S]*?'ready'[\s\S]*?'not_ready'[\s\S]*?'insufficient_evidence'/);
  assert.match(api, /export function getRequirementsAssurance\(/);
  assert.match(api, /export function runRequirementsAssurance\(/);
  assert.match(api, /requirements-assurance/);
});
test('server action triggers Requirements Assurance independently from Product Partner selection', async () => {
  const actions = await read('app/actions.ts');
  assert.match(actions, /runRequirementsAssuranceAction/);
  assert.match(actions, /runRequirementsAssurance\(/);
  assert.match(actions, /normalizeStudioSelectionValue\(formData\.get\('reviewerRouteId'\)\)/);
  assert.doesNotMatch(actions, /reviewerRouteId[\s\S]{0,120}?modelRouteId/);
});

test('Product Studio shows readiness and unresolved reviewer challenges as non-canonical evidence', async () => {
  const page = await read('app/projects/[id]/page.tsx');
  assert.match(page, /getRequirementsAssurance\(id\)/);
  assert.match(page, /Requirements Readiness/);
  assert.match(page, /Run Requirements Review/);
  assert.match(page, /name="reviewerRouteId"/);
  assert.match(page, /finding\.proposedQuestion/);
  assert.match(page, /non-canonical/i);
  assert.match(page, /requirementsAssurance\.readiness\.status/);
  assert.doesNotMatch(page, /requirementsAssurance[\s\S]{0,500}?reviseKnowledge/);
});
test('Product Owner can explicitly close a reviewer finding with a recorded reason', async () => {
  const api = await read('lib/api.ts');
  const actions = await read('app/actions.ts');
  const page = await read('app/projects/[id]/page.tsx');
  assert.match(api, /closeRequirementsAssuranceFinding/);
  assert.match(api, /resolutionNote/);
  assert.match(actions, /closeRequirementsAssuranceFindingAction/);
  assert.match(actions, /closeRequirementsAssuranceFinding\(/);
  assert.match(page, /closeRequirementsAssuranceFindingAction/);
  assert.match(page, /name="resolutionNote"/);
  assert.match(page, /name="status"/);
  assert.match(page, /canReview/);
});
