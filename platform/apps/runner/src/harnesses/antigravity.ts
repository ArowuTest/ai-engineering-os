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

export interface AntigravityHarnessAdapterOptions {
  provider: ExecutionEnvironmentProvider;
  environment: PreparedExecutionEnvironment;
  command?: string;
}

const ANTIGRAVITY_CAPABILITIES: ProviderCapabilities = Object.freeze({
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
export function createAntigravityHarnessAdapter(
  options: AntigravityHarnessAdapterOptions,
): HarnessExecutionAdapter {
  const command = requireNonBlank(options.command ?? 'agy', 'Antigravity command');
  requireNonBlank(options.environment.workspacePath, 'workspacePath');

  return Object.freeze({
    id: 'antigravity-local',
    harnessId: 'antigravity',
    capabilities: ANTIGRAVITY_CAPABILITIES,
    async execute(request: HarnessExecutionRequest): Promise<HarnessExecutionResult> {
      const model = requireNonBlank(request.route.model, 'Antigravity model');
      const instruction = requireNonBlank(request.instruction, 'Antigravity instruction');
      const result = await options.provider.execute(options.environment, {
        command,
        args: [
          '--sandbox',
          '--model', model,
          '-p', instruction,
        ],
      });
      return normalizeResult(result);
    },
  });
}
