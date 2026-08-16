import { randomUUID } from 'node:crypto';
import {
  AIDispatchRepository,
  AIRunnerRepository,
  MembershipRepository,
  type AIDispatchRecord,
  type AIRunnerPersistenceRecord,
} from '@engineering-os/database';
import type { SignedRunnerTaskEnvelope } from '@engineering-os/runner-protocol';
import type { AIRunnerService } from './ai-runner-service.js';

export type AIDispatchServiceErrorCode =
  | 'unauthorized'
  | 'runner_unavailable'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'policy_blocked'
  | 'invalid_request';

export class AIDispatchServiceError extends Error {
  constructor(readonly code: AIDispatchServiceErrorCode) {
    super(code);
    this.name = 'AIDispatchServiceError';
  }
}

const DISPATCH_CONFLICT_MESSAGES = new Set([
  'claimed ai dispatch not found for running transition',
  'active ai dispatch not found for checkpoint',
  'active ai dispatch not found for cancellation',
  'ai dispatch checkpoint replay conflicts with stored evidence',
  'ai dispatch terminal transition is invalid or conflicts with existing terminal state',
  'ai dispatch terminal replay conflicts with stored evidence',
]);

function throwDispatchRepositoryError(error: unknown): never {
  if (error instanceof TypeError) throw new AIDispatchServiceError('invalid_request');
  if (error instanceof Error && DISPATCH_CONFLICT_MESSAGES.has(error.message)) {
    throw new AIDispatchServiceError('conflict');
  }
  throw error;
}

export interface AIDispatchServiceDependencies {
  runnerService: Pick<AIRunnerService, 'authenticateRunner'>;
  aiRunners: AIRunnerRepository;
  memberships: MembershipRepository;
  dispatches: AIDispatchRepository;
}

export interface ClaimedRunnerDispatch {
  dispatchId: string;
  attempt: number;
  envelope: SignedRunnerTaskEnvelope;
  replayed: boolean;
}

function requireDate(value: Date | undefined, field: string): Date {
  const resolved = value ?? new Date();
  if (!(resolved instanceof Date) || !Number.isFinite(resolved.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return new Date(resolved.getTime());
}

function runnerCapabilitySatisfied(runner: AIRunnerPersistenceRecord, capability: string): boolean {
  if (capability === 'localWorkspace') return runner.capabilities.includes('workspace');
  if (capability === 'workspace') return runner.capabilities.includes('workspace');
  if (capability === 'headless') return runner.capabilities.includes('headless');
  if (capability === 'cancellation') return runner.capabilities.includes('cancellation');
  if (capability === 'checkpoints') return runner.capabilities.includes('checkpoints');
  if (capability === 'persistentExecution') {
    return runner.persistentSupported && runner.capabilities.includes('persistent');
  }
  return false;
}


export class AIDispatchService {
  constructor(private readonly dependencies: AIDispatchServiceDependencies) {}

  private async requireEligibleRunner(
    credential: string,
    at: Date,
  ): Promise<AIRunnerPersistenceRecord> {
    const identity = await this.dependencies.runnerService.authenticateRunner(credential, at);
    if (!identity) throw new AIDispatchServiceError('unauthorized');
    const runner = await this.dependencies.aiRunners.getRunner(identity.organisationId, identity.runnerId);
    if (!runner) throw new AIDispatchServiceError('unauthorized');
    if (
      runner.status !== 'online' ||
      runner.trustState !== 'trusted' ||
      runner.revokedAt !== undefined ||
      runner.heartbeatExpiresAt === undefined ||
      runner.heartbeatExpiresAt.getTime() <= at.getTime()
    ) {
      throw new AIDispatchServiceError('runner_unavailable');
    }
    if (runner.ownership === 'personal') {
      if (!runner.ownerUserId) throw new AIDispatchServiceError('runner_unavailable');
      const membership = await this.dependencies.memberships.getOrganisation(
        runner.organisationId,
        runner.ownerUserId,
      );
      if (!membership || membership.status !== 'active') {
        throw new AIDispatchServiceError('unauthorized');
      }
    }
    return runner;
  }

  private async compatibleAssignment(
    runner: AIRunnerPersistenceRecord,
    dispatch: AIDispatchRecord,
  ): Promise<boolean> {
    if (dispatch.runnerId !== runner.id) return false;
    if (dispatch.harnessId !== runner.harnessId) return false;
    const bindings = await this.dependencies.aiRunners.listActiveBindingsForRunner(
      runner.organisationId,
      runner.id,
    );
    if (!bindings.some((binding) => binding.connectionId === dispatch.connectionId)) return false;
    return dispatch.signedEnvelope.payload.requiredCapabilities.every((capability) =>
      runnerCapabilitySatisfied(runner, capability),
    );
  }

  private async requireAssigned(
    credential: string,
    dispatchId: string,
    at: Date,
  ): Promise<{ runner: AIRunnerPersistenceRecord; dispatch: AIDispatchRecord }> {
    const runner = await this.requireEligibleRunner(credential, at);
    const dispatch = await this.dependencies.dispatches.get(runner.organisationId, dispatchId);
    if (!dispatch) throw new AIDispatchServiceError('not_found');
    if (dispatch.runnerId !== runner.id) throw new AIDispatchServiceError('forbidden');
    if (['queued', 'claimed', 'running'].includes(dispatch.state) && new Date(dispatch.signedEnvelope.taskEnvelope.expiresAt).getTime() <= at.getTime()) {
      await this.dependencies.dispatches.expireDue(runner.organisationId, runner.id, at);
      throw new AIDispatchServiceError('conflict');
    }
    if (!(await this.compatibleAssignment(runner, dispatch))) {
      if (['queued', 'claimed', 'running'].includes(dispatch.state)) {
        await this.dependencies.dispatches.cancel(
          runner.organisationId,
          dispatch.id,
          runner.id,
          at,
        );
      }
      throw new AIDispatchServiceError('policy_blocked');
    }
    return { runner, dispatch };
  }

  async claimNext(input: { credential: string; now?: Date }): Promise<ClaimedRunnerDispatch | null> {
    const now = requireDate(input.now, 'now');
    const runner = await this.requireEligibleRunner(input.credential, now);
    const claimed = await this.dependencies.dispatches.claimNext(
      runner.organisationId,
      runner.id,
      now,
    );
    if (!claimed) return null;
    if (!(await this.compatibleAssignment(runner, claimed.dispatch))) {
      await this.dependencies.dispatches.cancel(
        runner.organisationId,
        claimed.dispatch.id,
        runner.id,
        now,
      );
      throw new AIDispatchServiceError('policy_blocked');
    }
    return {
      dispatchId: claimed.dispatch.id,
      attempt: claimed.dispatch.attempt,
      envelope: claimed.dispatch.signedEnvelope,
      replayed: claimed.replayed,
    };
  }

  async markRunning(input: {
    credential: string;
    dispatchId: string;
    now?: Date;
  }): Promise<void> {
    const now = requireDate(input.now, 'now');
    const { runner, dispatch } = await this.requireAssigned(input.credential, input.dispatchId, now);
    if (dispatch.state === 'running') return;
    if (dispatch.state !== 'claimed') throw new AIDispatchServiceError('conflict');
    try {
      await this.dependencies.dispatches.markRunning(
        runner.organisationId,
        dispatch.id,
        runner.id,
        now,
      );
    } catch (error) {
      throwDispatchRepositoryError(error);
    }
  }

  async addCheckpoint(input: {
    credential: string;
    dispatchId: string;
    ordinal: number;
    kind: string;
    metadata: Record<string, unknown>;
    now?: Date;
  }): Promise<void> {
    const now = requireDate(input.now, 'now');
    const { runner, dispatch } = await this.requireAssigned(input.credential, input.dispatchId, now);
    if (!['claimed', 'running'].includes(dispatch.state)) {
      throw new AIDispatchServiceError('conflict');
    }

    try {
      await this.dependencies.dispatches.addCheckpoint(runner.organisationId, dispatch.id, {
        id: randomUUID(),
        attempt: dispatch.attempt,
        ordinal: input.ordinal,
        kind: input.kind,
        metadata: input.metadata,
        createdAt: now,
      });
    } catch (error) {
      throwDispatchRepositoryError(error);
    }
  }

  private async finish(input: {
    credential: string;
    dispatchId: string;
    metadata: Record<string, unknown>;
    artifactReferences: string[];
    sessionReference?: string;
    now?: Date;
  }, outcome: 'succeeded' | 'failed'): Promise<void> {
    const now = requireDate(input.now, 'now');
    const { runner, dispatch } = await this.requireAssigned(input.credential, input.dispatchId, now);
    const evidenceInput = {
      id: randomUUID(),
      metadata: input.metadata,
      artifactReferences: input.artifactReferences,
      ...(input.sessionReference === undefined ? {} : { sessionReference: input.sessionReference }),
    };
    if (dispatch.state !== 'running' && dispatch.state !== outcome) {
      throw new AIDispatchServiceError('conflict');
    }

    try {
      if (outcome === 'succeeded') {
        await this.dependencies.dispatches.complete(
          runner.organisationId,
          dispatch.id,
          runner.id,
          now,
          evidenceInput,
        );
      } else {
        await this.dependencies.dispatches.fail(
          runner.organisationId,
          dispatch.id,
          runner.id,
          now,
          evidenceInput,
        );
      }
    } catch (error) {
      throwDispatchRepositoryError(error);
    }
  }

  async complete(input: {
    credential: string;
    dispatchId: string;
    metadata: Record<string, unknown>;
    artifactReferences: string[];
    sessionReference?: string;
    now?: Date;
  }): Promise<void> {
    await this.finish(input, 'succeeded');
  }

  async fail(input: {
    credential: string;
    dispatchId: string;
    metadata: Record<string, unknown>;
    artifactReferences: string[];
    sessionReference?: string;
    now?: Date;
  }): Promise<void> {
    await this.finish(input, 'failed');
  }

  async cancelObserved(input: {
    credential: string;
    dispatchId: string;
    now?: Date;
  }): Promise<void> {
    const now = requireDate(input.now, 'now');
    const { runner, dispatch } = await this.requireAssigned(input.credential, input.dispatchId, now);
    if (dispatch.state === 'cancelled') return;
    if (!['queued', 'claimed', 'running'].includes(dispatch.state)) {
      throw new AIDispatchServiceError('conflict');
    }
    try {
      await this.dependencies.dispatches.cancel(
        runner.organisationId,
        dispatch.id,
        runner.id,
        now,
      );
    } catch (error) {
      throwDispatchRepositoryError(error);
    }
  }
}
