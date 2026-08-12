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

test('lib/api.ts uses open provider IDs, exposes route capabilities and extraction summary', async () => {
  const api = await read('lib/api.ts');

  // provider IDs are open strings, not the closed union
  assert.doesNotMatch(
    api,
    /'openai'\s*\|\s*'anthropic'\s*\|\s*'google'/,
    'closed provider union must be removed',
  );

  // ProductPartner keeps 'auto' sentinel but partner type is open (auto | string)
  assert.match(api, /export type ProductPartner\s*=\s*'auto'\s*\|\s*string/);

  // ConversationMessage.provider is an open string, still optional
  assert.match(
    api,
    /interface ConversationMessage[\s\S]*?provider\?:\s*string;/,
    'ConversationMessage.provider must be optional string',
  );

  // ModelRouteSummary provider is open string
  assert.match(
    api,
    /interface ModelRouteSummary[\s\S]*?provider:\s*string;/,
    'ModelRouteSummary.provider must be string',
  );

  // ModelRouteSummary exposes capabilities including chat and structuredOutput
  assert.match(
    api,
    /interface ModelRouteSummary[\s\S]*?capabilities:\s*\{[\s\S]*?chat:\s*boolean;[\s\S]*?structuredOutput:\s*boolean;[\s\S]*?\}/,
    'ModelRouteSummary must expose chat and structuredOutput capabilities',
  );

  // ProductPartnerTurnResult.execution.provider is open string
  assert.match(
    api,
    /interface ProductPartnerTurnResult[\s\S]*?execution:\s*\{[\s\S]*?provider:\s*string;/,
    'turn result execution.provider must be string',
  );

  // ProductPartnerTurnResult exposes an extraction summary from the backend
  assert.match(
    api,
    /interface ProductPartnerTurnResult[\s\S]*?extraction:\s*\{[\s\S]*?runId:\s*string;[\s\S]*?status:[\s\S]*?candidateCount:\s*number;[\s\S]*?\}/,
    'turn result must expose extraction summary',
  );
});

test('Product Studio page uses fixed initial selector options and route-capability liveness', async () => {
  const page = await read('app/projects/[id]/page.tsx');

  // Fixed initial selector array Auto/OpenAI/Claude/Gemini
  assert.match(
    page,
    /partnerOptions[\s\S]*?value:\s*'auto'[\s\S]*?value:\s*'openai'[\s\S]*?value:\s*'anthropic'[\s\S]*?value:\s*'google'/,
    'page must declare a fixed initial partner option array Auto/OpenAI/Claude/Gemini',
  );

  // No longer relies on Object.entries(partnerLabels) to render the select
  assert.doesNotMatch(
    page,
    /Object\.entries\(partnerLabels\)/,
    'select must not iterate a closed partnerLabels record',
  );

  // Fallback label formatter for unknown/future provider IDs
  assert.match(
    page,
    /function\s+formatProviderLabel/,
    'page must provide a fallback provider-label formatter',
  );

  // Liveness requires BOTH chat and structuredOutput capabilities
  assert.match(
    page,
    /capabilities\.chat[\s\S]*?capabilities\.structuredOutput/,
    'liveness must check both chat and structuredOutput capabilities',
  );

  // 'auto' remains a routing sentinel — must not appear as a route provider identity check
  assert.doesNotMatch(
    page,
    /route\.provider\s*===\s*'auto'/,
    "'auto' must remain a sentinel, not a route provider identity",
  );
});
