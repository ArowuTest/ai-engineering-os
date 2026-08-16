export interface PrepareExecutionEnvironmentInput {
  workspacePath: string;
}

export interface PreparedExecutionEnvironment {
  readonly workspacePath: string;
}

export interface StructuredExecutionCommand {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string | Uint8Array;
}

export interface SpawnedExecution {
  pid?: number;
  stdout: AsyncIterable<string | Uint8Array>;
  stderr: AsyncIterable<string | Uint8Array>;
  completion: Promise<{ exitCode: number | null; signal: string | null }>;
}

export interface ProcessSpawnInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell: false;
  stdin?: Uint8Array;
}
export interface ExecutionEvent {
  sequence: number;
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface ExecutionArtifact {
  relativePath: string;
  data: Uint8Array;
}
export interface LocalFileSystem {
  lstat(target: string): Promise<unknown>;
  realpath(target: string): Promise<string>;
  readFile(target: string): Promise<Uint8Array>;
  writeFile(target: string, data: Uint8Array): Promise<void>;
}
export interface LocalProcessRuntime {
  spawn(input: ProcessSpawnInput): SpawnedExecution;
  terminateTree(execution: SpawnedExecution): Promise<void>;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  events: ExecutionEvent[];
  eventsTruncated: boolean;
}

export interface ExecutionEnvironmentProvider {
  prepare(input: PrepareExecutionEnvironmentInput): Promise<PreparedExecutionEnvironment>;
  execute(
    environment: PreparedExecutionEnvironment,
    command: StructuredExecutionCommand,
  ): Promise<ExecutionResult>;
  cancel(environment: PreparedExecutionEnvironment): Promise<boolean>;
  destroy(environment: PreparedExecutionEnvironment): Promise<boolean>;
  readFile(environment: PreparedExecutionEnvironment, relativePath: string): Promise<Uint8Array>;
  writeFile(
    environment: PreparedExecutionEnvironment,
    relativePath: string,
    data: Uint8Array,
  ): Promise<void>;
  collectArtifact(
    environment: PreparedExecutionEnvironment,
    relativePath: string,
  ): Promise<ExecutionArtifact>;
}
export interface LocalExecutionEnvironmentProviderOptions {
  approvedRoots: string[];
  allowedEnvironmentKeys?: string[];
  baseEnvironment?: Record<string, string>;
  maxOutputBytes?: number;
  maxInputBytes?: number;
  maxEventCount?: number;
  fileSystem?: LocalFileSystem;
  runtime?: LocalProcessRuntime;
}
