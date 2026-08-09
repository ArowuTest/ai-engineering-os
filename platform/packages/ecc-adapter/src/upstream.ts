import { readFile } from 'node:fs/promises';
import path from 'node:path';

const OFFICIAL_ECC_REPOSITORY = 'https://github.com/affaan-m/ECC.git';

export interface EccBaseline {
  upstreamRepository: string;
  importedOn: string;
  commitSha: string;
  upstreamDescribe: string;
  privateRepository: string;
}

function readField(content: string, label: string): string | null {
  const prefix = `- ${label}:`;
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (!line) return null;
  return line.slice(prefix.length).trim().replace(/^`|`$/g, '');
}

function validateBaseline(baseline: EccBaseline): void {
  const valid =
    baseline.upstreamRepository === OFFICIAL_ECC_REPOSITORY &&
    /^[0-9a-f]{40}$/.test(baseline.commitSha) &&
    /^\d{4}-\d{2}-\d{2}$/.test(baseline.importedOn) &&
    baseline.upstreamDescribe.length > 0 &&
    baseline.privateRepository.length > 0;

  if (!valid) throw new Error('Invalid ECC upstream provenance');
}
export async function getAcceptedEccBaseline(repositoryRoot: string): Promise<EccBaseline> {
  const provenancePath = path.join(repositoryRoot, 'UPSTREAM.md');
  let content: string;
  try {
    content = await readFile(provenancePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read UPSTREAM.md at ${provenancePath}`, { cause: error });
  }

  const baseline: EccBaseline = {
    upstreamRepository: readField(content, 'Upstream repository') ?? '',
    importedOn: readField(content, 'Imported on') ?? '',
    commitSha: readField(content, 'Accepted upstream commit') ?? '',
    upstreamDescribe: readField(content, 'Upstream describe at import') ?? '',
    privateRepository: readField(content, 'Private repository') ?? '',
  };
  validateBaseline(baseline);
  return baseline;
}
