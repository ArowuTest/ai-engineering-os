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

export interface CodexHarnessAdapterOptions {
  provider: ExecutionEnvironmentProvider;
  environment: PreparedExecutionEnvironment;
  command?: string;
}

const CODEX_CAPABILITIES: ProviderCapabilities = Object.freeze({
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

function requireFullEngineeringOperations(request: HarnessExecutionRequest): void {
  for (const operation of request.operations) {
    if (!request.envelope.allowedOperations.includes(operation)) {
      throw new Error('Requested operation exceeds the authoritative envelope grant');
    }
  }
  const operations = new Set(request.operations);
  if (
    operations.size !== 3
    || !operations.has('read')
    || !operations.has('write')
    || !operations.has('execute')
  ) {
    throw new Error('Codex operation bundle is not safely enforceable');
  }
}

function normalizeResult(result: Awaited<ReturnType<ExecutionEnvironmentProvider['execute']>>): HarnessExecutionResult {
  const output = result.stdout.trim();
  const outputTruncated = result.stdoutTruncated || result.stderrTruncated || result.eventsTruncated;
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
export function createCodexHarnessAdapter(
  options: CodexHarnessAdapterOptions,
): HarnessExecutionAdapter {
  const command = requireNonBlank(options.command ?? 'codex', 'Codex command');
  const workspacePath = requireNonBlank(options.environment.workspacePath, 'workspacePath');

  return Object.freeze({
    id: 'codex-local',
    harnessId: 'codex',
    capabilities: CODEX_CAPABILITIES,
    async execute(request: HarnessExecutionRequest): Promise<HarnessExecutionResult> {
      const model = requireNonBlank(request.route.model, 'Codex model');
      const instruction = requireNonBlank(request.instruction, 'Codex instruction');
      requireFullEngineeringOperations(request);
      const result = await options.provider.execute(options.environment, {
        command,
        args: [
          'exec',
          '--sandbox', 'workspace-write',
          '--color', 'never',
          '-m', model,
          '-C', workspacePath,
          '-',
        ],
        stdin: instruction,
      });
      return normalizeResult(result);
    },
  });
}
