import { spawn as spawnChild, type SpawnOptions } from 'node:child_process';
import { lstat as nodeLstat, readFile as nodeReadFile, realpath as nodeRealpath, writeFile as nodeWriteFile } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type {
  ExecutionEnvironmentProvider,
  ExecutionArtifact,
  ExecutionEvent,
  ExecutionResult,
  LocalExecutionEnvironmentProviderOptions,
  LocalFileSystem,
  LocalProcessRuntime,
  PreparedExecutionEnvironment,
  PrepareExecutionEnvironmentInput,
  StructuredExecutionCommand,
  SpawnedExecution,
} from './types.js';

const nodeFileSystem: LocalFileSystem = {
  lstat: (target) => nodeLstat(target),
  realpath: (target) => nodeRealpath(target),
  readFile: (target) => nodeReadFile(target),
  writeFile: (target, data) => nodeWriteFile(target, data),
};
async function pathEntryExists(target: string, fileSystem: LocalFileSystem): Promise<boolean> {
  try {
    await fileSystem.lstat(target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function realpathNearestExisting(target: string, fileSystem: LocalFileSystem): Promise<string> {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!(await pathEntryExists(current, fileSystem))) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const existing = await fileSystem.realpath(current);
  return tail.length > 0 ? path.join(existing, ...tail) : existing;
}

async function isWithinRoot(target: string, root: string, fileSystem: LocalFileSystem): Promise<boolean> {
  const [realRoot, realTarget] = await Promise.all([
    realpathNearestExisting(root, fileSystem),
    realpathNearestExisting(target, fileSystem),
  ]);
  const relative = path.relative(realRoot, realTarget);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string | undefined,
  fileSystem: LocalFileSystem,
): Promise<string> {
  if (relativePath === undefined || relativePath === '') return workspacePath;
  if (path.isAbsolute(relativePath)) throw new Error('Execution cwd must stay within the workspace');
  const target = path.resolve(workspacePath, relativePath);
  if (!(await isWithinRoot(target, workspacePath, fileSystem))) {
    throw new Error('Execution cwd must stay within the workspace');
  }
  return realpathNearestExisting(target, fileSystem);
}

function buildEnvironment(
  commandEnvironment: Record<string, string> | undefined,
  options: LocalExecutionEnvironmentProviderOptions,
): Record<string, string> {
  const environment = { ...(options.baseEnvironment ?? {}) };
  const allowed = new Set(options.allowedEnvironmentKeys ?? []);
  for (const [key, value] of Object.entries(commandEnvironment ?? {})) {
    if (!allowed.has(key)) {
      throw new Error(`Environment key is not in the allowlist: ${key}`);
    }
    environment[key] = value;
  }
  return environment;
}
async function collectOutput(
  chunks: AsyncIterable<string | Uint8Array>,
  stream: ExecutionEvent['stream'],
  maxBytes: number,
  recordEvent: (stream: ExecutionEvent['stream'], data: string) => void,
): Promise<{ text: string; truncated: boolean }> {
  const captured: Buffer[] = [];
  const decoder = new StringDecoder('utf8');
  let capturedBytes = 0;
  let truncated = false;
  for await (const chunk of chunks) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = Math.max(0, maxBytes - capturedBytes);
    const accepted = bytes.subarray(0, remaining);
    if (accepted.length > 0) {
      captured.push(accepted);
      capturedBytes += accepted.length;
      const decoded = decoder.write(accepted);
      if (decoded.length > 0) recordEvent(stream, decoded);
    }
    if (accepted.length < bytes.length) truncated = true;
  }
  const finalDecoded = decoder.end();
  if (finalDecoded.length > 0) recordEvent(stream, finalDecoded);
  return { text: Buffer.concat(captured).toString('utf8'), truncated };
}

interface NodeProcessRuntimeOptions {
  platform?: NodeJS.Platform;
  terminationGraceMs?: number;
  forceKillGraceMs?: number;
  killProcessGroup?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  runTaskkill?: (pid: number) => Promise<number>;
}

async function completionSettledWithin(
  completion: SpawnedExecution['completion'],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    completion.then(() => finish(true), () => finish(true));
  });
}

async function runDefaultTaskkill(pid: number): Promise<number> {
  const killer = spawnChild('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  return new Promise<number>((resolve, reject) => {
    killer.once('error', reject);
    killer.once('close', (code) => resolve(code ?? -1));
  });
}

export function createNodeProcessRuntime(
  runtimeOptions: NodeProcessRuntimeOptions = {},
): LocalProcessRuntime {
  const platform = runtimeOptions.platform ?? process.platform;
  const terminationGraceMs = runtimeOptions.terminationGraceMs ?? 1500;
  const forceKillGraceMs = runtimeOptions.forceKillGraceMs ?? 1500;
  const killProcessGroup = runtimeOptions.killProcessGroup
    ?? ((pid: number, signal: 'SIGTERM' | 'SIGKILL') => process.kill(-pid, signal));
  const runTaskkill = runtimeOptions.runTaskkill ?? runDefaultTaskkill;

  return {
    spawn(input) {
      const spawnOptions: SpawnOptions = {
        cwd: input.cwd,
        env: input.env as NodeJS.ProcessEnv,
        shell: false,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      };
      const child = spawnChild(input.command, input.args, spawnOptions);
      if (!child.stdout || !child.stderr) throw new Error('Execution process streams were not created');
      const completion = new Promise<{ exitCode: number | null; signal: string | null }>((resolve, reject) => {
        let settled = false;
        child.once('error', (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
        child.once('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          settled = true;
          resolve({ exitCode, signal });
        });
      });
      return child.pid === undefined
        ? { stdout: child.stdout, stderr: child.stderr, completion }
        : { pid: child.pid, stdout: child.stdout, stderr: child.stderr, completion };
    },
    async terminateTree(execution) {
      if (!execution.pid) return;
      if (platform === 'win32') {
        const code = await runTaskkill(execution.pid);
        if (code !== 0) {
          if (await completionSettledWithin(execution.completion, terminationGraceMs)) return;
          throw new Error(`taskkill failed with code ${code}`);
        }
        if (!(await completionSettledWithin(execution.completion, forceKillGraceMs))) {
          throw new Error('Execution process tree did not exit after taskkill');
        }
        return;
      }

      try {
        killProcessGroup(execution.pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
        throw error;
      }
      if (await completionSettledWithin(execution.completion, terminationGraceMs)) return;

      try {
        killProcessGroup(execution.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
        throw error;
      }
      if (!(await completionSettledWithin(execution.completion, forceKillGraceMs))) {
        throw new Error('Execution process tree did not exit after SIGKILL');
      }
    },
  };
}

type EnvironmentPhase = 'ready' | 'starting' | 'running' | 'destroying';

interface EnvironmentState {
  workspacePath: string;
  phase: EnvironmentPhase;
  execution: SpawnedExecution | undefined;
  startSettled: Promise<void> | undefined;
  destroyPromise: Promise<boolean> | undefined;
}

export function createLocalExecutionEnvironmentProvider(
  options: LocalExecutionEnvironmentProviderOptions,
): ExecutionEnvironmentProvider {
  if (!Array.isArray(options.approvedRoots) || options.approvedRoots.length === 0) {
    throw new Error('Local execution provider requires at least one approved root');
  }

  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const runtime = options.runtime ?? createNodeProcessRuntime();
  const states = new WeakMap<PreparedExecutionEnvironment, EnvironmentState>();

  const requireState = (environment: PreparedExecutionEnvironment): EnvironmentState => {
    const state = states.get(environment);
    if (!state) throw new Error('Unknown or destroyed prepared environment');
    if (state.phase === 'destroying') throw new Error('Prepared environment is being destroyed');
    return state;
  };

  const performDestroy = async (
    environment: PreparedExecutionEnvironment,
    state: EnvironmentState,
  ): Promise<boolean> => {
    state.phase = 'destroying';
    try {
      if (state.startSettled) await state.startSettled;
      const execution = state.execution;
      if (execution) {
        await runtime.terminateTree(execution);
        await execution.completion.catch(() => undefined);
      }
    } catch (error) {
      if (states.get(environment) === state) {
        state.phase = state.execution ? 'running' : 'ready';
        state.destroyPromise = undefined;
      }
      throw error;
    }
    if (states.get(environment) === state) states.delete(environment);
    return true;
  };

  return {
    async prepare(input: PrepareExecutionEnvironmentInput): Promise<PreparedExecutionEnvironment> {
      const workspacePath = path.resolve(input.workspacePath);
      const contained = await Promise.all(
        options.approvedRoots.map((root) => isWithinRoot(workspacePath, root, fileSystem)),
      );
      if (!contained.some(Boolean)) {
        throw new Error(`Workspace is outside every approved root: ${input.workspacePath}`);
      }
      const authoritativePath = await realpathNearestExisting(workspacePath, fileSystem);
      const environment = Object.freeze({ workspacePath: authoritativePath });
      states.set(environment, {
        workspacePath: authoritativePath,
        phase: 'ready',
        execution: undefined,
        startSettled: undefined,
        destroyPromise: undefined,
      });
      return environment;
    },
    async execute(
      environment: PreparedExecutionEnvironment,
      command: StructuredExecutionCommand,
    ): Promise<ExecutionResult> {
      const state = requireState(environment);
      if (state.phase !== 'ready') {
        throw new Error('Prepared environment already has an active execution');
      }

      let settleStart!: () => void;
      state.phase = 'starting';
      state.startSettled = new Promise<void>((resolve) => { settleStart = resolve; });
      let execution: SpawnedExecution | undefined;
      try {
        const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
        const maxEventCount = options.maxEventCount ?? 1000;
        if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
          throw new Error('maxOutputBytes must be a positive safe integer');
        }
        if (!Number.isSafeInteger(maxEventCount) || maxEventCount < 0) {
          throw new Error('maxEventCount must be a non-negative safe integer');
        }
        const cwd = await resolveWorkspacePath(state.workspacePath, command.cwd, fileSystem);
        if (state.destroyPromise !== undefined || states.get(environment) !== state) {
          throw new Error('Prepared environment was destroyed before execution started');
        }
        execution = runtime.spawn({
          command: command.command,
          args: [...command.args],
          cwd,
          env: buildEnvironment(command.env, options),
          shell: false,
        });
        state.execution = execution;
        state.phase = 'running';
      } catch (error) {
        if (state.phase === 'starting') state.phase = 'ready';
        throw error;
      } finally {
        settleStart();
        state.startSettled = undefined;
      }

      const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
      const maxEventCount = options.maxEventCount ?? 1000;
      const events: ExecutionEvent[] = [];
      let eventsTruncated = false;
      let sequence = 0;
      const recordEvent = (stream: ExecutionEvent['stream'], data: string): void => {
        if (events.length >= maxEventCount) {
          eventsTruncated = true;
          return;
        }
        events.push({ sequence, stream, data });
        sequence += 1;
      };
      try {
        const [stdoutCapture, stderrCapture, completion] = await Promise.all([
          collectOutput(execution.stdout, 'stdout', maxOutputBytes, recordEvent),
          collectOutput(execution.stderr, 'stderr', maxOutputBytes, recordEvent),
          execution.completion,
        ]);
        return {
          ...completion,
          stdout: stdoutCapture.text,
          stderr: stderrCapture.text,
          stdoutTruncated: stdoutCapture.truncated,
          stderrTruncated: stderrCapture.truncated,
          events,
          eventsTruncated,
        };
      } finally {
        if (states.get(environment) === state && state.execution === execution) {
          state.execution = undefined;
          if (state.phase === 'running') state.phase = 'ready';
        }
      }
    },
    async cancel(environment: PreparedExecutionEnvironment): Promise<boolean> {
      const state = states.get(environment);
      if (!state || state.phase !== 'running' || !state.execution) return false;
      await runtime.terminateTree(state.execution);
      return true;
    },
    async destroy(environment: PreparedExecutionEnvironment): Promise<boolean> {
      const state = states.get(environment);
      if (!state) return false;
      if (state.destroyPromise) return state.destroyPromise;
      const destroyPromise = performDestroy(environment, state);
      state.destroyPromise = destroyPromise;
      return destroyPromise;
    },
    async readFile(environment: PreparedExecutionEnvironment, relativePath: string): Promise<Uint8Array> {
      const state = requireState(environment);
      const filePath = await resolveWorkspacePath(state.workspacePath, relativePath, fileSystem);
      if (states.get(environment) !== state || state.phase === 'destroying') {
        throw new Error('Prepared environment was destroyed during file access');
      }
      return fileSystem.readFile(filePath);
    },
    async writeFile(
      environment: PreparedExecutionEnvironment,
      relativePath: string,
      data: Uint8Array,
    ): Promise<void> {
      const state = requireState(environment);
      const filePath = await resolveWorkspacePath(state.workspacePath, relativePath, fileSystem);
      if (states.get(environment) !== state || state.phase === 'destroying') {
        throw new Error('Prepared environment was destroyed during file access');
      }
      await fileSystem.writeFile(filePath, data);
    },
    async collectArtifact(
      environment: PreparedExecutionEnvironment,
      relativePath: string,
    ): Promise<ExecutionArtifact> {
      const state = requireState(environment);
      const filePath = await resolveWorkspacePath(state.workspacePath, relativePath, fileSystem);
      if (states.get(environment) !== state || state.phase === 'destroying') {
        throw new Error('Prepared environment was destroyed during artifact collection');
      }
      const data = await fileSystem.readFile(filePath);
      return {
        relativePath: path.relative(state.workspacePath, filePath).split(path.sep).join('/'),
        data,
      };
    },
  };
}