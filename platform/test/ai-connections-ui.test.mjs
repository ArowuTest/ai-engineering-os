import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../apps/web');

async function read(relativePath) {
  return readFile(path.join(webRoot, relativePath), 'utf8');
}

test('AI connections page module exists at /ai-connections', async () => {
  await access(path.join(webRoot, 'app/ai-connections/page.tsx'));
});

test('lib/api.ts exposes safe AI connection read models and client functions', async () => {
  const api = await read('lib/api.ts');

  // Safe family policy shape — MUST NOT carry credentialStrategies over the wire to the browser.
  assert.match(
    api,
    /export interface SafeConnectionFamilyPolicy\s*\{[\s\S]*?id:\s*string[\s\S]*?providerId:\s*string[\s\S]*?displayName:\s*string[\s\S]*?executionMode:\s*'subscription'\s*\|\s*'api'\s*\|\s*'manual'[\s\S]*?allowedOwnership:\s*readonly AIConnectionOwnership\[\][\s\S]*?delegatable:\s*boolean[\s\S]*?requiresRunner:\s*boolean[\s\S]*?persistentSupported:\s*boolean[\s\S]*?\}/,
    'SafeConnectionFamilyPolicy must be declared without credentialStrategies',
  );
  assert.doesNotMatch(
    api,
    /credentialStrategies\s*:/,
    'web types must never expose credentialStrategies',
  );

  // Ownership / status / share mode enums exported for the UI.
  assert.match(api, /export type AIConnectionOwnership\s*=\s*'personal'\s*\|\s*'organisation'/);
  assert.match(
    api,
    /export type AIConnectionStatus\s*=\s*'configured'\s*\|\s*'available'\s*\|\s*'reauth_required'\s*\|\s*'disabled'\s*\|\s*'revoked'/,
  );
  assert.match(api, /export type AIConnectionShareMode\s*=\s*'online_only'\s*\|\s*'persistent'/);

  // Summary shape MUST include credentialConfigured boolean and MUST NOT include secretRefId
  // or any raw credential material.
  assert.match(
    api,
    /export interface AIConnectionSummary\s*\{[\s\S]*?id:\s*string[\s\S]*?ownership:\s*AIConnectionOwnership[\s\S]*?providerId:\s*string[\s\S]*?connectionFamilyId:\s*string[\s\S]*?status:\s*AIConnectionStatus[\s\S]*?credentialConfigured:\s*boolean[\s\S]*?\}/,
  );
  const summaryBlock = api.match(/export interface AIConnectionSummary\s*\{[\s\S]*?\n\}/);
  assert.ok(summaryBlock, 'AIConnectionSummary block must be declared');
  assert.doesNotMatch(summaryBlock[0], /secretRefId/);
  assert.doesNotMatch(summaryBlock[0], /credentialStrategy/);
  const aiSection = api.slice(api.indexOf('// -------------------- AI Connections'));
  assert.ok(aiSection.length > 0, 'AI Connections section must exist in lib/api.ts');
  assert.doesNotMatch(aiSection, /\bpassword\s*[:?]\s*string/);
  assert.doesNotMatch(aiSection, /\bapiKey\s*[:?]\s*string/i);
  assert.doesNotMatch(aiSection, /\btoken\s*[:?]\s*string/);
  assert.doesNotMatch(aiSection, /\bcookie\s*[:?]\s*string/i);

  // Project execution pool shape used by /ai-connections.
  assert.match(
    api,
    /export interface ProjectExecutionPoolEntry\s*\{[\s\S]*?connectionId:\s*string[\s\S]*?tier:\s*'requester'\s*\|\s*'project_pool'\s*\|\s*'organisation'[\s\S]*?providerId:\s*string[\s\S]*?connectionFamilyId:\s*string[\s\S]*?eligible:\s*boolean[\s\S]*?reasons:\s*[^\n]*ProjectExecutionPoolReason\[\]/,
  );

  // Client functions hitting the Task 6 backend routes.
  assert.match(api, /export function listAIConnectionFamilies\(/);
  assert.match(api, /\/ai-connection-families/);
  assert.match(api, /export function listAIConnections\(/);
  assert.match(api, /export function registerPersonalAIConnection\(/);
  assert.match(api, /\/ai-connections\/personal/);
  assert.match(api, /export function registerOrganisationAIConnection\(/);
  assert.match(api, /\/admin\/ai-connections/);
  assert.match(api, /export function revokeAIConnection\(/);
  assert.match(api, /export function listProjectAIExecutionPool\(/);
  assert.match(api, /export function shareAIConnectionWithProject\(/);
  assert.match(api, /export function setAIConnectionShareMode\(/);
  assert.match(api, /export function updateAIConnectionShareWindow\(/);
  assert.match(api, /export function revokeAIConnectionProjectShare\(/);

  // Personal register signature is connectionFamilyId only — no ownerUserId / actorUserId / delegatable.
  assert.doesNotMatch(api, /registerPersonalAIConnection[\s\S]{0,200}?ownerUserId/);
  assert.doesNotMatch(api, /registerPersonalAIConnection[\s\S]{0,200}?actorUserId/);
  assert.doesNotMatch(api, /registerPersonalAIConnection[\s\S]{0,200}?delegatable/);
});

test('actions.ts wires AI connection server actions without accepting provider credentials or actor identity', async () => {
  const actions = await read('app/actions.ts');

  // Server actions exist for every UI mutation.
  assert.match(actions, /export async function registerPersonalAIConnectionAction\(/);
  assert.match(actions, /export async function registerOrganisationAIConnectionAction\(/);
  assert.match(actions, /export async function revokeAIConnectionAction\(/);
  assert.match(actions, /export async function shareAIConnectionAction\(/);
  assert.match(actions, /export async function setAIConnectionShareModeAction\(/);
  assert.match(actions, /export async function updateAIConnectionShareWindowAction\(/);
  assert.match(actions, /export async function revokeAIConnectionShareAction\(/);

  // Mutations revalidate the AI Connections page.
  assert.match(actions, /revalidatePath\('\/ai-connections'\)/);

  // Never pull actor/owner identity, delegatable flags or raw credential material from form input.
  assert.doesNotMatch(actions, /formData\.get\(['"]actorUserId['"]\)/);
  assert.doesNotMatch(actions, /formData\.get\(['"]ownerUserId['"]\)/);
  assert.doesNotMatch(actions, /formData\.get\(['"]delegatable['"]\)/);
  assert.doesNotMatch(actions, /formData\.get\(['"]password['"]\)/);
  assert.doesNotMatch(actions, /formData\.get\(['"]apiKey['"]\)/i);
  assert.doesNotMatch(actions, /formData\.get\(['"]token['"]\)/);
  assert.doesNotMatch(actions, /formData\.get\(['"]cookie['"]\)/i);
  assert.doesNotMatch(actions, /formData\.get\(['"]credentialStrategy['"]\)/);

  // First share call must create an online_only share via POST — persistent is a separate action.
  assert.match(
    actions,
    /shareAIConnectionAction[\s\S]*?shareAIConnectionWithProject\(/,
  );
  assert.match(
    actions,
    /setAIConnectionShareModeAction[\s\S]*?setAIConnectionShareMode\(/,
  );
  // Persistent switch cannot be smuggled through the initial share action.
  assert.doesNotMatch(
    actions,
    /shareAIConnectionAction[\s\S]{0,500}?['"]persistent['"]/,
  );
});

test('AI connections page fetches families from the server, exposes required sections and never leaks credentials', async () => {
  const page = await read('app/ai-connections/page.tsx');

  // Server-rendered dynamic page.
  assert.match(page, /export const dynamic\s*=\s*['"]force-dynamic['"]/);

  // Families come from the API, not a hardcoded browser union.
  assert.match(page, /listAIConnectionFamilies\(/);
  assert.doesNotMatch(
    page,
    /['"]openai['"]\s*\|\s*['"]anthropic['"]\s*\|\s*['"]google['"]/,
    'family choices must come from GET /ai-connection-families, not a hardcoded provider union',
  );

  // Sections required by ECC.UI.
  assert.match(page, /Personal Connections/);
  assert.match(page, /Organisation Connections/);
  assert.match(page, /Project Sharing/);

  // Uses the safe read models — no raw credential/secret rendering.
  assert.doesNotMatch(page, /secretRefId\s*:\s*string/);
  assert.doesNotMatch(page, /\.password\b/);
  assert.doesNotMatch(page, /\.apiKey\b/i);
  assert.doesNotMatch(page, /\.token\b/);
  assert.doesNotMatch(page, /\.cookie\b/i);
  assert.doesNotMatch(page, /credentialStrategies/);

  // Personal register form uses connectionFamilyId only.
  assert.match(
    page,
    /action=\{registerPersonalAIConnectionAction\}[\s\S]*?name=["']connectionFamilyId["']/,
  );
  // Personal register form MUST NOT ask for provider credential material or owner identity.
  assert.doesNotMatch(
    page,
    /action=\{registerPersonalAIConnectionAction\}[\s\S]{0,1200}?name=["'](password|apiKey|token|cookie|secretRefId|ownerUserId|actorUserId|delegatable)["']/i,
  );

  // Organisation register controls gated on organisation owner/admin role.
  assert.match(page, /organisationRole/);
  assert.match(page, /'owner'\s*\|\|\s*[^\n]*'admin'|role\s*===\s*'owner'[\s\S]{0,120}?role\s*===\s*'admin'/);
  // If secretRefId is offered it is clearly labelled as an external secret-reference identifier
  // and never re-rendered after submission (no summary card echoing the value back).
  if (/name=["']secretRefId["']/.test(page)) {
    assert.match(page, /external secret[- ]reference/i);
    assert.doesNotMatch(page, /Saved secret ref:/i);
  }

  // Project sharing controls only iterate projects returned to the current user.
  assert.match(page, /listProjects\(\)/);
  // First share action clearly says Online Only.
  assert.match(page, /Online Only/);
  assert.match(page, /action=\{shareAIConnectionAction\}/);
  // Persistent switch is a SEPARATE action, only rendered when policy says persistent supported.
  assert.match(page, /action=\{setAIConnectionShareModeAction\}/);
  assert.match(page, /persistentSupported/);
  // "Do Not Share" is never shown against an active share — controls only offer Revoke.
  assert.doesNotMatch(page, /Do Not Share/);
  assert.match(page, /action=\{revokeAIConnectionShareAction\}/);

  // Execution-pool entries render server-provided eligibility & reasons (no client-side re-derivation).
  assert.match(page, /entry\.eligible/);
  assert.match(page, /entry\.reasons/);
  // credentialConfigured is only shown as a status/boolean, not a value.
  assert.match(page, /credentialConfigured/);

  // Revoke connection uses the existing authenticated action.
  assert.match(page, /action=\{revokeAIConnectionAction\}/);
  // Usage-window control uses the dedicated window update action.
  assert.match(page, /action=\{updateAIConnectionShareWindowAction\}/);
});

test('globals.css adds AI connection administration styling', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /\.ai-connections/);
  assert.match(css, /\.ai-connection-card/);
});
