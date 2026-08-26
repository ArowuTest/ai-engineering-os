import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../apps/web');
async function read(relativePath) { return readFile(path.join(webRoot, relativePath), 'utf8'); }

test('web API exposes governed capability discovery and independent turn selection', async () => {
  const api = await read('lib/api.ts');
  assert.match(api, /interface CapabilitySummary[\s\S]*?id:\s*string;[\s\S]*?kind:\s*string;/);
  assert.match(api, /export function listProjectCapabilities\(/);
  assert.match(api, /capabilities\?kind=/);
  assert.match(api, /interface StudioTurnSelection/);
  assert.match(api, /agentId\?:\s*string/);
  assert.match(api, /harnessId\?:\s*string/);
  assert.match(api, /modelRouteId\?:\s*string/);
  assert.match(api, /sendProductPartnerTurn[\s\S]*?selection/);
});
test('server action forwards Agent Model Route and Harness independently', async () => {
  const actions = await read('app/actions.ts');
  assert.match(actions, /sendProductPartnerTurnAction[\s\S]*?agentId/);
  assert.match(actions, /sendProductPartnerTurnAction[\s\S]*?harnessId/);
  assert.match(actions, /sendProductPartnerTurnAction[\s\S]*?modelRouteId/);
  assert.match(actions, /normalizeStudioSelectionValue\(formData\.get\('agentId'\)\)/);
  assert.doesNotMatch(actions, /agentId[\s\S]{0,120}?modelRouteId\s*=\s*agentId/);
});

test('Product Studio keeps governed execution controls progressively disclosed with grouped exact routes', async () => {
  const page = await read('app/projects/[id]/page.tsx');
  assert.match(page, /listProjectCapabilities\(id,\s*'agent'\)/);
  assert.match(page, /listProjectCapabilities\(id,\s*'harness'\)/);
  assert.match(page, /<details className="composer-advanced">/);
  assert.match(page, /<summary>Advanced controls<\/summary>/);
  assert.match(page, /name="agentId"/);
  assert.match(page, /name="modelRouteId"/);
  assert.match(page, /name="harnessId"/);
  assert.match(page, /<option value="auto">Auto<\/option>/);
  assert.match(page, /groupStudioModelRoutes\(liveCapableRoutes\)/);
  assert.match(page, /<optgroup key=\{group\.key\} label=\{group\.label\}>/);
  assert.match(page, /value=\{route\.id\}/);
  assert.match(page, /listProjectCapabilities\(id,\s*'skill'\)/);
  assert.match(page, /listProjectCapabilities\(id,\s*'mcp_tool'\)/);
  assert.match(page, /listProjectCapabilities\(id,\s*'workflow'\)/);
  assert.match(page, /Project capabilities/);
  assert.match(page, /Skills/);
  assert.match(page, /MCP &amp; tools/);
  assert.match(page, /Workflows/);
  assert.match(page, /href="\/ai-connections"/);
});

test('web API uploads Studio artifacts as binary without accepting storage authority from the client', async () => {
  const api = await read('lib/api.ts');
  assert.match(api, /export function uploadStudioInteractionArtifact\(/);
  assert.match(api, /application\/octet-stream/);
  assert.match(api, /x-studio-artifact-kind/);
  assert.match(api, /x-studio-artifact-source/);
  assert.match(api, /x-studio-artifact-media-type/);
  assert.doesNotMatch(api, /uploadStudioInteractionArtifact[\s\S]{0,500}?storageReference/);
});

test('turn server action uploads governed files before forwarding artifact IDs', async () => {
  const actions = await read('app/actions.ts');
  assert.match(actions, /studioFiles\(formData,\s*'artifacts'\)/);
  assert.match(actions, /studioFiles\(formData,\s*'screenshots'\)/);
  assert.match(actions, /formData\.getAll\(key\)/);
  assert.match(actions, /formData\.get\('voice'\)/);
  assert.match(actions, /uploadStudioInteractionArtifact/);
  assert.match(actions, /artifactIds/);
  assert.match(actions, /source:\s*'microphone'/);
  assert.match(actions, /source:\s*'screenshot'/);
});
test('Product Studio exposes governed file image screenshot and voice inputs on the same turn form', async () => {
  const page = await read('app/projects/[id]/page.tsx');
  assert.match(page, /name="artifacts"/);
  assert.match(page, /multiple/);
  assert.match(page, /name="screenshots"/);
  assert.match(page, /accept="image\/\*"/);
  assert.match(page, /name="voice"/);
  assert.match(page, /accept="audio\/\*"/);
  assert.match(page, /capture/);
  assert.doesNotMatch(page, /name="storageReference"/);
});
test('Next Server Action upload envelope is explicit and bounded for Studio multimodal turns', async () => {
  const config = await read('next.config.ts');
  assert.match(config, /serverActions/);
  assert.match(config, /bodySizeLimit:\s*'26mb'/);
  const actions = await read('app/actions.ts');
  assert.match(actions, /assertStudioArtifactBytes/);
  assert.match(actions, /prepared\.reduce/);
});
test('Product Studio does not advertise video before a production video normalizer exists', async () => {
  const page = await read('app/projects/[id]/page.tsx');
  const artifactAccept = page.match(/name="artifacts"[\s\S]{0,240}?accept="([^"]+)"/)?.[1] ?? '';
  assert.doesNotMatch(artifactAccept, /video\/\*/);
  assert.doesNotMatch(page, /name="screenRecording"/);
});
