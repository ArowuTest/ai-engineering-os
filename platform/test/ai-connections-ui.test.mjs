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

test('ProjectExecutionPoolEntry exposes durable, safe share metadata (id/mode/window only)', async () => {
  const api = await read('lib/api.ts');
  const entryBlock = api.match(/export interface ProjectExecutionPoolEntry\s*\{[\s\S]*?\n\}/);
  assert.ok(entryBlock, 'ProjectExecutionPoolEntry block must be declared');
  const block = entryBlock[0];
  assert.match(
    block,
    /share\?:\s*(ProjectExecutionPoolShareState|\{[\s\S]*?id:\s*string[\s\S]*?mode:\s*AIConnectionShareMode[\s\S]*?availableFrom\?:\s*string[\s\S]*?availableUntil\?:\s*string[\s\S]*?\})/,
    'ProjectExecutionPoolEntry must expose share?: { id; mode; availableFrom?; availableUntil? }',
  );
  // Ensure the referenced share-state interface is declared with the safe shape.
  const stateBlock = api.match(
    /export interface ProjectExecutionPoolShareState\s*\{[\s\S]*?\n\}/,
  );
  assert.ok(stateBlock, 'ProjectExecutionPoolShareState must be declared');
  assert.match(stateBlock[0], /id:\s*string/);
  assert.match(stateBlock[0], /mode:\s*AIConnectionShareMode/);
  assert.match(stateBlock[0], /availableFrom\?:\s*string/);
  assert.match(stateBlock[0], /availableUntil\?:\s*string/);
  // No credential or secret material may sneak into the share metadata.
  for (const dirty of [stateBlock[0], block]) {
    assert.doesNotMatch(dirty, /secretRefId/);
    assert.doesNotMatch(dirty, /credentialStrategy/);
    assert.doesNotMatch(dirty, /\bpassword\b/i);
    assert.doesNotMatch(dirty, /\bapiKey\b/i);
    assert.doesNotMatch(dirty, /\btoken\b/i);
    assert.doesNotMatch(dirty, /\bcookie\b/i);
  }
});

test('AI connections page derives owner share state from authoritative entry.share, hydrates windows and loads pools in parallel', async () => {
  const page = await read('app/ai-connections/page.tsx');

  // Owner share detection must NOT be tier-based; tier === 'project_pool' is for OTHER users' shares.
  assert.doesNotMatch(
    page,
    /entry\.tier\s*===\s*['"]project_pool['"]/,
    'owner share detection must not use tier === project_pool',
  );
  // Owner share detection uses the authoritative share metadata from the requester tier.
  assert.match(
    page,
    /entry\.tier\s*===\s*['"]requester['"][\s\S]{0,500}?\?\.share|entry\.tier\s*===\s*['"]requester['"][\s\S]{0,500}?\.share\b/,
    'owner-side share state must be derived from the requester-tier entry.share',
  );

  // Datetime-local inputs for the usage window must be hydrated from durable share windows,
  // not left blank (which would silently clear the persisted window on submit).
  assert.match(
    page,
    /type=["']datetime-local["'][\s\S]{0,400}?name=["']availableFrom["'][\s\S]{0,400}?defaultValue=\{[\s\S]*?[sS]hare[\s\S]*?availableFrom/,
    'availableFrom datetime-local must be hydrated from the active share',
  );
  assert.match(
    page,
    /type=["']datetime-local["'][\s\S]{0,400}?name=["']availableUntil["'][\s\S]{0,400}?defaultValue=\{[\s\S]*?[sS]hare[\s\S]*?availableUntil/,
    'availableUntil datetime-local must be hydrated from the active share',
  );

  // Project pools must be fetched in parallel (Promise.all), not serially.
  assert.match(page, /Promise\.all\(\s*projects\.map\(/, 'project pools must load in parallel');
  // Serial for-of over projects.map fetch should be gone.
  assert.doesNotMatch(
    page,
    /for\s*\(\s*const\s+project\s+of\s+projects\s*\)\s*\{[\s\S]{0,300}?await\s+listProjectAIExecutionPool/,
    'project pool loads must not be serialized in a for-of loop',
  );

  // Persistent-mode toggle stays gated on the family policy and the current active share mode.
  assert.match(page, /persistentSupported/);
});

test('AI connections page treats usage-window inputs as explicit UTC and offers an owner clear action', async () => {
  const page = await read('app/ai-connections/page.tsx');

  // Datetime-local inputs must be labelled UTC so operator intent is unambiguous.
  assert.match(
    page,
    /Available from\s*\(UTC\)/,
    'availableFrom label must be marked as UTC',
  );
  assert.match(
    page,
    /Available until\s*\(UTC\)/,
    'availableUntil label must be marked as UTC',
  );

  // An explicit owner clear action must be wired to a dedicated server action.
  assert.match(
    page,
    /action=\{clearAIConnectionShareWindowAction\}/,
    'page must render a form whose action is clearAIConnectionShareWindowAction',
  );
  assert.match(
    page,
    /Clear usage window/i,
    'clear action must be user-visible as "Clear usage window"',
  );
});

test('actions.ts parses datetime-local as UTC deterministically and exposes clearAIConnectionShareWindowAction', async () => {
  const actions = await read('app/actions.ts');

  // A timezone-less datetime-local value (YYYY-MM-DDTHH:MM[:SS]) must be normalised
  // to UTC BEFORE handing off to new Date(), so parsing is not server-TZ dependent.
  assert.match(
    actions,
    /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}(?:\(\?:\:\\d\{2\}\)\?)?(?:\\.\\d\+)?\$\/|\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}/,
    'actions.ts must detect timezone-less datetime-local values with a regex before parsing',
  );
  assert.match(
    actions,
    /(\+\s*['"]Z['"]|Date\.UTC\()/,
    'timezone-less datetime-local values must be coerced to UTC (append "Z" or use Date.UTC)',
  );

  // The dedicated clear action must exist and call the client with explicit nulls.
  assert.match(
    actions,
    /export async function clearAIConnectionShareWindowAction\(/,
    'clearAIConnectionShareWindowAction must be exported',
  );
  const clearAction = actions.match(
    /export async function clearAIConnectionShareWindowAction\([\s\S]*?\n\}/,
  );
  assert.ok(clearAction, 'clearAIConnectionShareWindowAction must be declared');
  assert.match(
    clearAction[0],
    /availableFrom:\s*null[\s\S]*?availableUntil:\s*null/,
    'clear action must pass explicit null bounds to the client',
  );
  assert.match(
    clearAction[0],
    /updateAIConnectionShareWindow\(/,
    'clear action must call updateAIConnectionShareWindow with null bounds',
  );
});

test('lib/api.ts updateAIConnectionShareWindow serialises explicit null bounds for owner clear', async () => {
  const api = await read('lib/api.ts');
  const fn = api.match(
    /export function updateAIConnectionShareWindow\([\s\S]*?(?=\nexport |\n\s*$)/,
  );
  assert.ok(fn, 'updateAIConnectionShareWindow must be declared');
  const block = fn[0];
  // Signature must accept string | null so callers can request an explicit clear.
  assert.match(
    block,
    /availableFrom\?:\s*string\s*\|\s*null/,
    'availableFrom must accept string | null',
  );
  assert.match(
    block,
    /availableUntil\?:\s*string\s*\|\s*null/,
    'availableUntil must accept string | null',
  );
  // Null must be forwarded in the JSON body (not stripped by a truthy check).
  assert.match(
    block,
    /availableFrom\s*===\s*null|input\.availableFrom\s*===\s*null/,
    'null availableFrom must be explicitly forwarded, not filtered by truthiness',
  );
  assert.match(
    block,
    /availableUntil\s*===\s*null|input\.availableUntil\s*===\s*null/,
    'null availableUntil must be explicitly forwarded, not filtered by truthiness',
  );
});

test('actions.ts guards update-window against blind PATCH and keeps mode & window PATCHes separate', async () => {
  const actions = await read('app/actions.ts');
  // Window update action must NOT issue a PATCH with no window fields (blind overwrite / silent
  // clear on backends that support it). It should short-circuit when the form is empty.
  assert.match(
    actions,
    /updateAIConnectionShareWindowAction[\s\S]{0,2000}?(?:if\s*\(\s*!availableFrom\s*&&\s*!availableUntil|availableFrom\s*===\s*undefined\s*&&\s*availableUntil\s*===\s*undefined)/,
    'update window action must short-circuit when no window fields are provided',
  );
  // Mode change action must NOT accept availableFrom/availableUntil fields (Task 6 rejects combined PATCH).
  const modeAction = actions.match(
    /export async function setAIConnectionShareModeAction\([\s\S]*?\n\}/,
  );
  assert.ok(modeAction, 'setAIConnectionShareModeAction must be declared');
  assert.doesNotMatch(
    modeAction[0],
    /availableFrom/,
    'mode-change action must not smuggle window fields',
  );
  assert.doesNotMatch(
    modeAction[0],
    /availableUntil/,
    'mode-change action must not smuggle window fields',
  );
});
