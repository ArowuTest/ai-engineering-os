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
import { createClaudeCodeHarnessAdapter } from '../../src/harnesses/claude-code.js';

const NOW = new Date('2026-08-16T11:05:00.000Z');
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
    id: 'claude-code-route',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
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
    routeId: 'claude-code-route',
    harnessId: 'claude-code',
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
}function executionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
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
}describe('Claude Code runner harness adapter', () => {
  it('uses non-interactive local subscription mode with governed model and scoped tools', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createClaudeCodeHarnessAdapter({ provider, environment: ENVIRONMENT });

    const result = await adapter.execute(request());

    expect(commands).toEqual([{
      command: 'claude',
      args: [
        '-p', 'Inspect the repository and implement the approved task.',
        '--output-format', 'text', '--model', 'claude-sonnet-4-6',
        '--permission-mode', 'dontAsk', '--no-session-persistence', '--no-chrome',
        '--tools', 'Read,Grep,Glob,Edit,Write,Bash',
      ],
    }]);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('Task completed safely.');
    expect(result.metadata).toEqual({ exitCode: 0, outputTruncated: false });
  });

  it('removes write and shell tools when the governed operation set is read-only', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createClaudeCodeHarnessAdapter({ provider, environment: ENVIRONMENT });
    await adapter.execute(request({
      envelope: envelope({ allowedOperations: ['read'] }),
      operations: ['read'],
    }));
    expect(commands[0]?.args.slice(-2)).toEqual(['--tools', 'Read,Grep,Glob']);
  });
  it('keeps hostile task text as one argv value and never exports local auth state', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createClaudeCodeHarnessAdapter({ provider, environment: ENVIRONMENT });
    const instruction = 'Fix tests && del C:\\* ; echo %ANTHROPIC_TOKEN%';
    const unsafe = {
      ...request({ instruction }),
      apiKey: 'forbidden',
      accessToken: 'forbidden',
      providerSession: 'forbidden',
    } as HarnessExecutionRequest & Record<string, unknown>;

    await adapter.execute(unsafe);

    expect(commands[0]?.args[1]).toBe(instruction);
    expect(commands[0]?.env).toBeUndefined();
    expect(commands[0]?.cwd).toBeUndefined();
    expect(commands[0]?.args).not.toContain('--dangerously-skip-permissions');
    expect(commands[0]?.args).not.toContain('--bare');
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
      const adapter = createClaudeCodeHarnessAdapter({ provider, environment: ENVIRONMENT });
      await expect(adapter.execute(request())).resolves.toMatchObject({ status: 'failed' });
    }
  });
  it('exposes only capabilities proven by the headless local CLI adapter', () => {
    const { provider } = fakeProvider();
    const adapter = createClaudeCodeHarnessAdapter({ provider, environment: ENVIRONMENT });

    expect(adapter.capabilities).toEqual(capabilities());
    expect(selectHarnessExecutionAdapter([adapter], request(), NOW)).toBe(adapter);
    expect(() => selectHarnessExecutionAdapter(
      [adapter],
      request({ requiredCapabilities: ['chat', 'vision'] }),
      NOW,
    )).toThrow(NoEligibleHarnessAdapterError);
  });

  it('supports an explicit runner-local executable path without changing auth or permission policy', async () => {
    const { provider, commands } = fakeProvider();
    const adapter = createClaudeCodeHarnessAdapter({
      provider,
      environment: ENVIRONMENT,
      command: 'C:/Users/sanus/.local/bin/claude.exe',
    });
    await adapter.execute(request());
    expect(commands[0]?.command).toBe('C:/Users/sanus/.local/bin/claude.exe');
    expect(commands[0]?.env).toBeUndefined();
    expect(commands[0]?.args).toContain('dontAsk');
  });
});