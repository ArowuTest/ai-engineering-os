import { randomUUID } from 'node:crypto';
import { createAIRunnerRecord, createAuditEvent, generateOpaqueToken, hashOpaqueToken, type AIRunnerCapability, type AIRunnerOwnership, type AIRunnerTrustState } from '@engineering-os/domain';
import type { AIRunnerRepository, AuditRepository, DatabaseUnitOfWork, MembershipRepository } from '@engineering-os/database';

export interface AIRunnerServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  aiRunners: AIRunnerRepository;
  memberships: MembershipRepository;
  audit: AuditRepository;
}

async function requireRunnerAdministrator(aiRunners: AIRunnerRepository, memberships: MembershipRepository, organisationId: string, runnerId: string, actorUserId: string) {
  const membership = await memberships.getOrganisationForUpdate(organisationId, actorUserId);
  if (!membership || membership.status !== 'active') throw new Error('forbidden');
  const runner = await aiRunners.getRunnerForUpdate(organisationId, runnerId);
  if (!runner || runner.status === 'revoked' || runner.trustState === 'revoked') {
    throw new Error('runner_not_found');
  }
  if (runner.ownership === 'personal' && runner.ownerUserId !== actorUserId) {
    throw new Error('forbidden');
  }
  if (runner.ownership === 'organisation' && !['owner', 'admin'].includes(membership.role)) {
    throw new Error('forbidden');
  }
  return runner;
}
export class AIRunnerService {
  constructor(private readonly dependencies: AIRunnerServiceDependencies) {}

  async registerRunner(input: {
    organisationId: string;
    actorUserId: string;
    ownership: AIRunnerOwnership;
    ownerUserId?: string;
    harnessId: string;
    persistentSupported: boolean;
    capabilities: readonly AIRunnerCapability[];
    now?: Date;
  }): Promise<{ runnerId: string; credential: string }> {
    const now = input.now ?? new Date();
    const credential = generateOpaqueToken();
    const credentialHash = hashOpaqueToken(credential);
    const credentialId = randomUUID();

    const runner = createAIRunnerRecord({
      organisationId: input.organisationId,
      ownership: input.ownership,
      ...(input.ownerUserId === undefined ? {} : { ownerUserId: input.ownerUserId }),
      harnessId: input.harnessId,
      persistentSupported: input.persistentSupported,
      capabilities: [...input.capabilities],
      createdBy: input.actorUserId,
      createdAt: now
    });

    await this.dependencies.unitOfWork.run(async ({ memberships, aiRunners, audit }) => {
      const membership = await memberships.getOrganisationForUpdate(input.organisationId, input.actorUserId);
      if (!membership || membership.status !== 'active') {
        throw new Error('forbidden');
      }
      if (input.ownership === 'personal' && input.ownerUserId !== input.actorUserId) {
        throw new Error('forbidden');
      }
      if (input.ownership === 'organisation' && !['owner', 'admin'].includes(membership.role)) {
        throw new Error('forbidden');
      }
      await aiRunners.createRunner(runner);
      await aiRunners.createCredentialHash({
        id: credentialId,
        organisationId: input.organisationId,
        runnerId: runner.id,
        credentialHash,
        createdAt: now
      });
      await audit.append(
        createAuditEvent({
          organisationId: input.organisationId,
          eventType: 'ai.runner.registered',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'ai_runner',
          subjectId: runner.id,
          metadata: {
            ownership: runner.ownership,
            ownerUserId: runner.ownerUserId,
            harnessId: runner.harnessId,
            persistentSupported: runner.persistentSupported,
            capabilities: runner.capabilities
          }
        })
      );
    });

    return { runnerId: runner.id, credential };
  }

  async listRunners(input: { organisationId: string; actorUserId: string }) {
    const membership = await this.dependencies.memberships.getOrganisation(input.organisationId, input.actorUserId);
    if (!membership || membership.status !== 'active') throw new Error('forbidden');
    const [personal, organisation] = await Promise.all([
      this.dependencies.aiRunners.listForUser(input.organisationId, input.actorUserId),
      this.dependencies.aiRunners.listOrganisationRunners(input.organisationId)
    ]);
    return [...personal, ...organisation].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  }
  async disableRunner(input: { organisationId: string; actorUserId: string; runnerId: string; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, aiRunners, audit }) => {
      const runner = await requireRunnerAdministrator(aiRunners, memberships, input.organisationId, input.runnerId, input.actorUserId);
      await aiRunners.setRunnerStatus(input.organisationId, input.runnerId, 'disabled', now);
      await audit.append(
        createAuditEvent({
          organisationId: input.organisationId,
          eventType: 'ai.runner.disabled',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'ai_runner',
          subjectId: input.runnerId,
          metadata: { previousStatus: runner.status }
        })
      );
    });
  }

  async revokeRunner(input: { organisationId: string; actorUserId: string; runnerId: string; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, aiRunners, audit }) => {
      await requireRunnerAdministrator(aiRunners, memberships, input.organisationId, input.runnerId, input.actorUserId);
      await aiRunners.revokeActiveCredentialsForRunner(input.organisationId, input.runnerId, now);
      const bindings = await aiRunners.listActiveBindingsForRunner(input.organisationId, input.runnerId);
      for (const binding of bindings) {
        await aiRunners.revokeConnectionBinding(input.organisationId, binding.id, now);
      }
      await aiRunners.setRunnerStatus(input.organisationId, input.runnerId, 'revoked', now);
      await audit.append(
        createAuditEvent({
          organisationId: input.organisationId,
          eventType: 'ai.runner.revoked',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'ai_runner',
          subjectId: input.runnerId
        })
      );
    });
  }
  async setRunnerTrust(input: { organisationId: string; actorUserId: string; runnerId: string; trustState: AIRunnerTrustState; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, aiRunners, audit }) => {
      const membership = await memberships.getOrganisationForUpdate(input.organisationId, input.actorUserId);
      if (!membership || membership.status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
        throw new Error('forbidden');
      }
      const runner = await aiRunners.getRunnerForUpdate(input.organisationId, input.runnerId);
      if (!runner || runner.status === 'revoked' || runner.trustState === 'revoked') {
        throw new Error('runner_not_found');
      }
      await aiRunners.setRunnerTrustState(input.organisationId, input.runnerId, input.trustState, now);
      if (input.trustState === 'revoked') {
        await aiRunners.revokeActiveCredentialsForRunner(input.organisationId, input.runnerId, now);
        const bindings = await aiRunners.listActiveBindingsForRunner(input.organisationId, input.runnerId);
        for (const binding of bindings) {
          await aiRunners.revokeConnectionBinding(input.organisationId, binding.id, now);
        }
        await aiRunners.setRunnerStatus(input.organisationId, input.runnerId, 'revoked', now);
      }
      await audit.append(
        createAuditEvent({
          organisationId: input.organisationId,
          eventType: 'ai.runner.trust_changed',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'ai_runner',
          subjectId: input.runnerId,
          metadata: { from: runner.trustState, to: input.trustState }
        })
      );
    });
  }
  async rotateRunnerCredential(input: { organisationId: string; actorUserId: string; runnerId: string; now?: Date }): Promise<{ credential: string }> {
    const now = input.now ?? new Date();
    const credential = generateOpaqueToken();
    const credentialHash = hashOpaqueToken(credential);
    const credentialId = randomUUID();

    await this.dependencies.unitOfWork.run(async ({ memberships, aiRunners, audit }) => {
      await requireRunnerAdministrator(aiRunners, memberships, input.organisationId, input.runnerId, input.actorUserId);
      await aiRunners.revokeActiveCredentialsForRunner(input.organisationId, input.runnerId, now);
      await aiRunners.createCredentialHash({
        id: credentialId,
        organisationId: input.organisationId,
        runnerId: input.runnerId,
        credentialHash,
        createdAt: now
      });
      await audit.append(
        createAuditEvent({
          organisationId: input.organisationId,
          eventType: 'ai.runner.credential_rotated',
          actorType: 'user',
          actorId: input.actorUserId,
          subjectType: 'ai_runner',
          subjectId: input.runnerId
        })
      );
    });

    return { credential };
  }
  async recordHeartbeat(input: { credential: string; seenAt: Date; expiresAt: Date; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    const maxWindowMs = 5 * 60_000;
    const lifetimeMs = input.expiresAt.getTime() - input.seenAt.getTime();
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > maxWindowMs) {
      throw new Error('invalid_heartbeat_expiry');
    }
    if (
      !Number.isFinite(now.getTime()) ||
      Math.abs(input.seenAt.getTime() - now.getTime()) > maxWindowMs ||
      input.expiresAt.getTime() <= now.getTime() ||
      input.expiresAt.getTime() - now.getTime() > maxWindowMs
    ) {
      throw new Error('heartbeat timestamp outside allowed clock skew');
    }
    const credentialHash = hashOpaqueToken(input.credential);
    await this.dependencies.unitOfWork.run(async ({ aiRunners, memberships }) => {
      const credential = await aiRunners.getActiveCredentialByHash(credentialHash, now);
      if (!credential) throw new Error('unauthorized');
      const snapshot = await aiRunners.getRunner(credential.organisationId, credential.runnerId);
      if (!snapshot) throw new Error('unauthorized');
      if (snapshot.ownership === 'personal') {
        const membership = await memberships.getOrganisationForUpdate(credential.organisationId, snapshot.ownerUserId!);
        if (!membership || membership.status !== 'active') throw new Error('unauthorized');
      }
      const locked = await aiRunners.getRunnerForUpdate(credential.organisationId, credential.runnerId);
      if (!locked || locked.status === 'disabled' || locked.status === 'revoked' || locked.trustState === 'revoked') {
        throw new Error('unauthorized');
      }
      const currentCredential = await aiRunners.getActiveCredentialByHash(credentialHash, now);
      if (!currentCredential) throw new Error('unauthorized');
      await aiRunners.recordHeartbeat(credential.organisationId, credential.runnerId, input.seenAt, input.expiresAt);
    });
  }
  async authenticateRunner(credential: string, at = new Date()): Promise<{ organisationId: string; runnerId: string } | null> {
    const record = await this.dependencies.aiRunners.getActiveCredentialByHash(hashOpaqueToken(credential), at);
    if (!record) return null;
    return { organisationId: record.organisationId, runnerId: record.runnerId };
  }
}
