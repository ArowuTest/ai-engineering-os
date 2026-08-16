import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspacePolicy } from '../src/workspace-policy.js';

const cleanup: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('local runner workspace policy', () => {
  it('accepts an existing absolute workspace beneath an approved root and returns its canonical path', async () => {
    const root = await temporaryDirectory('engineering-os-runner-root-');
    const workspace = join(root, 'task-worktree');
    await mkdir(workspace);
    const policy = createWorkspacePolicy({ approvedRoots: [root] });

    const resolved = await policy.resolve(workspace);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(await realpath(workspace));
  });

  it('rejects relative, outside, and missing workspace scopes', async () => {
    const root = await temporaryDirectory('engineering-os-runner-root-');
    const outside = await temporaryDirectory('engineering-os-runner-outside-');
    const policy = createWorkspacePolicy({ approvedRoots: [root] });

    await expect(policy.resolve('relative/worktree')).rejects.toThrow(/absolute/i);
    await expect(policy.resolve(outside)).rejects.toThrow(/approved root/i);
    await expect(policy.resolve(join(root, 'missing-worktree'))).rejects.toThrow(/workspace/i);
  });

  it('rejects a symlink inside an approved root when it resolves outside that root', async () => {
    const root = await temporaryDirectory('engineering-os-runner-root-');
    const outside = await temporaryDirectory('engineering-os-runner-outside-');
    const link = join(root, 'escaped-worktree');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const policy = createWorkspacePolicy({ approvedRoots: [root] });

    await expect(policy.resolve(link)).rejects.toThrow(/approved root/i);
  });

  it('fails closed when configured roots are missing or relative', async () => {
    expect(() => createWorkspacePolicy({ approvedRoots: [] })).toThrow(/approved root/i);
    expect(() => createWorkspacePolicy({ approvedRoots: ['relative-root'] })).toThrow(/absolute/i);
  });
});
