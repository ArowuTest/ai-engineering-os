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

test('web identity and API preserve global Platform Admin without tenant membership', async () => {
  const api = await read('lib/api.ts');
  const actions = await read('app/actions.ts');
  assert.match(api, /platformRole\?:\s*'admin'/);
  assert.match(api, /platformApiFetch/);
  assert.match(api, /getCapabilityEstateSnapshot/);
  assert.match(actions, /identity\.platformRole\s*===\s*'admin'/);
  assert.match(actions, /redirect\('\/admin\/capabilities'\)/);
});
test('Capability Estate admin web contract exposes snapshot and governed mutations', async () => {
  const api = await read('lib/api.ts');
  assert.match(api, /interface CapabilityEstateSnapshot/);
  assert.match(api, /refreshCapabilityEstateFromEcc/);
  assert.match(api, /changeCapabilityGovernanceState/);
  assert.match(api, /createCapabilityRelease/);
  assert.match(api, /revokeCapabilityRelease/);
  assert.match(api, /createCapabilityEligibility/);
  assert.match(api, /revokeCapabilityEligibility/);
});
test('Platform Admin tenant policy mutations carry an explicit organisation target without tenant-cookie authority', async () => {
  const api = await read('lib/api.ts');
  const actions = await read('app/actions.ts');
  const page = await read('app/admin/capabilities/page.tsx');
  assert.match(api, /platformTenantApiFetch/);
  assert.match(api, /x-organisation-id/);
  assert.match(api, /createCapabilityEligibility[\s\S]*?organisationId/);
  assert.match(api, /revokeCapabilityEligibility[\s\S]*?organisationId/);
  assert.match(api, /grantCapabilityPopulationMembership/);
  assert.match(api, /revokeCapabilityPopulationMembership/);
  assert.match(actions, /createCapabilityEligibilityAction[\s\S]*?organisationId/);
  assert.match(actions, /grantCapabilityPopulationMembershipAction[\s\S]*?organisationId/);
  assert.match(page, /name="organisationId"/);
  assert.match(page, /createCapabilityEligibilityAction/);
  assert.match(page, /grantCapabilityPopulationMembershipAction/);
});

test('Capability Estate admin server actions revalidate the governed page', async () => {
  const actions = await read('app/actions.ts');
  assert.match(actions, /refreshCapabilityEstateAction/);
  assert.match(actions, /changeCapabilityGovernanceStateAction/);
  assert.match(actions, /createCapabilityReleaseAction/);
  assert.match(actions, /revokeCapabilityReleaseAction/);
  assert.match(actions, /createCapabilityEligibilityAction/);
  assert.match(actions, /revokeCapabilityEligibilityAction/);
  assert.match(actions, /revalidatePath\('\/admin\/capabilities'\)/);
});

test('Capability Estate page renders governance, verification, release and eligibility state', async () => {
  const page = await read('app/admin/capabilities/page.tsx');
  assert.match(page, /Capability Estate/);
  assert.match(page, /executionVerification/);
  assert.match(page, /governanceState/);
  assert.match(page, /releases/);
  assert.match(page, /eligibilityPolicies/);
  assert.match(page, /Refresh ECC/);
  assert.doesNotMatch(page, /apiKey|credential|secretRef/i);
});