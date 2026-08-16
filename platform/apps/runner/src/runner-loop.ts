import type { KeyObject } from 'node:crypto';
import type {
  ExecutionEnvironmentProvider,
  PreparedExecutionEnvironment,
} from '@engineering-os/execution-environment';
import {
  verifyRunnerTaskEnvelope,
  type RunnerTaskDispatch,
  type SignedRunnerTaskEnvelope,
} from '@engineering-os/runner-protocol';
import type { RunnerWorkspacePolicy } from './workspace-policy.js';

export type { RunnerWorkspacePolicy } from './workspace-policy.js';

export interface ClaimedDispatch {
  dispatchId: string;
  attempt: number;
  envelope: SignedRunnerTaskEnvelope;
  replayed: boolean;
}

export interface RunnerCheckpointInput {
  ordinal: number;
  kind: string;
  metadata: Record<string, unknown>;
}

export interface RunnerTerminalInput {
  metadata: Record<string, unknown>;
  artifactReferences: string[];
  sessionReference?: string;
}

export interface RunnerDispatchClient {
  authenticate(): Promise<{ organisationId: string; runnerId: string }>;
  heartbeat(input: { seenAt: Date; expiresAt: Date }): Promise<void>;
  claim(): Promise<ClaimedDispatch | null>;
  markRunning(dispatchId: string): Promise<void>;
  checkpoint(dispatchId: string, input: RunnerCheckpointInput): Promise<void>;
  complete(dispatchId: string, input: RunnerTerminalInput): Promise<void>;
  fail(dispatchId: string, input: RunnerTerminalInput): Promise<void>;
  cancelObserved(dispatchId: string): Promise<void>;
}

export interface RunnerExecutionOutcome {
  status: 'succeeded' | 'failed';
  artifactReferences?: string[];
  sessionReference?: string;
}

export interface RunnerExecutionInput {
  dispatch: RunnerTaskDispatch;
  environment: PreparedExecutionEnvironment;
  provider: ExecutionEnvironmentProvider;
  checkpoint(kind: string): Promise<void>;
}

export interface RunnerExecutionDriver {
  execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutcome>;
}

export type RunnerCycleResult = 'idle' | 'busy' | 'refused' | 'completed' | 'failed' | 'cancelled';

export interface RunnerLoopOptions {
  runnerId: string;
  harnessId: string;
  signingPublicKey: KeyObject;
  client: RunnerDispatchClient;
  provider: ExecutionEnvironmentProvider;
  workspacePolicy: RunnerWorkspacePolicy;
  executionDriver: RunnerExecutionDriver;
  now?: () => Date;
  heartbeatLeaseMs?: number;
  pollIntervalMs?: number;
  failureBackoffMs?: number;
  maxCheckpoints?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface RunnerLoop {
  runOnce(): Promise<RunnerCycleResult>;
  run(signal?: AbortSignal): Promise<void>;
  cancelActive(): Promise<boolean>;
}

type ActivePhase = 'running' | 'cancelling' | 'cancelled' | 'terminal';

interface ActiveDispatch {
  dispatchId: string;
  environment: PreparedExecutionEnvironment;
  phase: ActivePhase;
  cancelPromise?: Promise<boolean>;
  inFlightCheckpoints: Set<Promise<void>>;
}

const CHECKPOINT_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ARTIFACT_REFERENCE_PATTERN = /^artifact:[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SESSION_REFERENCE_PATTERN = /^session:[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function requireDuration(value: number, field: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}ms`);
  }
  return value;
}
function requireCount(value: number, field: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function requireNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('runner clock must return a valid Date');
  }
  return new Date(value.getTime());
}

function requireCheckpointKind(kind: string): string {
  if (typeof kind !== 'string' || !CHECKPOINT_KIND_PATTERN.test(kind)) {
    throw new Error('checkpoint kind must be a stable identifier');
  }
  return kind;
}

function requireReference(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${field} is not a safe runner evidence reference`);
  }
  return value;
}

function normalizeExecutionOutcome(value: unknown): RunnerExecutionOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('execution driver returned an invalid outcome');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(['status', 'artifactReferences', 'sessionReference']);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('execution driver returned unsupported evidence fields');
  }
  if (record.status !== 'succeeded' && record.status !== 'failed') {
    throw new Error('execution driver returned an invalid status');
  }
  const referencesValue = record.artifactReferences ?? [];
  if (!Array.isArray(referencesValue) || referencesValue.length > 32) {
    throw new Error('execution driver returned invalid artifact references');
  }
  const artifactReferences = referencesValue.map((reference, index) =>
    requireReference(reference, ARTIFACT_REFERENCE_PATTERN, `artifactReferences[${index}]`));
  if (new Set(artifactReferences).size !== artifactReferences.length) {
    throw new Error('execution driver returned duplicate artifact references');
  }

  const outcome: RunnerExecutionOutcome = {
    status: record.status,
    artifactReferences,
  };
  if (record.sessionReference !== undefined) {
    outcome.sessionReference = requireReference(
      record.sessionReference,
      SESSION_REFERENCE_PATTERN,
      'sessionReference',
    );
  }
  return outcome;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createRunnerLoop(options: RunnerLoopOptions): RunnerLoop {
  const heartbeatLeaseMs = requireDuration(options.heartbeatLeaseMs ?? 60_000, 'heartbeat lease', 300_000);
  const pollIntervalMs = requireDuration(options.pollIntervalMs ?? 1_000, 'poll interval', 60_000);
  const failureBackoffMs = requireDuration(options.failureBackoffMs ?? 5_000, 'failure backoff', 300_000);
  const maxCheckpoints = requireCount(options.maxCheckpoints ?? 64, 'max checkpoints', 1024);
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  if (typeof sleep !== 'function') throw new Error('sleep must be a function');

  let polling = false;
  let active: ActiveDispatch | undefined;

  async function refuseClaim(claim: ClaimedDispatch): Promise<'refused'> {
    await options.client.cancelObserved(claim.dispatchId);
    return 'refused';
  }

  async function executeCycle(signal?: AbortSignal): Promise<RunnerCycleResult> {
    if (polling) return 'busy';
    polling = true;
    try {
      const identity = await options.client.authenticate();
      if (identity.runnerId !== options.runnerId) {
        throw new Error('runner identity does not match configured runner');
      }
      if (signal?.aborted) return 'idle';

      const heartbeatAt = requireNow(now);
      await options.client.heartbeat({
        seenAt: heartbeatAt,
        expiresAt: new Date(heartbeatAt.getTime() + heartbeatLeaseMs),
      });
      if (signal?.aborted) return 'idle';

      const claimed = await options.client.claim();
      if (!claimed) return 'idle';
      if (signal?.aborted) {
        await options.client.cancelObserved(claimed.dispatchId);
        return 'cancelled';
      }

      const verificationAt = requireNow(now);
      const verification = verifyRunnerTaskEnvelope(
        claimed.envelope,
        options.signingPublicKey,
        {
          now: verificationAt,
          expectedRunnerId: options.runnerId,
          expectedDispatchId: claimed.dispatchId,
        },
      );
      if (
        !verification.ok
        || claimed.attempt !== verification.value.attempt
        || verification.value.taskEnvelope.harnessId !== options.harnessId
      ) {
        return refuseClaim(claimed);
      }

      let workspacePath: string;
      try {
        workspacePath = await options.workspacePolicy.resolve(
          verification.value.taskEnvelope.workspaceScope,
        );
      } catch {
        return refuseClaim(claimed);
      }
      if (signal?.aborted) {
        await options.client.cancelObserved(claimed.dispatchId);
        return 'cancelled';
      }

      let environment: PreparedExecutionEnvironment;
      try {
        environment = await options.provider.prepare({ workspacePath });
      } catch {
        return refuseClaim(claimed);
      }

      try {
        if (signal?.aborted) {
          await options.client.cancelObserved(claimed.dispatchId);
          return 'cancelled';
        }
        try {
          await options.client.markRunning(claimed.dispatchId);
        } catch {
          await options.client.cancelObserved(claimed.dispatchId);
          return 'refused';
        }
        if (signal?.aborted) {
          await options.client.cancelObserved(claimed.dispatchId);
          return 'cancelled';
        }
        const current: ActiveDispatch = {
          dispatchId: claimed.dispatchId,
          environment,
          phase: 'running',
          inFlightCheckpoints: new Set<Promise<void>>(),
        };
        active = current;
        let ordinal = 0;
        let executionError: unknown;
        let outcome: RunnerExecutionOutcome | undefined;
        try {
          const rawOutcome = await options.executionDriver.execute({
            dispatch: verification.value,
            environment,
            provider: options.provider,
            checkpoint: async (kind: string) => {
              if (current.phase !== 'running') return;
              const normalizedKind = requireCheckpointKind(kind);
              if (ordinal >= maxCheckpoints) {
                throw new Error('checkpoint limit exceeded');
              }
              ordinal += 1;
              const checkpoint = options.client.checkpoint(claimed.dispatchId, {
                ordinal,
                kind: normalizedKind,
                metadata: {},
              });
              current.inFlightCheckpoints.add(checkpoint);
              try {
                await checkpoint;
              } finally {
                current.inFlightCheckpoints.delete(checkpoint);
              }
            },
          });
          outcome = normalizeExecutionOutcome(rawOutcome);
        } catch (error) {
          executionError = error;
        }

        if ((current.phase === 'cancelling' || current.phase === 'cancelled') && current.cancelPromise) {
          const cancelled = await current.cancelPromise;
          if (cancelled) return 'cancelled';
        }

        current.phase = 'terminal';
        if (executionError !== undefined || outcome?.status !== 'succeeded') {
          await options.client.fail(claimed.dispatchId, {
            metadata: { reason: 'execution_failed' },
            artifactReferences: executionError === undefined
              ? (outcome?.artifactReferences ?? [])
              : [],
            ...(executionError === undefined && outcome?.sessionReference !== undefined
              ? { sessionReference: outcome.sessionReference }
              : {}),
          });
          return 'failed';
        }

        await options.client.complete(claimed.dispatchId, {
          metadata: { outcome: 'succeeded' },
          artifactReferences: outcome.artifactReferences ?? [],
          ...(outcome.sessionReference === undefined
            ? {}
            : { sessionReference: outcome.sessionReference }),
        });
        return 'completed';
      } finally {
        if (active?.dispatchId === claimed.dispatchId) active = undefined;
        await options.provider.destroy(environment);
      }
    } finally {
      polling = false;
    }
  }

  function runOnce(): Promise<RunnerCycleResult> {
    return executeCycle();
  }

  async function cancelActive(): Promise<boolean> {
    const current = active;
    if (!current) return false;
    if (
      (current.phase === 'cancelling' || current.phase === 'cancelled')
      && current.cancelPromise
    ) {
      return current.cancelPromise;
    }
    if (current.phase !== 'running') return false;

    current.phase = 'cancelling';
    const cancellation = (async (): Promise<boolean> => {
      let cancelled: boolean;
      try {
        cancelled = await options.provider.cancel(current.environment);
      } catch {
        current.phase = 'running';
        return false;
      }
      if (!cancelled) {
        current.phase = 'running';
        return false;
      }

      current.phase = 'cancelled';
      await Promise.allSettled([...current.inFlightCheckpoints]);
      for (;;) {
        try {
          await options.client.cancelObserved(current.dispatchId);
          return true;
        } catch {
          await sleep(failureBackoffMs);
        }
      }
    })();
    current.cancelPromise = cancellation;
    return cancellation;
  }

  async function run(signal?: AbortSignal): Promise<void> {
    let abortCancellationError: unknown;
    const onAbort = (): void => {
      void cancelActive().catch((error: unknown) => {
        abortCancellationError = error;
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        try {
          await executeCycle(signal);
          if (signal?.aborted) break;
          await sleep(pollIntervalMs);
        } catch {
          if (signal?.aborted) break;
          await sleep(failureBackoffMs);
        }
      }
      if (abortCancellationError !== undefined) throw abortCancellationError;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return { runOnce, run, cancelActive };
}
