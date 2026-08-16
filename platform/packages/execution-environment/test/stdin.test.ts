import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalExecutionEnvironmentProvider } from '../src/index.js';

const roots: string[] = [];
async function workspace(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'engineering-os-stdin-'));
  roots.push(root);
  const workspacePath = path.join(root, 'worktree');
  await mkdir(workspacePath);
  return { root, path: workspacePath };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('structured execution stdin boundary', () => {
  it('passes bounded stdin to the injected runtime without putting it in argv', async () => {
    const prepared = await workspace();
    const calls: any[] = [];
    const runtime = {
      spawn(input: unknown) {
        calls.push(input);
        return {
          stdout: (async function* () { yield 'ok'; })(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };    const provider = createLocalExecutionEnvironmentProvider({
      approvedRoots: [prepared.root], runtime, maxInputBytes: 64,
    } as any);
    const environment = await provider.prepare({ workspacePath: prepared.path });
    const instruction = '--model attacker-controlled';

    await provider.execute(environment, {
      command: 'codex', args: ['exec', '-'], stdin: instruction,
    } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['exec', '-']);
    expect(Buffer.from(calls[0].stdin).toString('utf8')).toBe(instruction);
  });

  it('rejects oversized stdin before spawning', async () => {
    const prepared = await workspace();
    let spawnCount = 0;
    const runtime = {
      spawn() {
        spawnCount += 1;
        return {
          stdout: (async function* () {})(), stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };    const provider = createLocalExecutionEnvironmentProvider({
      approvedRoots: [prepared.root], runtime, maxInputBytes: 4,
    } as any);
    const environment = await provider.prepare({ workspacePath: prepared.path });

    await expect(provider.execute(environment, {
      command: 'tool', args: [], stdin: '12345',
    } as any)).rejects.toThrow(/stdin|input.*bytes/i);
    expect(spawnCount).toBe(0);
  });

  it('delivers stdin through the default Node runtime with shell:false', async () => {
    const prepared = await workspace();
    const provider = createLocalExecutionEnvironmentProvider({ approvedRoots: [prepared.root] } as any);
    const environment = await provider.prepare({ workspacePath: prepared.path });

    const result = await provider.execute(environment, {
      command: process.execPath,
      args: ['-e', "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s))"],
      stdin: 'stdin-roundtrip',
    } as any);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('stdin-roundtrip');
  });
});