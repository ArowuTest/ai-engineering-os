import { randomUUID } from 'node:crypto';
import {
  CAPABILITY_GOVERNANCE_STATES,
  DomainValidationError,
  requireStableIdentifier,
  createAuditEvent,
  createPlatformAuditEvent,
  createCapabilityEligibilityPolicy,
  createCapabilityRecord,
  createCapabilityReleasePolicy,
  evaluateCapabilityEligibility,
  type CapabilityEligibilityPolicyDecision,
  type CapabilityEligibilityScope,
  type CapabilityKind,
  type CapabilityRecord,
  type CapabilityReleaseScope,
  type CapabilityGovernanceState,
  type CapabilityMaturity,
  type CapabilityExecutionVerification,
} from '@engineering-os/domain';
import type {
  CapabilityEstateRepository,
  DatabaseUnitOfWork,
  MembershipRepository,
  PlatformMembershipRepository,
  ProjectRepository,
} from '@engineering-os/database';
import type { ModelGateway, ModelRoute } from '@engineering-os/model-gateway';

export type CapabilityEstateServiceErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'conflict';

export class CapabilityEstateServiceError extends Error {
  constructor(readonly code: CapabilityEstateServiceErrorCode, message: string = code) {
    super(message);
    this.name = 'CapabilityEstateServiceError';
  }
}
export interface ProjectModelRouteCatalogue {
  listAvailableForProject(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<readonly ModelRoute[]>;
}

export interface CapabilityEstateServiceDependencies {
  unitOfWork: DatabaseUnitOfWork;
  capabilities: CapabilityEstateRepository;
  memberships: MembershipRepository;
  platformMemberships: PlatformMembershipRepository;
  projects: ProjectRepository;
  modelGateway: ModelGateway;
  connectionModelRoutes?: ProjectModelRouteCatalogue;
  eccCapabilityDiscovery?: () => Promise<CatalogueCapabilityInput[]>;
}

export interface CatalogueCapabilityInput {
  id: string;
  kind: CapabilityKind;
  source: string;
  sourceRef: string;
  displayName: string;
  maturity: CapabilityMaturity;
  governanceState: CapabilityGovernanceState;
  executionVerification: CapabilityExecutionVerification;
}

export interface EligibilityCapabilityInput {
  organisationId: string;
  actorUserId: string;
  capabilityId: string;
  scope: CapabilityEligibilityScope;
  decision: CapabilityEligibilityPolicyDecision;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  now?: Date;
}
export interface ReleaseCapabilityInput {
  organisationId?: string;
  actorUserId: string;
  capabilityId: string;
  scope: CapabilityReleaseScope;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  now?: Date;
}

async function requirePlatformAdministrator(
  platformMemberships: PlatformMembershipRepository,
  actorUserId: string,
): Promise<void> {
  const membership = await platformMemberships.get(actorUserId);
  if (!membership || membership.status !== 'active' || membership.role !== 'admin') {
    throw new CapabilityEstateServiceError('forbidden');
  }
}
async function requireAdministrator(
  memberships: MembershipRepository,
  organisationId: string,
  actorUserId: string,
): Promise<void> {
  const membership = await memberships.getOrganisation(organisationId, actorUserId);
  if (!membership || membership.status !== 'active'
    || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new CapabilityEstateServiceError('forbidden');
  }
}
async function requirePolicyAdministrator(input: {
  memberships: MembershipRepository;
  platformMemberships: PlatformMembershipRepository;
  organisationId: string;
  actorUserId: string;
  scope: CapabilityReleaseScope | CapabilityEligibilityScope;
  projectId?: string | undefined;
}): Promise<void> {
  const platformMembership = await input.platformMemberships.get(input.actorUserId);
  if (platformMembership?.status === 'active' && platformMembership.role === 'admin') return;

  const organisationMembership = await input.memberships.getOrganisation(
    input.organisationId, input.actorUserId,
  );
  if (organisationMembership?.status === 'active'
    && (organisationMembership.role === 'owner' || organisationMembership.role === 'admin')) return;

  const projectScoped = input.scope === 'project'
    || (input.scope === 'project_role' && input.projectId !== undefined);
  if (projectScoped && input.projectId) {
    const projectMembership = await input.memberships.getProject(
      input.organisationId, input.projectId, input.actorUserId,
    );
    if (projectMembership?.status === 'active' && projectMembership.role === 'product_owner') return;
  }
  throw new CapabilityEstateServiceError('forbidden');
}
export class CapabilityEstateService {
  constructor(private readonly dependencies: CapabilityEstateServiceDependencies) {}

  async catalogueCapability(input: {
    actorUserId: string;
    capability: CatalogueCapabilityInput;
    now?: Date;
  }): Promise<CapabilityRecord> {
    const now = input.now ?? new Date();
    const record = createCapabilityRecord({
      ...input.capability,
      createdBy: input.actorUserId,
      createdAt: now,
    });
    await this.dependencies.unitOfWork.run(async ({ platformMemberships, capabilityEstate, audit }) => {
      await requirePlatformAdministrator(platformMemberships, input.actorUserId);
      await capabilityEstate.createCapability(record);
      await audit.append(createPlatformAuditEvent({
        eventType: 'capability.catalogued', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'capability', subjectId: record.id,
        metadata: {
          kind: record.kind,
          source: record.source,
          governanceState: record.governanceState,
          executionVerification: record.executionVerification,
        },
      }));
    });
    return record;
  }

  async listInventory(input: { actorUserId: string; kind?: CapabilityKind }) {
    await requirePlatformAdministrator(this.dependencies.platformMemberships, input.actorUserId);
    return this.dependencies.capabilities.listCapabilities(input.kind);
  }
  async getAdministrationSnapshot(input: { actorUserId: string }) {
    await requirePlatformAdministrator(this.dependencies.platformMemberships, input.actorUserId);
    const [capabilities, releases, eligibilityPolicies] = await Promise.all([
      this.dependencies.capabilities.listCapabilities(),
      this.dependencies.capabilities.listAllReleases(),
      this.dependencies.capabilities.listAllEligibilityPolicies(),
    ]);
    return { capabilities, releases, eligibilityPolicies };
  }
  async listRawModelRoutes(input: { actorUserId: string }) {
    await requirePlatformAdministrator(this.dependencies.platformMemberships, input.actorUserId);
    return this.dependencies.modelGateway.listRoutes();
  }

  async refreshEccInventory(input: {
    actorUserId: string;
    now?: Date;
  }): Promise<{ discovered: number; reconciled: number }> {
    await requirePlatformAdministrator(this.dependencies.platformMemberships, input.actorUserId);
    const discover = this.dependencies.eccCapabilityDiscovery;
    if (!discover) throw new CapabilityEstateServiceError('conflict');
    const discovered = await discover();
    const now = input.now ?? new Date();
    const records = discovered.map((capability) => createCapabilityRecord({
      ...capability,
      createdBy: input.actorUserId,
      createdAt: now,
    }));
    return this.dependencies.unitOfWork.run(async ({ platformMemberships, capabilityEstate, audit }) => {
      await requirePlatformAdministrator(platformMemberships, input.actorUserId);
      for (const record of records) {
        await capabilityEstate.reconcileDiscoveredCapability(record);
      }
      const result = { discovered: records.length, reconciled: records.length };
      await audit.append(createPlatformAuditEvent({
        eventType: 'capability.catalogue.refreshed', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'capability_catalogue', subjectId: 'ecc', metadata: result,
      }));
      return result;
    });
  }
  async changeGovernanceState(input: {
    actorUserId: string;
    capabilityId: string;
    governanceState: CapabilityGovernanceState;
    now?: Date;
  }): Promise<CapabilityRecord> {
    if (!CAPABILITY_GOVERNANCE_STATES.includes(input.governanceState)) {
      throw new DomainValidationError('governanceState', 'governanceState must be supported');
    }
    const now = input.now ?? new Date();
    return this.dependencies.unitOfWork.run(async ({ platformMemberships, capabilityEstate, audit }) => {
      await requirePlatformAdministrator(platformMemberships, input.actorUserId);
      const current = await capabilityEstate.getCapability(input.capabilityId);
      if (!current) throw new CapabilityEstateServiceError('not_found');
      const updated = await capabilityEstate.updateCapabilityGovernanceState(
        current.id, input.governanceState, now,
      );
      await audit.append(createPlatformAuditEvent({
        eventType: 'capability.state.changed', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'capability', subjectId: current.id,
        metadata: {
          previousGovernanceState: current.governanceState,
          governanceState: updated.governanceState,
        },
      }));
      return updated;
    });
  }
  async createEligibilityPolicy(input: EligibilityCapabilityInput) {
    const now = input.now ?? new Date();
    const policy = createCapabilityEligibilityPolicy({
      id: `elig-${randomUUID()}`,
      capabilityId: input.capabilityId,
      scope: input.scope,
      organisationId: input.organisationId,
      decision: input.decision,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectRole === undefined ? {} : { projectRole: input.projectRole }),
      ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
      ...(input.cohortId === undefined ? {} : { cohortId: input.cohortId }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      createdBy: input.actorUserId,
      createdAt: now,
    });
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      await requirePolicyAdministrator({ memberships, platformMemberships, organisationId: input.organisationId, actorUserId: input.actorUserId, scope: policy.scope, projectId: policy.projectId });
      const capability = await capabilityEstate.getCapability(input.capabilityId);
      if (!capability) throw new CapabilityEstateServiceError('not_found');
      await capabilityEstate.createEligibilityPolicy(policy);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        ...(policy.projectId === undefined ? {} : { projectId: policy.projectId }),
        eventType: 'capability.eligibility.created', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'capability_eligibility', subjectId: policy.id,
        metadata: { capabilityId: capability.id, scope: policy.scope, decision: policy.decision },
      }));
    });
    return policy;
  }

  async revokeEligibilityPolicy(input: {
    organisationId: string; actorUserId: string; capabilityId: string; policyId: string; now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      const capability = await capabilityEstate.getCapability(input.capabilityId);
      if (!capability) throw new CapabilityEstateServiceError('not_found');
      const policy = (await capabilityEstate.listEligibilityPolicies(capability.id))
        .find((candidate) => candidate.id === input.policyId && candidate.status === 'active');
      if (!policy) throw new CapabilityEstateServiceError('not_found');
      await requirePolicyAdministrator({ memberships, platformMemberships, organisationId: input.organisationId, actorUserId: input.actorUserId, scope: policy.scope, projectId: policy.projectId });
      await capabilityEstate.revokeEligibilityPolicy(policy.id, now);
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        ...(policy.projectId === undefined ? {} : { projectId: policy.projectId }),
        eventType: 'capability.eligibility.revoked', actorType: 'user', actorId: input.actorUserId,
        subjectType: 'capability_eligibility', subjectId: policy.id,
        metadata: { capabilityId: capability.id, scope: policy.scope, decision: policy.decision },
      }));
    });
  }
  async releaseCapability(input: ReleaseCapabilityInput) {
    const now = input.now ?? new Date();
    if (input.scope !== 'platform' && !input.organisationId) {
      throw new DomainValidationError('organisationId', 'tenant-scoped release requires organisationId');
    }
    const release = createCapabilityReleasePolicy({
      id: `release-${randomUUID()}`,
      capabilityId: input.capabilityId,
      scope: input.scope,
      ...(input.scope === 'platform' ? {} : { organisationId: input.organisationId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectRole === undefined ? {} : { projectRole: input.projectRole }),
      ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
      ...(input.cohortId === undefined ? {} : { cohortId: input.cohortId }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      createdBy: input.actorUserId,
      createdAt: now,
    });
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      if (release.scope === 'platform') {
        await requirePlatformAdministrator(platformMemberships, input.actorUserId);
      } else {
        await requirePolicyAdministrator({ memberships, platformMemberships, organisationId: release.organisationId!, actorUserId: input.actorUserId, scope: release.scope, projectId: release.projectId });
      }
      const capability = await capabilityEstate.getCapability(input.capabilityId);
      if (!capability) throw new CapabilityEstateServiceError('not_found');
      await capabilityEstate.createRelease(release);
      const metadata = { capabilityId: input.capabilityId, scope: release.scope };
      if (release.scope === 'platform') {
        await audit.append(createPlatformAuditEvent({
          eventType: 'capability.release.created', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'capability_release', subjectId: release.id, metadata,
        }));
      } else {
        await audit.append(createAuditEvent({
          organisationId: release.organisationId!,
          ...(release.projectId === undefined ? {} : { projectId: release.projectId }),
          eventType: 'capability.release.created', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'capability_release', subjectId: release.id, metadata,
        }));
      }
    });
    return release;
  }

  async revokeCapabilityRelease(input: {
    organisationId?: string;
    actorUserId: string;
    capabilityId: string;
    releaseId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      const capability = await capabilityEstate.getCapability(input.capabilityId);
      if (!capability) throw new CapabilityEstateServiceError('not_found');
      const release = await capabilityEstate.getRelease(input.releaseId);
      if (!release || release.capabilityId !== capability.id || release.status !== 'active') {
        throw new CapabilityEstateServiceError('not_found');
      }
      if (release.scope === 'platform') {
        await requirePlatformAdministrator(platformMemberships, input.actorUserId);
      } else {
        if (!input.organisationId || input.organisationId !== release.organisationId) {
          throw new CapabilityEstateServiceError('forbidden');
        }
        await requirePolicyAdministrator({ memberships, platformMemberships, organisationId: input.organisationId, actorUserId: input.actorUserId, scope: release.scope, projectId: release.projectId });
      }
      await capabilityEstate.revokeRelease(release.id, now);
      const metadata = { capabilityId: capability.id, scope: release.scope };
      if (release.scope === 'platform') {
        await audit.append(createPlatformAuditEvent({
          eventType: 'capability.release.revoked', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'capability_release', subjectId: release.id, metadata,
        }));
      } else {
        await audit.append(createAuditEvent({
          organisationId: release.organisationId!,
          ...(release.projectId === undefined ? {} : { projectId: release.projectId }),
          eventType: 'capability.release.revoked', actorType: 'user', actorId: input.actorUserId,
          subjectType: 'capability_release', subjectId: release.id, metadata,
        }));
      }
    });
  }
  async grantPopulationMembership(input: {
    organisationId: string; actorUserId: string; kind: 'team' | 'cohort';
    populationId: string; userId: string; now?: Date;
  }): Promise<void> {
    if (input.kind !== 'team' && input.kind !== 'cohort') throw new DomainValidationError('kind');
    const populationId = requireStableIdentifier(input.populationId, 'populationId');
    const userId = requireStableIdentifier(input.userId, 'userId');
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      await requirePolicyAdministrator({
        memberships, platformMemberships, organisationId: input.organisationId,
        actorUserId: input.actorUserId, scope: input.kind,
      });
      const target = await memberships.getOrganisation(input.organisationId, userId);
      if (!target || target.status !== 'active') throw new CapabilityEstateServiceError('not_found');
      await capabilityEstate.grantPopulationMembership({
        organisationId: input.organisationId, kind: input.kind, populationId,
        userId, createdBy: input.actorUserId, now,
      });
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'capability.population_membership.granted', actorType: 'user',
        actorId: input.actorUserId, subjectType: 'capability_population_membership',
        subjectId: `${input.kind}:${populationId}:${userId}`,
        metadata: { kind: input.kind, populationId, userId },
      }));
    });
  }

  async revokePopulationMembership(input: {
    organisationId: string; actorUserId: string; kind: 'team' | 'cohort';
    populationId: string; userId: string; now?: Date;
  }): Promise<void> {
    if (input.kind !== 'team' && input.kind !== 'cohort') throw new DomainValidationError('kind');
    const populationId = requireStableIdentifier(input.populationId, 'populationId');
    const userId = requireStableIdentifier(input.userId, 'userId');
    const now = input.now ?? new Date();
    await this.dependencies.unitOfWork.run(async ({ memberships, platformMemberships, capabilityEstate, audit }) => {
      await requirePolicyAdministrator({
        memberships, platformMemberships, organisationId: input.organisationId,
        actorUserId: input.actorUserId, scope: input.kind,
      });
      const active = await capabilityEstate.listActivePopulationIds(input.organisationId, userId);
      const ids = input.kind === 'team' ? active.teamIds : active.cohortIds;
      if (!ids.includes(populationId)) return;
      await capabilityEstate.revokePopulationMembership({
        organisationId: input.organisationId, kind: input.kind, populationId, userId, now,
      });
      await audit.append(createAuditEvent({
        organisationId: input.organisationId,
        eventType: 'capability.population_membership.revoked', actorType: 'user',
        actorId: input.actorUserId, subjectType: 'capability_population_membership',
        subjectId: `${input.kind}:${populationId}:${userId}`,
        metadata: { kind: input.kind, populationId, userId },
      }));
    });
  }
  private async listProjectModelRoutes(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<ModelRoute[]> {
    const staticRoutes = this.dependencies.modelGateway.listRoutes();
    const dynamicRoutes = this.dependencies.connectionModelRoutes
      ? await this.dependencies.connectionModelRoutes.listAvailableForProject(input)
      : [];
    const routes = new Map<string, ModelRoute>();
    for (const route of [...staticRoutes, ...dynamicRoutes]) {
      const existing = routes.get(route.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(route)) {
        throw new CapabilityEstateServiceError('conflict', 'model route identity collision');
      }
      routes.set(route.id, route);
    }
    return [...routes.values()];
  }

  private modelRouteIsTechnicallyEligible(
    capability: CapabilityRecord,
    modelRoutes: ReadonlyMap<string, ModelRoute>,
  ): boolean {
    if (capability.kind !== 'model_route') return true;
    return modelRoutes.get(capability.sourceRef)?.available === true;
  }
  async listEligibleForProject(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    kind?: CapabilityKind;
  }): Promise<CapabilityRecord[]> {
    const [organisationMembership, project, populationIds] = await Promise.all([
      this.dependencies.memberships.getOrganisation(input.organisationId, input.actorUserId),
      this.dependencies.projects.getById(input.organisationId, input.projectId),
      this.dependencies.capabilities.listActivePopulationIds(input.organisationId, input.actorUserId),
    ]);
    if (!organisationMembership || organisationMembership.status !== 'active') {
      throw new CapabilityEstateServiceError('forbidden');
    }
    if (!project) throw new CapabilityEstateServiceError('not_found');
    const projectMembership = await this.dependencies.memberships.getProject(
      input.organisationId, input.projectId, input.actorUserId,
    );
    if (organisationMembership.role !== 'owner' && organisationMembership.role !== 'admin'
      && (!projectMembership || projectMembership.status !== 'active')) {
      throw new CapabilityEstateServiceError('forbidden');
    }

    const modelRoutes = input.kind === undefined || input.kind === 'model_route'
      ? new Map((await this.listProjectModelRoutes(input)).map((route) => [route.id, route]))
      : new Map<string, ModelRoute>();
    const capabilities = await this.dependencies.capabilities.listCapabilities(input.kind);
    const eligible: CapabilityRecord[] = [];
    for (const capability of capabilities) {
      const [releases, eligibilityPolicies] = await Promise.all([
        this.dependencies.capabilities.listReleases(capability.id),
        this.dependencies.capabilities.listEligibilityPolicies(capability.id),
      ]);
      const decision = evaluateCapabilityEligibility({
        capability,
        releases,
        eligibilityPolicies,
        context: {
          organisationId: input.organisationId,
          projectId: input.projectId,
          userId: input.actorUserId,
          ...(projectMembership?.role === undefined ? {} : { projectRole: projectMembership.role }),
          teamIds: populationIds.teamIds,
          cohortIds: populationIds.cohortIds,
          allowTrialCalibration: false,
        },
        technicalEligible: this.modelRouteIsTechnicallyEligible(capability, modelRoutes),
        operationAuthorized: true,
        environmentEligible: true,
      });
      if (decision.selectable) eligible.push(capability);
    }
    return eligible;
  }
  async resolveAutoForProject(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    kind: CapabilityKind;
  }): Promise<CapabilityRecord> {
    const eligible = await this.listEligibleForProject(input);
    if (eligible.length === 0) throw new CapabilityEstateServiceError('not_found');
    if (input.kind !== 'model_route') {
      return [...eligible].sort((left, right) => left.id.localeCompare(right.id))[0]!;
    }
    const routePriority = new Map(
      (await this.listProjectModelRoutes(input)).map((route) => [route.id, route.priority]),
    );
    return [...eligible].sort((left, right) => {
      const leftPriority = routePriority.get(left.sourceRef) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = routePriority.get(right.sourceRef) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.id.localeCompare(right.id);
    })[0]!;
  }
  async resolveStudioSelectionForProject(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
    agentId?: string;
    harnessId?: string;
    modelRouteId?: string;
  }) {
    const resolveCapability = async (
      kind: Extract<CapabilityKind, 'agent' | 'harness'>,
      requested: string | undefined,
    ) => {
      if (requested === undefined || requested === 'auto') {
        const capability = await this.resolveAutoForProject({
          organisationId: input.organisationId, projectId: input.projectId,
          actorUserId: input.actorUserId, kind,
        });
        return { mode: 'auto' as const, capabilityId: capability.id };
      }
      const capabilityId = requested;
      const eligible = await this.listEligibleForProject({
        organisationId: input.organisationId, projectId: input.projectId,
        actorUserId: input.actorUserId, kind,
      });
      if (!eligible.some((capability) => capability.id === capabilityId)) {
        throw new CapabilityEstateServiceError('not_found');
      }
      return { mode: 'explicit' as const, capabilityId };
    };

    const agent = await resolveCapability('agent', input.agentId);
    const harness = await resolveCapability('harness', input.harnessId);
    const modelMode = input.modelRouteId === undefined || input.modelRouteId === 'auto'
      ? 'auto' as const : 'explicit' as const;
    let routeId: string;
    if (modelMode === 'auto') {
      const capability = await this.resolveAutoForProject({
        organisationId: input.organisationId, projectId: input.projectId,
        actorUserId: input.actorUserId, kind: 'model_route',
      });
      routeId = capability.sourceRef;
    } else {
      const requestedRouteId = input.modelRouteId;
      if (requestedRouteId === undefined || requestedRouteId === 'auto') {
        throw new CapabilityEstateServiceError('not_found');
      }
      const routes = await this.listEligibleModelRoutesForProject({
        organisationId: input.organisationId, projectId: input.projectId,
        actorUserId: input.actorUserId,
      });
      if (!routes.some((route) => route.id === requestedRouteId)) {
        throw new CapabilityEstateServiceError('not_found');
      }
      routeId = requestedRouteId;
    }
    return { agent, harness, modelRoute: { mode: modelMode, routeId } };
  }
  async listEligibleModelRoutesForProject(input: {
    organisationId: string;
    projectId: string;
    actorUserId: string;
  }) {
    const capabilities = await this.listEligibleForProject({
      organisationId: input.organisationId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      kind: 'model_route',
    });
    const allowed = new Set(capabilities.map((capability) => capability.sourceRef));
    return (await this.listProjectModelRoutes(input))
      .filter((route) => route.available && allowed.has(route.id));
  }

}
