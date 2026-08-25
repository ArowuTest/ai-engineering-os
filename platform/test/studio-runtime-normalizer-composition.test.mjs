import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '../apps/api');

async function read(relativePath) {
  return readFile(path.join(apiRoot, relativePath), 'utf8');
}

test('real runtime composes configured Studio artifact semantic normalization', async () => {
  const server = await read('src/server.ts');
  assert.match(server, /createConfiguredStudioArtifactSemanticNormalizer/);
  assert.match(server, /studioArtifactSemanticNormalizer\s*=\s*createConfiguredStudioArtifactSemanticNormalizer\(environment\)/);
  assert.match(server, /studioArtifactSemanticNormalizer/);
  assert.match(server, /buildApp\([\s\S]*?studioArtifactSemanticNormalizer/);
});
