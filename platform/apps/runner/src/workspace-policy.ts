import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

export interface RunnerWorkspacePolicy {
  resolve(workspaceScope: string): Promise<string>;
}

export interface WorkspacePolicyOptions {
  approvedRoots: string[];
}

function assertAbsolute(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-blank absolute path`);
  }
  const normalized = value.trim();
  if (!isAbsolute(normalized)) {
    throw new Error(`${field} must be an absolute path`);
  }
  return normalized;
}

function contained(target: string, root: string): boolean {
  const within = relative(root, target);
  return within === '' || (
    within !== '..'
    && !within.startsWith(`..${sep}`)
    && !isAbsolute(within)
  );
}

async function canonicalDirectory(path: string, field: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch {
    throw new Error(`${field} does not resolve to an existing directory`);
  }
  const details = await stat(canonical);
  if (!details.isDirectory()) {
    throw new Error(`${field} must resolve to a directory`);
  }
  return canonical;
}

export function createWorkspacePolicy(options: WorkspacePolicyOptions): RunnerWorkspacePolicy {
  if (!Array.isArray(options.approvedRoots) || options.approvedRoots.length === 0) {
    throw new Error('At least one approved root is required');
  }
  const configuredRoots = options.approvedRoots.map((root, index) =>
    assertAbsolute(root, `approved root ${index}`));

  return {
    async resolve(workspaceScope: string): Promise<string> {
      const requested = assertAbsolute(workspaceScope, 'workspace scope');
      const workspace = await canonicalDirectory(requested, 'workspace');
      const roots = await Promise.all(configuredRoots.map((root, index) =>
        canonicalDirectory(root, `approved root ${index}`)));
      if (!roots.some((root) => contained(workspace, root))) {
        throw new Error('workspace is outside every approved root');
      }
      return workspace;
    },
  };
}
