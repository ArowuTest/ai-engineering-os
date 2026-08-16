import type {
  ExecutionEnvironmentProvider,
  PreparedExecutionEnvironment,
} from '@engineering-os/execution-environment';
import type {
  HarnessExecutionAdapter,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  ProviderCapabilities,
} from '@engineering-os/model-gateway';

export interface ClaudeCodeHarnessAdapterOptions {
  provider: ExecutionEnvironmentProvider;
  environment: PreparedExecutionEnvironment;
  command?: string;
}

const CLAUDE_CODE_CAPABILITIES: ProviderCapabilities = Object.freeze({
  chat: true,
  tools: true,
  vision: false,
  files: false,
  mcp: false,
  localWorkspace: true,
  headless: true,
  structuredOutput: false,
});
function requireNonBlank(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be non-blank`);
  }
  return value;
}

function toolsFor(request: HarnessExecutionRequest): string {
  const tools = ['Read', 'Grep', 'Glob'];
  if (request.operations.includes('write')) tools.push('Edit', 'Write');
  if (request.operations.includes('execute')) tools.push('Bash');
  return tools.join(',');
}

function normalizeResult(
  result: Awaited<ReturnType<ExecutionEnvironmentProvider['execute']>>,
): HarnessExecutionResult {
  const output = result.stdout.trim();
  const outputTruncated = result.stdoutTruncated
    || result.stderrTruncated
    || result.eventsTruncated;
  const completed = result.exitCode === 0
    && result.signal === null
    && !outputTruncated
    && output.length > 0;
  return {
    status: completed ? 'completed' : 'failed',
    events: [],
    ...(output.length === 0 ? {} : { output }),
    metadata: {
      exitCode: result.exitCode ?? -1,
      outputTruncated,
      ...(result.signal === null ? {} : { processSignal: result.signal }),
    },
  };
}

export function createClaudeCodeHarnessAdapter(
  options: ClaudeCodeHarnessAdapterOptions,
): HarnessExecutionAdapter {
  const command = requireNonBlank(options.command ?? 'claude', 'Claude Code command');
  requireNonBlank(options.environment.workspacePath, 'workspacePath');

  return Object.freeze({
    id: 'claude-code-local',
    harnessId: 'claude-code',
    capabilities: CLAUDE_CODE_CAPABILITIES,
    async execute(request: HarnessExecutionRequest): Promise<HarnessExecutionResult> {
      const model = requireNonBlank(request.route.model, 'Claude Code model');
      const instruction = requireNonBlank(request.instruction, 'Claude Code instruction');      const result = await options.provider.execute(options.environment, {
        command,
        args: [
          '-p', instruction,
          '--output-format', 'text',
          '--model', model,
          '--permission-mode', 'dontAsk',
          '--no-session-persistence',
          '--no-chrome',
          '--tools', toolsFor(request),
        ],
      });
      return normalizeResult(result);
    },
  });
}