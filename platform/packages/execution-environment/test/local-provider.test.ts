import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalExecutionEnvironmentProvider } from '../src/index.js';

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'engineering-os-env-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('execution environment package contract', () => {
  it('exports a local provider factory behind the generic environment boundary', () => {
    expect(createLocalExecutionEnvironmentProvider).toBeTypeOf('function');
  });

  it('prepares only workspaces contained beneath an approved root', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'task-worktree');
    await mkdir(workspace);
    const outside = await tempRoot();

    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot] });

    await expect(provider.prepare({ workspacePath: workspace })).resolves.toMatchObject({
      workspacePath: expect.any(String),
    });
    await expect(provider.prepare({ workspacePath: outside })).rejects.toThrow(/approved root/i);
  });

  it('rejects a workspace symlink that escapes an approved root', async () => {
    const approvedRoot = await tempRoot();
    const outside = await tempRoot();
    const escape = path.join(approvedRoot, 'escape');
    await symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');

    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot] });

    await expect(provider.prepare({ workspacePath: escape })).rejects.toThrow(/approved root/i);
  });
});


describe('local execution process boundary', () => {
  it('executes structured argv with shell:false', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const calls: unknown[] = [];
    const runtime = {
      spawn(input: unknown) {
        calls.push(input);
        return {
          pid: 41,
          stdout: (async function* () { yield 'ok'; })(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({
      approvedRoots: [approvedRoot],
      runtime,
    });
    const environment = await provider.prepare({ workspacePath: workspace });

    await provider.execute(environment, { command: 'node', args: ['-e', 'console.log("x; rm -rf /")'] });

    expect(calls).toEqual([expect.objectContaining({
      command: 'node',
      args: ['-e', 'console.log("x; rm -rf /")'],
      shell: false,
      cwd: expect.any(String),
    })]);
  });
});


describe('local execution cwd containment', () => {
  it('honours a contained relative cwd and rejects traversal outside the workspace', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    const nested = path.join(workspace, 'packages', 'api');
    await mkdir(nested, { recursive: true });
    const calls: any[] = [];
    const runtime = {
      spawn(input: unknown) {
        calls.push(input);
        return {
          stdout: (async function* () {})(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], runtime });
    const environment = await provider.prepare({ workspacePath: workspace });

    await provider.execute(environment, { command: 'node', args: [], cwd: 'packages/api' });
    expect(calls[0].cwd).toBe(await import('node:fs/promises').then(({ realpath }) => realpath(nested)));
    await expect(provider.execute(environment, { command: 'node', args: [], cwd: '..' }))
      .rejects.toThrow(/workspace/i);
  });});


describe('local execution environment allowlist', () => {
  it('passes only configured base environment and allowlisted command overrides', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const calls: any[] = [];
    const runtime = {
      spawn(input: unknown) {
        calls.push(input);
        return {
          stdout: (async function* () {})(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({
      approvedRoots: [approvedRoot],
      allowedEnvironmentKeys: ['CI'],
      baseEnvironment: { PATH: 'runner-path' },
      runtime,
    });
    const environment = await provider.prepare({ workspacePath: workspace });

    await provider.execute(environment, { command: 'node', args: [], env: { CI: '1' } });

    expect(calls[0].env).toEqual({ PATH: 'runner-path', CI: '1' });
  });
});


describe('local execution environment allowlist', () => {
  it('passes only allowlisted base/command variables and rejects unapproved keys', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const calls: any[] = [];
    const runtime = {
      spawn(input: unknown) {
        calls.push(input);
        return {
          stdout: (async function* () {})(), stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({
      approvedRoots: [approvedRoot], runtime,
      allowedEnvironmentKeys: ['SAFE_FLAG'],
      baseEnvironment: { PATH: 'safe-path' },
    });
    const environment = await provider.prepare({ workspacePath: workspace });

    await provider.execute(environment, { command: 'tool', args: [], env: { SAFE_FLAG: '1' } });
    expect(calls[0].env).toEqual({ PATH: 'safe-path', SAFE_FLAG: '1' });
    await expect(provider.execute(environment, { command: 'tool', args: [], env: { RUNNER_SECRET: 'x' } }))
      .rejects.toThrow(/allowlist/i);
  });
});

describe('local execution bounded evidence', () => {
  it('bounds stdout/stderr and the normalized execution-event collection', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const runtime = {
      spawn() {
        return {
          stdout: (async function* () { yield 'abc'; yield 'def'; })(),
          stderr: (async function* () { yield '12'; yield '3456'; })(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({
      approvedRoots: [approvedRoot], runtime, maxOutputBytes: 5, maxEventCount: 2,
    });
    const environment = await provider.prepare({ workspacePath: workspace });

    const result = await provider.execute(environment, { command: 'tool', args: [] });

    expect(result.stdout).toBe('abcde');
    expect(result.stderr).toBe('12345');
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event: any) => event.sequence)).toEqual([0, 1]);
    expect(result.eventsTruncated).toBe(true);
  });
});

describe('local execution cancellation', () => {
  it('terminates only the process tree spawned for the targeted prepared environment', async () => {
    const approvedRoot = await tempRoot();
    const workspaceA = path.join(approvedRoot, 'a');
    const workspaceB = path.join(approvedRoot, 'b');
    await mkdir(workspaceA); await mkdir(workspaceB);
    let finish!: (value: { exitCode: number | null; signal: string | null }) => void;
    let spawned!: () => void;
    const spawnedSignal = new Promise<void>((resolve) => { spawned = resolve; });
    const completion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { finish = resolve; });
    const terminated: unknown[] = [];
    const execution = {
      pid: 77,
      stdout: (async function* () {})(), stderr: (async function* () {})(), completion,
    };
    const runtime = {
      spawn() { spawned(); return execution; },
      async terminateTree(value: unknown) {
        terminated.push(value);
        finish({ exitCode: null, signal: 'SIGTERM' });
      },
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], runtime });
    const environmentA = await provider.prepare({ workspacePath: workspaceA });
    const environmentB = await provider.prepare({ workspacePath: workspaceB });
    const running = provider.execute(environmentA, { command: 'tool', args: [] });
    await spawnedSignal;

    await expect(provider.cancel(environmentB)).resolves.toBe(false);
    await expect(provider.cancel(environmentA)).resolves.toBe(true);
    expect(terminated).toEqual([execution]);
    await running;
    await expect(provider.cancel(environmentA)).resolves.toBe(false);
  });
});

describe('local execution deterministic cleanup', () => {
  it('destroy cancels active work, invalidates provider state, and preserves the caller-owned worktree', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    let finish!: (value: { exitCode: number | null; signal: string | null }) => void;
    let spawned!: () => void;
    const spawnedSignal = new Promise<void>((resolve) => { spawned = resolve; });
    const completion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { finish = resolve; });
    const terminated: unknown[] = [];
    const execution = {
      stdout: (async function* () {})(), stderr: (async function* () {})(), completion,
    };
    const runtime = {
      spawn() { spawned(); return execution; },
      async terminateTree(value: unknown) {
        terminated.push(value);
        finish({ exitCode: null, signal: 'SIGTERM' });
      },
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    const running = provider.execute(environment, { command: 'tool', args: [] });
    await spawnedSignal;

    await expect(provider.destroy(environment)).resolves.toBe(true);
    expect(terminated).toEqual([execution]);
    await expect(import('node:fs/promises').then(({ stat }) => stat(workspace))).resolves.toBeTruthy();
    await expect(provider.destroy(environment)).resolves.toBe(false);
    await running;
  });
});

describe('prepared environment authority', () => {
  it('rejects forged or destroyed environment handles before spawning a process', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
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
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    const forged = { workspacePath: environment.workspacePath };

    await expect(provider.execute(forged, { command: 'tool', args: [] }))
      .rejects.toThrow(/prepared environment/i);
    expect(spawnCount).toBe(0);
    await provider.destroy(environment);
    await expect(provider.execute(environment, { command: 'tool', args: [] }))
      .rejects.toThrow(/prepared environment/i);
    expect(spawnCount).toBe(0);
  });
});

describe('scoped file and artifact access', () => {
  it('keeps reads, writes, and artifact collection inside the live prepared workspace', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    const outside = await tempRoot();
    await mkdir(path.join(workspace, 'out'), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path.join(outside, 'secret.txt'), 'secret'));
    await symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot] });
    const environment = await provider.prepare({ workspacePath: workspace });

    await provider.writeFile(environment, 'out/result.txt', Buffer.from('ok'));
    const read = await provider.readFile(environment, 'out/result.txt');
    expect(Buffer.from(read).toString('utf8')).toBe('ok');
    const artifact = await provider.collectArtifact(environment, 'out/result.txt');
    expect(artifact.relativePath).toBe('out/result.txt');
    expect(Buffer.from(artifact.data).toString('utf8')).toBe('ok');

    await expect(provider.readFile(environment, '../secret.txt')).rejects.toThrow(/workspace/i);
    await expect(provider.writeFile(environment, '../escape.txt', Buffer.from('x'))).rejects.toThrow(/workspace/i);
    await expect(provider.readFile(environment, 'escape/secret.txt')).rejects.toThrow(/workspace/i);
  });
});

describe('default local process runtime', () => {
  it('executes an absolute program path as argv without requiring an injected runtime', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot] });
    const environment = await provider.prepare({ workspacePath: workspace });

    const result = await provider.execute(environment, {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("real-local")'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('real-local');
    expect(result.stderr).toBe('');
  });
});

describe('local filesystem injection', () => {
  it('routes containment and file operations through the injected filesystem facade', async () => {
    const actual = await import('node:fs/promises');
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    let lstatCalls = 0; let realpathCalls = 0; let reads = 0; let writes = 0;
    const fileSystem = {
      async lstat(target: string) { lstatCalls += 1; return actual.lstat(target); },
      async realpath(target: string) { realpathCalls += 1; return actual.realpath(target); },
      async readFile(target: string) { reads += 1; return actual.readFile(target); },
      async writeFile(target: string, data: Uint8Array) { writes += 1; await actual.writeFile(target, data); },
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], fileSystem });
    const environment = await provider.prepare({ workspacePath: workspace });
    await provider.writeFile(environment, 'x.txt', Buffer.from('x'));
    await provider.readFile(environment, 'x.txt');

    expect(lstatCalls).toBeGreaterThan(0);
    expect(realpathCalls).toBeGreaterThan(0);
    expect(writes).toBe(1);
    expect(reads).toBe(1);
  });
});

describe('single active execution authority', () => {
  it('rejects a second execution while the prepared environment already has active work', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    let finish!: (value: { exitCode: number | null; signal: string | null }) => void;
    let spawned!: () => void;
    const spawnedSignal = new Promise<void>((resolve) => { spawned = resolve; });
    const completion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { finish = resolve; });
    let spawnCount = 0;
    const runtime = {
      spawn() {
        spawnCount += 1;
        spawned();
        const selectedCompletion = spawnCount === 1
          ? completion
          : Promise.resolve({ exitCode: 0, signal: null });
        return {
          stdout: (async function* () {})(),
          stderr: (async function* () {})(),
          completion: selectedCompletion,
        };
      },
      async terminateTree() {},
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    const first = provider.execute(environment, { command: 'tool', args: ['first'] });
    await spawnedSignal;

    await expect(provider.execute(environment, { command: 'tool', args: ['second'] }))
      .rejects.toThrow(/active execution/i);
    expect(spawnCount).toBe(1);
    finish({ exitCode: 0, signal: null });
    await first;
  });
});

describe('prepared workspace immutability', () => {
  it('cannot redirect a live prepared handle outside its prepare-time workspace', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    const outside = await tempRoot();
    await mkdir(workspace);
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(path.join(outside, 'secret.txt'), 'outside-secret'));
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(path.join(workspace, 'secret.txt'), 'workspace-secret'));
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot] });
    const environment = await provider.prepare({ workspacePath: workspace });

    Reflect.set(environment, 'workspacePath', outside);
    const read = await provider.readFile(environment, 'secret.txt');

    expect(Buffer.from(read).toString('utf8')).toBe('workspace-secret');
    expect(environment.workspacePath).not.toBe(outside);
  });
});

describe('pre-spawn lifecycle serialization', () => {
  it('reserves the environment before async cwd resolution so concurrent execute cannot spawn twice', async () => {
    const actual = await import('node:fs/promises');
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    let delay = false;
    const fileSystem = {
      async lstat(target: string) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, 25));
        return actual.lstat(target);
      },
      realpath: (target: string) => actual.realpath(target),
      readFile: (target: string) => actual.readFile(target),
      writeFile: (target: string, data: Uint8Array) => actual.writeFile(target, data),
    };
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
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], fileSystem, runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    delay = true;

    const results = await Promise.allSettled([
      provider.execute(environment, { command: 'tool', args: ['first'] }),
      provider.execute(environment, { command: 'tool', args: ['second'] }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(spawnCount).toBe(1);
  });
});

describe('destroy during pending start', () => {
  it('does not report destroyed then allow the pending execute to spawn', async () => {
    const actual = await import('node:fs/promises');
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree');
    await mkdir(workspace);
    let delay = false;
    const fileSystem = {
      async lstat(target: string) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, 25));
        return actual.lstat(target);
      },
      realpath: (target: string) => actual.realpath(target),
      readFile: (target: string) => actual.readFile(target),
      writeFile: (target: string, data: Uint8Array) => actual.writeFile(target, data),
    };
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
    };
    const provider = (createLocalExecutionEnvironmentProvider as any)({ approvedRoots: [approvedRoot], fileSystem, runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    delay = true;
    const running = provider.execute(environment, { command: 'tool', args: [] });
    const destroying = provider.destroy(environment);

    await expect(destroying).resolves.toBe(true);
    await expect(running).rejects.toThrow(/destroy/i);
    expect(spawnCount).toBe(0);
    await expect(provider.destroy(environment)).resolves.toBe(false);
  });
});
describe('default POSIX process-tree termination', () => {
  it('waits for exit and escalates SIGTERM-resistant groups to SIGKILL', async () => {
    const module = await import('../src/local-provider.js') as any;
    let finish!: (value: { exitCode: number | null; signal: string | null }) => void;
    const completion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { finish = resolve; });
    const signals: string[] = [];
    const runtime = module.createNodeProcessRuntime({
      platform: 'linux',
      terminationGraceMs: 5,
      forceKillGraceMs: 50,
      killProcessGroup(_pid: number, signal: string) {
        signals.push(signal);
        if (signal === 'SIGKILL') finish({ exitCode: null, signal: 'SIGKILL' });
      },
    });
    const execution = {
      pid: 42,
      stdout: (async function* () {})(), stderr: (async function* () {})(), completion,
    };

    await runtime.terminateTree(execution);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('default Windows process-tree termination', () => {
  it('treats taskkill not-found as success when the execution has already completed', async () => {
    const module = await import('../src/local-provider.js') as any;
    let taskkillCalls = 0;
    const runtime = module.createNodeProcessRuntime({
      platform: 'win32',
      terminationGraceMs: 10,
      async runTaskkill() {
        taskkillCalls += 1;
        return 128;
      },
    });
    const execution = {
      pid: 77,
      stdout: (async function* () {})(), stderr: (async function* () {})(),
      completion: Promise.resolve({ exitCode: 0, signal: null }),
    };

    await expect(runtime.terminateTree(execution)).resolves.toBeUndefined();
    expect(taskkillCalls).toBe(1);
  });
});

describe('UTF-8 execution events', () => {
  it('preserves a multi-byte code point split across runtime chunks', async () => {
    const approvedRoot = await tempRoot();
    const workspace = path.join(approvedRoot, 'worktree-utf8');
    await mkdir(workspace);
    const runtime = {
      spawn() {
        return {
          stdout: (async function* () { yield Buffer.from([0xc3]); yield Buffer.from([0xa9]); })(),
          stderr: (async function* () {})(),
          completion: Promise.resolve({ exitCode: 0, signal: null }),
        };
      },
      async terminateTree() {},
    };
    const provider = createLocalExecutionEnvironmentProvider({ approvedRoots: [approvedRoot], runtime });
    const environment = await provider.prepare({ workspacePath: workspace });
    const result = await provider.execute(environment, { command: 'tool', args: [] });

    expect(result.stdout).toBe('é');
    expect(result.events.filter((event) => event.stream === 'stdout').map((event) => event.data).join('')).toBe('é');
    expect(result.events.some((event) => event.data.includes('\uFFFD'))).toBe(false);
  });
});
