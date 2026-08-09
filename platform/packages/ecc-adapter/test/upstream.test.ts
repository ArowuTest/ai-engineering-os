import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getAcceptedEccBaseline } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ECC upstream provenance', () => {
  it('loads the accepted official ECC baseline', async () => {
    const baseline = await getAcceptedEccBaseline(repositoryRoot);

    expect(baseline.upstreamRepository).toBe('https://github.com/affaan-m/ECC.git');
    expect(baseline.commitSha).toBe('51a6950bde756fe3ebc8879aa0c8ee49b9c53e78');
    expect(baseline.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.importedOn).toBe('2026-08-09');
    expect(baseline.privateRepository).toBe('ArowuTest/ai-engineering-os');
  });
  it('fails closed when the provenance file contains a malformed commit SHA', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'engineering-os-ecc-'));
    temporaryDirectories.push(directory);
    await writeFile(
      path.join(directory, 'UPSTREAM.md'),
      [
        '# ECC Upstream Provenance',
        '- Upstream repository: `https://github.com/affaan-m/ECC.git`',
        '- Imported on: 2026-08-09',
        '- Accepted upstream commit: `not-a-sha`',
        '- Upstream describe at import: `v2.1.0`',
        '- Private repository: `ArowuTest/ai-engineering-os`',
      ].join('\n'),
      'utf8',
    );

    await expect(getAcceptedEccBaseline(directory)).rejects.toThrow('Invalid ECC upstream provenance');
  });

  it('fails closed when provenance is missing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'engineering-os-ecc-'));
    temporaryDirectories.push(directory);
    await expect(getAcceptedEccBaseline(directory)).rejects.toThrow('UPSTREAM.md');
  });
});
