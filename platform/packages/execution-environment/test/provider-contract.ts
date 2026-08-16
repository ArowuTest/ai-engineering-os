import assert from 'node:assert/strict';
import type {
  ExecutionEnvironmentProvider,
  ExecutionResult,
  PreparedExecutionEnvironment,
  PrepareExecutionEnvironmentInput,
  StructuredExecutionCommand,
} from '../src/index.js';

export interface ExecutionEnvironmentProviderContractFixture {
  provider: ExecutionEnvironmentProvider;
  prepareInput: PrepareExecutionEnvironmentInput;
  executeCommand: StructuredExecutionCommand;
  expectedExitCode: number | null;
  expectedStdout: string;
  artifactRelativePath: string;
  artifactData: Uint8Array;
  startCancellableExecution?: (
    provider: ExecutionEnvironmentProvider,
    environment: PreparedExecutionEnvironment,
  ) => Promise<{ result: Promise<ExecutionResult> }>;
}

export async function verifyExecutionEnvironmentProviderContract(
  fixture: ExecutionEnvironmentProviderContractFixture,
): Promise<void> {
  const environment = await fixture.provider.prepare(fixture.prepareInput);
  let destroyed = false;
  try {
    const result = await fixture.provider.execute(environment, fixture.executeCommand);
    assert.equal(result.exitCode, fixture.expectedExitCode);
    assert.equal(result.stdout, fixture.expectedStdout);

    await fixture.provider.writeFile(environment, fixture.artifactRelativePath, fixture.artifactData);
    const read = await fixture.provider.readFile(environment, fixture.artifactRelativePath);
    assert.deepEqual(Buffer.from(read), Buffer.from(fixture.artifactData));

    const artifact = await fixture.provider.collectArtifact(environment, fixture.artifactRelativePath);
    assert.equal(artifact.relativePath, fixture.artifactRelativePath.replaceAll('\\', '/'));
    assert.deepEqual(Buffer.from(artifact.data), Buffer.from(fixture.artifactData));

    if (fixture.startCancellableExecution) {
      const cancellable = await fixture.startCancellableExecution(fixture.provider, environment);
      assert.equal(await fixture.provider.cancel(environment), true);
      await cancellable.result;
      assert.equal(await fixture.provider.cancel(environment), false);
    }

    assert.equal(await fixture.provider.destroy(environment), true);
    destroyed = true;
    assert.equal(await fixture.provider.destroy(environment), false);
  } finally {
    if (!destroyed) await fixture.provider.destroy(environment).catch(() => false);
  }
}
