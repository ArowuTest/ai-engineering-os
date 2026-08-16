import { describe, expect, it } from 'vitest';
import type { RunnerTaskEnvelope } from '@engineering-os/domain';
import type {
  ExecutionEnvironmentProvider,
  ExecutionResult,
  PreparedExecutionEnvironment,
  StructuredExecutionCommand,
} from '@engineering-os/execution-environment';
import {
  NoEligibleHarnessAdapterError,
  selectHarnessExecutionAdapter,
  type HarnessExecutionRequest,
  type ModelRoute,
  type ProviderCapabilities,
} from '@engineering-os/model-gateway';
import { createAntigravityHarnessAdapter } from '../../src/harnesses/antigravity.js';

const NOW = new Date('2026-08-16T10:55:00.000Z');
const ENVIRONMENT: PreparedExecutionEnvironment = {
  workspacePath: 'C:/approved/project-worktree',
};
function capabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    chat: true,
    tools: true,
    vision: false,
    files: false,
    mcp: false,
    localWorkspace: true,
    headless: true,
    structuredOutput: false,
    ...overrides,
  };
}

function route(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    id: 'antigravity-route',
    provider: 'google',
    model: 'gemini-3.1-pro',
    executionMode: 'subscription',
    costType: 'included_subscription',
    available: true,
    priority: 10,
    capabilities: capabilities(),
    ...overrides,
  };
}
function envelope(overrides: Partial<RunnerTaskEnvelope> = {}): RunnerTaskEnvelope {
  return {
    id: 'envelope-1',
    organisationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    connectionId: 'connection-1',
    routeId: 'antigravity-route',
    harnessId: 'antigravity',
    allowedOperations: ['read', 'write', 'execute'],
    workspaceScope: 'project-worktree',
    issuedAt: new Date(NOW.getTime() - 1_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    nonce: 'nonce-1',
    ...overrides,
  };
}

function request(overrides: Partial<HarnessExecutionRequest> = {}): HarnessExecutionRequest {
  return {
    envelope: envelope(),
    route: route(),
    requiredCapabilities: ['chat', 'tools', 'localWorkspace', 'headless'],
    operations: ['read', 'write', 'execute'],
    workspaceScope: 'project-worktree',
    instruction: 'Inspect the repository and implement the approved task.',
    ...overrides,
  };
}
function executionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: 'Task completed safely.\n',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    events: [],
    eventsTruncated: false,
    ...overrides,
  };
}

function fakeProvider(result: ExecutionResult = executionResult()) {
  const commands: StructuredExecutionCommand[] = [];
  const provider: ExecutionEnvironmentProvider = {
    async prepare() { return ENVIRONMENT; },
    async execute(environment, command) {
      expect(environment).toBe(ENVIRONMENT);
      commands.push(command);
      return result;
    },
    async cancel() { return true; },
    async destroy() { return true; },
    async readFile() { return new Uint8Array(); },
    async writeFile() {},
    async collectArtifact(_environment, relativePath) {
      return { relativePath, data: new Uint8Array() };
    },
  };
  return { provider, commands };
}
describe('Antigravity runner harness adapter', () => {
  it('uses non-interactive print mode with governed model and sandbox restrictions', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createAntigravityHarnessAdapter({ provider, environment: ENVIRONMENT });

    const result = await adapter.execute(request());

    expect(commands).toEqual([{
      command: 'agy',
      args: [
        '--sandbox', '--model', 'gemini-3.1-pro',
        '-p', 'Inspect the repository and implement the approved task.',
      ],
    }]);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('Task completed safely.');
    expect(result.metadata).toEqual({ exitCode: 0, outputTruncated: false });
  });

  it('never enables the dangerous permission-bypass flag', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createAntigravityHarnessAdapter({ provider, environment: ENVIRONMENT });
    await adapter.execute(request());
    expect(commands[0]?.args).not.toContain('--dangerously-skip-permissions');
    expect(commands[0]?.args).toContain('--sandbox');
  });

  it('keeps hostile task text as one argv value and does not export auth state', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createAntigravityHarnessAdapter({ provider, environment: ENVIRONMENT });
    const instruction = 'Fix tests && rm -rf / ; echo %GOOGLE_TOKEN%';
    const unsafe = {
      ...request({ instruction }),
      accessToken: 'forbidden',
      googleCredentials: 'forbidden',
      providerSession: 'forbidden',
    } as HarnessExecutionRequest & Record<string, unknown>;

    await adapter.execute(unsafe);

    expect(commands[0]?.args.at(-1)).toBe(instruction);
    expect(commands[0]?.env).toBeUndefined();
    expect(commands[0]?.cwd).toBeUndefined();
    expect(JSON.stringify(commands[0])).not.toContain('forbidden');
  });

  it('fails closed on nonzero exit, cancellation signal, blank success, or truncated evidence', async () => {
    for (const result of [
      executionResult({ exitCode: 1, stderr: 'failed' }),
      executionResult({ exitCode: null, signal: 'SIGTERM' }),
      executionResult({ stdout: '   \n' }),
      executionResult({ stderrTruncated: true }),
      executionResult({ eventsTruncated: true }),
    ]) {
      const { provider } = fakeProvider(result);
      const adapter = createAntigravityHarnessAdapter({ provider, environment: ENVIRONMENT });
      await expect(adapter.execute(request())).resolves.toMatchObject({ status: 'failed' });
    }
  });

  it('exposes only capabilities proven by the non-interactive sandbox adapter', () => {
    const { provider } = fakeProvider();
    const adapter = createAntigravityHarnessAdapter({ provider, environment: ENVIRONMENT });

    expect(adapter.capabilities).toEqual(capabilities());
    expect(selectHarnessExecutionAdapter([adapter], request(), NOW)).toBe(adapter);
    expect(() => selectHarnessExecutionAdapter(
      [adapter],
      request({ requiredCapabilities: ['chat', 'mcp'] }),
      NOW,
    )).toThrow(NoEligibleHarnessAdapterError);
  });

  it('supports an explicit runner-local executable path without changing argv or auth policy', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createAntigravityHarnessAdapter({
      provider,
      environment: ENVIRONMENT,
      command: 'C:/tools/agy.exe',
    });
    await adapter.execute(request());
    expect(commands[0]?.command).toBe('C:/tools/agy.exe');
    expect(commands[0]?.args[0]).toBe('--sandbox');
    expect(commands[0]?.env).toBeUndefined();
  });
});
