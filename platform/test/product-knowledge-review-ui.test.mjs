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

test('lib/api.ts exposes candidate/run types and review client functions', async () => {
  const api = await read('lib/api.ts');

  // Domain aliases the web understands
  assert.match(api, /export type KnowledgeCandidateStatus\s*=\s*'pending'\s*\|\s*'accepted'\s*\|\s*'rejected'/);
  assert.match(api, /export type KnowledgeCandidateBasis\s*=\s*'user_stated'\s*\|\s*'assistant_inferred'\s*\|\s*'assistant_recommended'/);
  assert.match(api, /export type KnowledgeExtractionRunStatus\s*=\s*'received'\s*\|\s*'succeeded'\s*\|\s*'failed'/);

  // Candidate summary carries provenance the queue needs to render
  assert.match(
    api,
    /interface KnowledgeCandidateSummary[\s\S]*?extractionRunId:\s*string;[\s\S]*?category:\s*string;[\s\S]*?title:\s*string;[\s\S]*?content:\s*string;[\s\S]*?basis:\s*KnowledgeCandidateBasis;[\s\S]*?status:\s*KnowledgeCandidateStatus;/,
    'KnowledgeCandidateSummary must carry queue-critical fields',
  );

  // Client functions for the review workflow
  assert.match(api, /export function listKnowledgeCandidates\(/);
  assert.match(api, /knowledge-candidates\?status=pending/);
  assert.match(api, /export function acceptKnowledgeCandidate\(/);
  assert.match(api, /export function rejectKnowledgeCandidate\(/);
  assert.match(api, /export function retryKnowledgeExtraction\(/);

  // Retry hits the extraction run endpoint, not a candidate endpoint
  assert.match(api, /extraction-runs\/\$\{[^}]+\}\/retry/);

  // Reviewer identity is never transmitted from the client — the API uses the session cookie
  assert.doesNotMatch(api, /reviewerId:\s*string/);
});

test('actions.ts wires review server actions without accepting reviewer identity from forms', async () => {
  const actions = await read('app/actions.ts');

  assert.match(actions, /export async function acceptKnowledgeCandidateAction\(/);
  assert.match(actions, /export async function rejectKnowledgeCandidateAction\(/);
  assert.match(actions, /export async function retryKnowledgeExtractionAction\(/);

  // Server actions must revalidate the studio page after mutations
  assert.match(actions, /revalidatePath\(`\/projects\/\$\{projectId\}`\)/);

  // No 'reviewerId' or 'reviewerRole' input is ever pulled from formData
  assert.doesNotMatch(actions, /formData\.get\('reviewerId'\)/);
  assert.doesNotMatch(actions, /formData\.get\('reviewerRole'\)/);
  assert.doesNotMatch(actions, /formData\.get\('role'\)/);
});

test('Product Studio page renders the Product Knowledge Review Queue with role-aware controls', async () => {
  const page = await read('app/projects/[id]/page.tsx');

  // Queue surface is present in the right (Product Knowledge) region
  assert.match(page, /Review Queue/);
  assert.match(page, /listKnowledgeCandidates\(/);

  // Cards expose category/title/content, basis, provenance, source turn and review state
  assert.match(page, /candidate\.category/);
  assert.match(page, /candidate\.title/);
  assert.match(page, /candidate\.content/);
  assert.match(page, /candidate\.basis/);
  assert.match(page, /candidate\.status/);
  assert.match(page, /candidate\.extractionRunId/);
  // provider/model/route provenance from the most recent extraction turn must be surfaced.
  // The GET /projects/:id/knowledge-candidates response does not carry per-candidate run
  // metadata, so the studio surfaces provider/model/routeId via the assistant message
  // provider label + the extraction run identifier on each card.
  assert.match(page, /message\.provider|assistant.*provider/);

  // Product Owner controls
  assert.match(page, /acceptKnowledgeCandidateAction/);
  assert.match(page, /rejectKnowledgeCandidateAction/);
  assert.match(page, /retryKnowledgeExtractionAction/);

  // Edit & Accept fields must be present alongside accept action (editable category/title/content)
  assert.match(
    page,
    /action=\{acceptKnowledgeCandidateAction\}[\s\S]*?name="category"[\s\S]*?name="title"[\s\S]*?name="content"/,
    'Accept form must expose editable category/title/content fields',
  );

  // Role gate: controls only render when the effective role is product_owner. Role is read
  // from server-side identity — never from a browser-supplied form value.
  assert.match(page, /effectiveRole/);
  assert.match(page, /effectiveRole\s*===\s*'product_owner'/);
  assert.doesNotMatch(page, /name="reviewerId"/);
  assert.doesNotMatch(page, /name="reviewerRole"/);

  // Compact queue states
  assert.match(page, /candidates ready for review/);
  assert.match(page, /No new candidates/);
  assert.match(page, /Knowledge extraction failed/);

  // The successful assistant answer stays visible even when extraction failed — the message
  // list must remain unconditionally rendered rather than being hidden by extraction state.
  assert.doesNotMatch(page, /extractionFailed[\s\S]{0,120}?messages\.length/);
});

test('globals.css adds Review Queue styling without redesigning the three-region studio layout', async () => {
  const css = await read('app/globals.css');

  // New review queue classes present
  assert.match(css, /\.review-queue/);
  assert.match(css, /\.review-card/);

  // Studio's three-region grid is preserved
  assert.match(css, /\.studio-shell/);
  assert.match(css, /\.studio-nav/);
  assert.match(css, /\.studio-chat/);
  assert.match(css, /\.studio-knowledge/);
});
