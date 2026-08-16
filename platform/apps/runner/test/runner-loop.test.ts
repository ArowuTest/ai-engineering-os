import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ExecutionEnvironmentProvider,
  PreparedExecutionEnvironment,
  StructuredExecutionCommand,
} from '@engineering-os/execution-environment';
import { signRunnerTaskEnvelope, type SignedRunnerTaskEnvelope } from '@engineering-os/runner-protocol';
import {
  createRunnerLoop,
  type ClaimedDispatch,
  type RunnerDispatchClient,
  type RunnerExecutionDriver,
  type RunnerWorkspacePolicy,
} from '../src/runner-loop.js';

const NOW = new Date('2026-08-16T08:00:00.000Z');
const cleanup: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'engineering-os-runner-loop-'));
  cleanup.push(root);
  const workspace = join(root, 'worktree');
  await mkdir(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function signedEnvelope(
  workspace: string,
  privateKey: KeyObject,
  overrides: {
    runnerId?: string;
    harnessId?: string;
    issuedAt?: Date;
    expiresAt?: Date;
  } = {},
): SignedRunnerTaskEnvelope {
  return signRunnerTaskEnvelope({
    dispatchId: 'dispatch-1',
    runnerId: overrides.runnerId ?? 'runner-1',
    requesterUserId: 'user-1',
    attempt: 1,
    idempotencyKey: 'idempotency-1',
    taskEnvelope: {
      id: 'envelope-1',
      organisationId: 'org-1',
      projectId: 'project-1',
      taskId: 'task-1',
      connectionId: 'connection-1',
      routeId: 'openrouter-qwen',
      harnessId: overrides.harnessId ?? 'codex',
      allowedOperations: ['read', 'write', 'test'],
      workspaceScope: workspace,
      issuedAt: overrides.issuedAt ?? new Date(NOW.getTime() - 1_000),
      expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 60_000),
      nonce: 'nonce-1',
    },
    payload: {
      objective: 'Implement the governed task without treating this text as shell syntax.',
      contextReferences: ['file:src/index.ts'],
      requiredCapabilities: ['headless', 'localWorkspace'],
    },
  }, privateKey);
}

function claim(envelope: SignedRunnerTaskEnvelope, overrides: Partial<ClaimedDispatch> = {}): ClaimedDispatch {
  return {
    dispatchId: envelope.dispatchId,
    attempt: envelope.attempt,
    envelope,
    replayed: false,
    ...overrides,
  };
}

function fakeClient(log: string[], nextClaim: ClaimedDispatch | null): RunnerDispatchClient {
  return {
    async authenticate() {
      log.push('authenticate');
      return { organisationId: 'org-1', runnerId: 'runner-1' };
    },
    async heartbeat(input) {
      log.push(`heartbeat:${input.seenAt.toISOString()}:${input.expiresAt.toISOString()}`);
    },
    async claim() {
      log.push('claim');
      return nextClaim;
    },
    async markRunning(dispatchId) {
      log.push(`running:${dispatchId}`);
    },
    async checkpoint(dispatchId, input) {
      log.push(`checkpoint:${dispatchId}:${input.ordinal}:${input.kind}`);
      expect(input.metadata).toEqual({});
    },
    async complete(dispatchId, input) {
      log.push(`complete:${dispatchId}`);
      expect(input.metadata).toEqual({ outcome: 'succeeded' });
    },
    async fail(dispatchId, input) {
      log.push(`fail:${dispatchId}:${String(input.metadata.reason)}`);
    },
    async cancelObserved(dispatchId) {
      log.push(`cancel:${dispatchId}`);
    },
  };
}

function fakeProvider(log: string[]): ExecutionEnvironmentProvider {
  const prepared: PreparedExecutionEnvironment = { workspacePath: 'prepared-workspace' };
  return {
    async prepare(input) {
      log.push(`prepare:${input.workspacePath}`);
      return prepared;
    },
    async execute(_environment, _command) {
      log.push('provider-execute');
      return {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        events: [],
        eventsTruncated: false,
      };
    },
    async cancel(environment) {
      log.push(`provider-cancel:${environment.workspacePath}`);
      return true;
    },
    async destroy(environment) {
      log.push(`destroy:${environment.workspacePath}`);
      return true;
    },
    async readFile() { return new Uint8Array(); },
    async writeFile() {},
    async collectArtifact(_environment, relativePath) {
      return { relativePath, data: new Uint8Array() };
    },
  };
}

function fakeWorkspacePolicy(log: string[], resolved: string): RunnerWorkspacePolicy {
  return {
    async resolve(scope) {
      log.push(`workspace:${scope}`);
      return resolved;
    },
  };
}

function successfulDriver(log: string[]): RunnerExecutionDriver {
  return {
    async execute(input) {
      log.push(`execute:${input.dispatch.dispatchId}:${input.environment.workspacePath}`);
      await input.checkpoint('driver_progress');
      return {
        status: 'succeeded',
        artifactReferences: ['artifact:test-report'],
        sessionReference: 'session:runner-1',
      };
    },
  };
}

function buildLoop(input: {
  log: string[];
  publicKey: KeyObject;
  nextClaim: ClaimedDispatch | null;
  workspace: string;
  client?: RunnerDispatchClient;
  provider?: ExecutionEnvironmentProvider;
  driver?: RunnerExecutionDriver;
  workspacePolicy?: RunnerWorkspacePolicy;
  pollIntervalMs?: number;
  failureBackoffMs?: number;
  maxCheckpoints?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  return createRunnerLoop({
    runnerId: 'runner-1',
    harnessId: 'codex',
    signingPublicKey: input.publicKey,
    heartbeatLeaseMs: 60_000,
    now: () => new Date(NOW.getTime()),
    client: input.client ?? fakeClient(input.log, input.nextClaim),
    provider: input.provider ?? fakeProvider(input.log),
    workspacePolicy: input.workspacePolicy ?? fakeWorkspacePolicy(input.log, input.workspace),
    executionDriver: input.driver ?? successfulDriver(input.log),
    pollIntervalMs: input.pollIntervalMs ?? 1_000,
    failureBackoffMs: input.failureBackoffMs ?? 5_000,
    maxCheckpoints: input.maxCheckpoints ?? 64,
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
  });
}

describe('outbound governed runner loop', () => {
  it('heartbeats before claiming and returns idle without preparing an environment when no work exists', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const loop = buildLoop({ log, publicKey, nextClaim: null, workspace });

    await expect(loop.runOnce()).resolves.toBe('idle');
    expect(log[0]).toBe('authenticate');
    expect(log[1]).toBe(`heartbeat:${NOW.toISOString()}:${new Date(NOW.getTime() + 60_000).toISOString()}`);
    expect(log[2]).toBe('claim');
    expect(log).toHaveLength(3);
  });

  it('authenticates the configured runner before heartbeat and rejects token/config identity mismatch', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const client = fakeClient(log, null);
    client.authenticate = async () => {
      log.push('authenticate-wrong-runner');
      return { organisationId: 'org-1', runnerId: 'runner-2' };
    };
    const loop = buildLoop({ log, publicKey, nextClaim: null, workspace, client });

    await expect(loop.runOnce()).rejects.toThrow(/runner identity/i);
    expect(log).toEqual(['authenticate-wrong-runner']);
  });
  it('does not claim when heartbeat fails', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const client = fakeClient(log, null);
    client.heartbeat = async () => { log.push('heartbeat-failed'); throw new Error('offline'); };
    const loop = buildLoop({ log, publicKey, nextClaim: null, workspace, client });

    await expect(loop.runOnce()).rejects.toThrow('offline');
    expect(log).toEqual(['authenticate', 'heartbeat-failed']);
  });

  it('runs a verified dispatch through workspace, environment, checkpoint, terminal and cleanup in order', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace });

    await expect(loop.runOnce()).resolves.toBe('completed');
    expect(log).toEqual([
      'authenticate',
      `heartbeat:${NOW.toISOString()}:${new Date(NOW.getTime() + 60_000).toISOString()}`,
      'claim',
      `workspace:${workspace}`,
      `prepare:${workspace}`,
      'running:dispatch-1',
      'execute:dispatch-1:prepared-workspace',
      'checkpoint:dispatch-1:1:driver_progress',
      'complete:dispatch-1',
      'destroy:prepared-workspace',
    ]);
  });

  it('refuses tampered, misassigned, expired, attempt-mismatched and wrong-harness claims before preparation', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const valid = signedEnvelope(workspace, privateKey);
    const cases: Array<[string, ClaimedDispatch]> = [
      ['tampered', claim({
        ...valid,
        payload: { ...valid.payload, objective: 'tampered objective' },
      })],
      ['wrong-runner', claim(signedEnvelope(workspace, privateKey, { runnerId: 'runner-2' }))],
      ['expired', claim(signedEnvelope(workspace, privateKey, {
        issuedAt: new Date(NOW.getTime() - 60_000),
        expiresAt: new Date(NOW.getTime() - 1),
      }))],
      ['attempt', claim(valid, { attempt: 2 })],
      ['harness', claim(signedEnvelope(workspace, privateKey, { harnessId: 'claude-code' }))],
      ['dispatch', claim(valid, { dispatchId: 'dispatch-2' })],
    ];

    for (const [label, nextClaim] of cases) {
      const log: string[] = [];
      const loop = buildLoop({ log, publicKey, nextClaim, workspace });
      await expect(loop.runOnce(), label).resolves.toBe('refused');
      expect(log, label).toContain(`cancel:${nextClaim.dispatchId}`);
      expect(log.some((entry) => entry.startsWith('workspace:')), label).toBe(false);
      expect(log.some((entry) => entry.startsWith('prepare:')), label).toBe(false);
      expect(log.some((entry) => entry.startsWith('running:')), label).toBe(false);
    }
  });

  it('cancels a claimed dispatch when workspace policy refuses the signed scope', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const workspacePolicy: RunnerWorkspacePolicy = {
      async resolve() { log.push('workspace-refused'); throw new Error('outside approved root'); },
    };
    const loop = buildLoop({
      log,
      publicKey,
      nextClaim: claim(envelope),
      workspace,
      workspacePolicy,
    });

    await expect(loop.runOnce()).resolves.toBe('refused');
    expect(log).toContain('workspace-refused');
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('prepare:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('running:'))).toBe(false);
  });

  it('cancels instead of marking running when environment preparation fails', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const provider = fakeProvider(log);
    provider.prepare = async () => {
      log.push('prepare-failed');
      throw new Error('provider unavailable');
    };
    const loop = buildLoop({
      log,
      publicKey,
      nextClaim: claim(envelope),
      workspace,
      provider,
    });

    await expect(loop.runOnce()).resolves.toBe('refused');
    expect(log).toContain('prepare-failed');
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('running:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('destroy:'))).toBe(false);
  });

  it('cancels the claimed dispatch and destroys the prepared environment when markRunning fails', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const client = fakeClient(log, claim(envelope));
    client.markRunning = async (dispatchId) => {
      log.push(`running-failed:${dispatchId}`);
      throw new Error('control-plane unavailable');
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, client });

    await expect(loop.runOnce()).resolves.toBe('refused');
    expect(log).toContain('running-failed:dispatch-1');
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('execute:'))).toBe(false);
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });
  it('records fixed secret-safe failure evidence and destroys the environment after execution failure', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const driver: RunnerExecutionDriver = {
      async execute() {
        log.push('execute-throws');
        throw new Error('Bearer must-not-be-forwarded');
      },
    };
    const client = fakeClient(log, claim(envelope));
    client.fail = async (dispatchId, input) => {
      log.push(`fail:${dispatchId}:${String(input.metadata.reason)}`);
      expect(input.metadata).toEqual({ reason: 'execution_failed' });
      expect(input.artifactReferences).toEqual([]);
      expect(JSON.stringify(input)).not.toContain('must-not-be-forwarded');
    };
    const loop = buildLoop({
      log,
      publicKey,
      nextClaim: claim(envelope),
      workspace,
      client,
      driver,
    });

    await expect(loop.runOnce()).resolves.toBe('failed');
    expect(log).toContain('running:dispatch-1');
    expect(log).toContain('execute-throws');
    expect(log).toContain('fail:dispatch-1:execution_failed');
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });

  it('records safe terminal failure evidence when the execution provider fails after running', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const provider = fakeProvider(log);
    provider.execute = async () => { throw new Error('provider secret must not escape'); };
    const driver: RunnerExecutionDriver = {
      async execute(input) {
        await input.provider.execute(input.environment, { command: 'fixed-test-command', args: [] });
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const client = fakeClient(log, claim(envelope));
    client.fail = async (dispatchId, input) => {
      log.push(`fail:${dispatchId}:${String(input.metadata.reason)}`);
      expect(input).toEqual({ metadata: { reason: 'execution_failed' }, artifactReferences: [] });
      expect(JSON.stringify(input)).not.toContain('provider secret');
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, client, provider, driver });

    await expect(loop.runOnce()).resolves.toBe('failed');
    expect(log).toContain('fail:dispatch-1:execution_failed');
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });
  it('maps an explicit driver failure to fixed terminal failure evidence', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const driver: RunnerExecutionDriver = {
      async execute() { return { status: 'failed', artifactReferences: [] }; },
    };
    const client = fakeClient(log, claim(envelope));
    client.fail = async (dispatchId, input) => {
      log.push(`fail:${dispatchId}:${String(input.metadata.reason)}`);
      expect(input.metadata).toEqual({ reason: 'execution_failed' });
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, client, driver });

    await expect(loop.runOnce()).resolves.toBe('failed');
    expect(log).toContain('fail:dispatch-1:execution_failed');
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });

  it('cancels only the active prepared environment and suppresses later complete/fail when cancellation wins', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let releaseExecution!: (value: { status: 'succeeded'; artifactReferences: string[] }) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const blocked = new Promise<{ status: 'succeeded'; artifactReferences: string[] }>((resolve) => {
      releaseExecution = resolve;
    });
    const driver: RunnerExecutionDriver = {
      async execute() { log.push('execute-blocked'); signalStarted(); return blocked; },
    };
    const provider = fakeProvider(log);
    provider.cancel = async (environment) => {
      log.push(`provider-cancel:${environment.workspacePath}`);
      releaseExecution({ status: 'succeeded', artifactReferences: [] });
      return true;
    };
    const loop = buildLoop({
      log,
      publicKey,
      nextClaim: claim(envelope),
      workspace,
      provider,
      driver,
    });

    const execution = loop.runOnce();
    await started;
    await expect(loop.cancelActive()).resolves.toBe(true);
    await expect(execution).resolves.toBe('cancelled');
    expect(log).toContain('provider-cancel:prepared-workspace');
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('complete:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('fail:'))).toBe(false);
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
    await expect(loop.cancelActive()).resolves.toBe(false);
  });

  it('orders cancelObserved after an already in-flight checkpoint lane is closed', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let releaseCheckpoint!: () => void;
    let releaseProviderCancel!: () => void;
    let signalCheckpointStarted!: () => void;
    let signalProviderCancelStarted!: () => void;
    const checkpointStarted = new Promise<void>((resolve) => { signalCheckpointStarted = resolve; });
    const providerCancelStarted = new Promise<void>((resolve) => { signalProviderCancelStarted = resolve; });
    const checkpointGate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    const providerCancelGate = new Promise<void>((resolve) => { releaseProviderCancel = resolve; });
    let checkpointCompleted = false;
    let cancelObservedCalled = false;
    const client = fakeClient(log, claim(envelope));
    client.checkpoint = async (dispatchId, input) => {
      log.push(`checkpoint-start:${dispatchId}:${input.ordinal}:${input.kind}`);
      signalCheckpointStarted();
      await checkpointGate;
      checkpointCompleted = true;
      log.push(`checkpoint-finish:${dispatchId}`);
    };
    client.cancelObserved = async (dispatchId) => {
      cancelObservedCalled = true;
      log.push(`cancel:${dispatchId}`);
    };
    const provider = fakeProvider(log);
    provider.cancel = async () => {
      log.push('provider-cancel:prepared-workspace');
      signalProviderCancelStarted();
      await providerCancelGate;
      return true;
    };
    const driver: RunnerExecutionDriver = {
      async execute(input) {
        await input.checkpoint('inflight_checkpoint');
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, client, provider, driver });

    const execution = loop.runOnce();
    await checkpointStarted;
    const cancellation = loop.cancelActive();
    await providerCancelStarted;
    releaseProviderCancel();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancelObservedCalled).toBe(false);
    expect(checkpointCompleted).toBe(false);
    releaseCheckpoint();
    await expect(cancellation).resolves.toBe(true);
    await expect(execution).resolves.toBe('cancelled');
    expect(log.indexOf('checkpoint-finish:dispatch-1')).toBeLessThan(log.indexOf('cancel:dispatch-1'));
  });
  it('suppresses checkpoints emitted after cancellation has reserved the active execution', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let releaseCheckpoint!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const checkpointGate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    const driver: RunnerExecutionDriver = {
      async execute(input) {
        signalStarted();
        await checkpointGate;
        await input.checkpoint('late_checkpoint');
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const provider = fakeProvider(log);
    provider.cancel = async () => {
      log.push('provider-cancel:prepared-workspace');
      releaseCheckpoint();
      await Promise.resolve();
      return true;
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, provider, driver });

    const execution = loop.runOnce();
    await started;
    await expect(loop.cancelActive()).resolves.toBe(true);
    await expect(execution).resolves.toBe('cancelled');
    expect(log.some((entry) => entry.includes('late_checkpoint'))).toBe(false);
  });
  it('serializes polling so a second runOnce cannot claim while a dispatch is active', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let release!: (value: { status: 'succeeded'; artifactReferences: string[] }) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const driver: RunnerExecutionDriver = {
      execute: async () => {
        signalStarted();
        return new Promise((resolve) => { release = resolve; });
      },
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, driver });

    const first = loop.runOnce();
    await started;
    await expect(loop.runOnce()).resolves.toBe('busy');
    expect(log.filter((entry) => entry === 'claim')).toHaveLength(1);
    release({ status: 'succeeded', artifactReferences: [] });
    await expect(first).resolves.toBe('completed');
  });

  it('validates heartbeat lease configuration and exposes no inbound-listener API', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    expect(() => createRunnerLoop({
      runnerId: 'runner-1',
      harnessId: 'codex',
      signingPublicKey: publicKey,
      heartbeatLeaseMs: 300_001,
      now: () => new Date(NOW.getTime()),
      client: fakeClient(log, null),
      provider: fakeProvider(log),
      workspacePolicy: fakeWorkspacePolicy(log, workspace),
      executionDriver: successfulDriver(log),
    })).toThrow(/heartbeat lease/i);

    const loop = buildLoop({ log, publicKey, nextClaim: null, workspace });
    expect(Object.keys(loop).sort()).toEqual(['cancelActive', 'run', 'runOnce']);
    expect(Object.prototype.hasOwnProperty.call(loop, 'listen')).toBe(false);
  });

  it('runs as a long-lived outbound poller and waits the normal interval after an idle cycle', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const controller = new AbortController();
    const delays: number[] = [];
    const loop = buildLoop({
      log, publicKey, nextClaim: null, workspace,
      sleep: async (milliseconds) => { delays.push(milliseconds); controller.abort(); },
    });

    await expect(loop.run(controller.signal)).resolves.toBeUndefined();
    expect(log.filter((entry) => entry === 'claim')).toHaveLength(1);
    expect(delays).toEqual([1_000]);
  });

  it('backs off after outbound network failure without attempting a claim', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const controller = new AbortController();
    const delays: number[] = [];
    const client = fakeClient(log, null);
    client.heartbeat = async () => { log.push('heartbeat-network-failure'); throw new Error('network'); };
    const loop = buildLoop({
      log, publicKey, nextClaim: null, workspace, client,
      sleep: async (milliseconds) => { delays.push(milliseconds); controller.abort(); },
    });

    await expect(loop.run(controller.signal)).resolves.toBeUndefined();
    expect(log).toEqual(['authenticate', 'heartbeat-network-failure']);
    expect(delays).toEqual([5_000]);
  });
  it('does not start a newly claimed execution after the long-lived runner receives shutdown', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const controller = new AbortController();
    const workspacePolicy: RunnerWorkspacePolicy = {
      async resolve(scope) {
        log.push(`workspace:${scope}`);
        controller.abort();
        return workspace;
      },
    };
    const loop = buildLoop({
      log, publicKey, nextClaim: claim(envelope), workspace, workspacePolicy,
    });

    await expect(loop.run(controller.signal)).resolves.toBeUndefined();
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('prepare:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('running:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('execute:'))).toBe(false);
  });
  it('uses an execution driver rather than interpolating signed objective text into provider commands', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const provider = fakeProvider(log);
    provider.execute = async (_environment, command: StructuredExecutionCommand) => {
      throw new Error(`unexpected raw provider execution: ${command.command}`);
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, provider });

    await expect(loop.runOnce()).resolves.toBe('completed');
    expect(log).not.toContain('provider-execute');
  });
});


describe('runner council hardening', () => {
  it('actively refuses a structurally malformed claimed envelope without throwing', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const log: string[] = [];
    const malformed = {
      dispatchId: 'dispatch-1',
      attempt: 1,
      envelope: { schemaVersion: 'runner-task-envelope/v1' } as unknown as SignedRunnerTaskEnvelope,
      replayed: false,
    } satisfies ClaimedDispatch;
    const loop = buildLoop({ log, publicKey, nextClaim: malformed, workspace });

    await expect(loop.runOnce()).resolves.toBe('refused');
    expect(log).toContain('cancel:dispatch-1');
    expect(log.some((entry) => entry.startsWith('prepare:'))).toBe(false);
  });

  it('falls back to the driver terminal outcome when provider cancellation itself fails', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let releaseDriver!: () => void;
    let releaseCancel!: () => void;
    let signalStarted!: () => void;
    let signalCancelStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const cancelStarted = new Promise<void>((resolve) => { signalCancelStarted = resolve; });
    const driverGate = new Promise<void>((resolve) => { releaseDriver = resolve; });
    const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
    const driver: RunnerExecutionDriver = {
      async execute() {
        signalStarted();
        await driverGate;
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const provider = fakeProvider(log);
    provider.cancel = async () => {
      log.push('provider-cancel-start');
      signalCancelStarted();
      await cancelGate;
      throw new Error('provider cancellation failed');
    };
    const loop = buildLoop({ log, publicKey, nextClaim: claim(envelope), workspace, provider, driver });

    const execution = loop.runOnce();
    await started;
    const cancellation = loop.cancelActive();
    await cancelStarted;
    releaseDriver();
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseCancel();

    await expect(cancellation).resolves.toBe(false);
    await expect(execution).resolves.toBe('completed');
    expect(log).toContain('complete:dispatch-1');
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });

  it('keeps local cancellation irreversible and retries cancelObserved until acknowledged', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    let releaseExecution!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve; });
    const driver: RunnerExecutionDriver = {
      async execute(input) {
        signalStarted();
        await executionGate;
        await input.checkpoint('after_local_cancel');
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const provider = fakeProvider(log);
    provider.cancel = async () => {
      log.push('provider-cancel:prepared-workspace');
      releaseExecution();
      return true;
    };
    const client = fakeClient(log, claim(envelope));
    let cancelAttempts = 0;
    client.cancelObserved = async (dispatchId) => {
      cancelAttempts += 1;
      log.push(`cancel-attempt:${dispatchId}:${cancelAttempts}`);
      if (cancelAttempts === 1) throw new Error('transient control-plane failure');
    };
    const retryDelays: number[] = [];
    const loop = buildLoop({
      log, publicKey, nextClaim: claim(envelope), workspace, provider, driver, client,
      sleep: async (milliseconds) => { retryDelays.push(milliseconds); },
    });

    const execution = loop.runOnce();
    await started;
    await expect(loop.cancelActive()).resolves.toBe(true);
    await expect(execution).resolves.toBe('cancelled');
    expect(cancelAttempts).toBe(2);
    expect(retryDelays).toEqual([5_000]);
    expect(log.some((entry) => entry.includes('after_local_cancel'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('complete:'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('fail:'))).toBe(false);
  });

  it('bounds checkpoint emission per dispatch and fails safely when the limit is exceeded', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const workspace = await makeWorkspace();
    const envelope = signedEnvelope(workspace, privateKey);
    const log: string[] = [];
    const driver: RunnerExecutionDriver = {
      async execute(input) {
        await input.checkpoint('first');
        await input.checkpoint('second');
        await input.checkpoint('third');
        return { status: 'succeeded', artifactReferences: [] };
      },
    };
    const loop = buildLoop({
      log, publicKey, nextClaim: claim(envelope), workspace, driver, maxCheckpoints: 2,
    });

    await expect(loop.runOnce()).resolves.toBe('failed');
    expect(log.filter((entry) => entry.startsWith('checkpoint:'))).toEqual([
      'checkpoint:dispatch-1:1:first',
      'checkpoint:dispatch-1:2:second',
    ]);
    expect(log).toContain('fail:dispatch-1:execution_failed');
    expect(log.at(-1)).toBe('destroy:prepared-workspace');
  });
});
