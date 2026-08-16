import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalExecutionEnvironmentProvider } from '../src/index.js';
import { verifyExecutionEnvironmentProviderContract } from './provider-contract.js';

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'engineering-os-contract-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('execution environment provider contract helper', () => {
  it('exports a provider-neutral contract verifier for future managed providers', () => {
    expect(verifyExecutionEnvironmentProviderContract).toBeTypeOf('function');
  });

  it('verifies prepare, execute, scoped artifact access, and deterministic destroy', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const provider = createLocalExecutionEnvironmentProvider({ approvedRoots: [approvedRoot] });

    await expect((verifyExecutionEnvironmentProviderContract as any)({
      provider,
      prepareInput: { workspacePath: workspace },
      executeCommand: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("contract-ok")'],
      },
      expectedExitCode: 0,
      expectedStdout: 'contract-ok',
      artifactRelativePath: 'contract-artifact.bin',
      artifactData: Buffer.from([0, 1, 2, 255]),
    })).resolves.toBeUndefined();
  });
});


describe('execution environment provider contract cancellation', () => {
  it('requires an optional cancellable execution fixture to exercise provider-scoped cancellation', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree-cancel');
    await mkdir(workspace);
    let finishLong!: (value: { exitCode: number | null; signal: string | null }) => void;
    let longStarted!: () => void;
    const longStartedSignal = new Promise<void>((resolve) => { longStarted = resolve; });
    const longCompletion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
      finishLong = resolve;
    });
    let terminationCount = 0;
    const runtime = {
      spawn(input: { command: string }) {
        if (input.command === 'long-running') {
          longStarted();
          return {
            stdout: (async function* () {})(),
            stderr: (async function* () {})(),
            completion: longCompletion,
          };
        }
        return {
          stdout: (async function* () { yield 'contract-ok'; })(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {
        terminationCount += 1;
        finishLong({ exitCode: null, signal: 'SIGTERM' });
      },
    };
    const provider = createLocalExecutionEnvironmentProvider({ approvedRoots: [approvedRoot], runtime });

    await (verifyExecutionEnvironmentProviderContract as any)({
      provider,
      prepareInput: { workspacePath: workspace },
      executeCommand: { command: 'normal', args: [] },
      expectedExitCode: 0,
      expectedStdout: 'contract-ok',
      artifactRelativePath: 'contract-artifact.bin',
      artifactData: Buffer.from('artifact'),
      async startCancellableExecution(contractProvider: any, environment: any) {
        const result = contractProvider.execute(environment, { command: 'long-running', args: [] });
        await longStartedSignal;
        return { result };
      },
    });

    expect(terminationCount).toBe(1);
  });
});
