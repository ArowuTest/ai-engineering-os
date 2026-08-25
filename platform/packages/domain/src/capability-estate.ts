import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const CAPABILITY_KINDS = [
  'model_route', 'harness', 'agent', 'skill', 'mcp_tool', 'workflow',
] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CAPABILITY_MATURITY_STATES = [
  'discovered', 'experimental', 'supported', 'deprecated',
] as const;
export type CapabilityMaturity = (typeof CAPABILITY_MATURITY_STATES)[number];

export const CAPABILITY_GOVERNANCE_STATES = [
  'discovered', 'trial_calibration', 'approved', 'disabled',
] as const;
export type CapabilityGovernanceState = (typeof CAPABILITY_GOVERNANCE_STATES)[number];

export const CAPABILITY_EXECUTION_VERIFICATION_STATES = [
  'unverified', 'trial', 'verified',
] as const;
export type CapabilityExecutionVerification =
  (typeof CAPABILITY_EXECUTION_VERIFICATION_STATES)[number];

export interface CapabilityRecord {
  id: string;
  kind: CapabilityKind;
  source: string;
  sourceRef: string;
  displayName: string;
  maturity: CapabilityMaturity;
  governanceState: CapabilityGovernanceState;
  executionVerification: CapabilityExecutionVerification;  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCapabilityRecordInput {
  id: string;
  kind: CapabilityKind;
  source: string;
  sourceRef: string;
  displayName: string;
  maturity: CapabilityMaturity;
  governanceState: CapabilityGovernanceState;
  executionVerification: CapabilityExecutionVerification;
  createdBy: string;
  createdAt?: Date;
}

export const CAPABILITY_RELEASE_SCOPES = [
  'platform', 'organisation', 'project', 'project_role', 'team', 'cohort', 'user',
] as const;
export type CapabilityReleaseScope = (typeof CAPABILITY_RELEASE_SCOPES)[number];

export interface CapabilityReleasePolicy {
  id: string;
  capabilityId: string;
  scope: CapabilityReleaseScope;
  organisationId?: string;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface CreateCapabilityReleasePolicyInput {
  id: string;
  capabilityId: string;
  scope: CapabilityReleaseScope;
  organisationId?: string;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  createdBy: string;
  createdAt?: Date;
}

export const CAPABILITY_ELIGIBILITY_SCOPES = [
  'organisation', 'project', 'project_role', 'team', 'cohort', 'user',
] as const;
export type CapabilityEligibilityScope = (typeof CAPABILITY_ELIGIBILITY_SCOPES)[number];
export type CapabilityEligibilityPolicyDecision = 'allow' | 'deny';

export interface CapabilityEligibilityPolicy {
  id: string;
  capabilityId: string;
  scope: CapabilityEligibilityScope;
  organisationId: string;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  decision: CapabilityEligibilityPolicyDecision;
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface CreateCapabilityEligibilityPolicyInput {
  id: string;
  capabilityId: string;
  scope: CapabilityEligibilityScope;
  organisationId: string;
  projectId?: string;
  projectRole?: string;
  teamId?: string;
  cohortId?: string;
  userId?: string;
  decision: CapabilityEligibilityPolicyDecision;
  createdBy: string;
  createdAt?: Date;
}
export interface CapabilityEligibilityContext {
  organisationId: string;
  projectId?: string;
  userId: string;
  projectRole?: string;
  teamIds: string[];
  cohortIds: string[];
  allowTrialCalibration: boolean;
}

export type CapabilityEligibilityReason =
  | 'disabled'
  | 'trial_only'
  | 'not_approved'
  | 'not_released'
  | 'policy_ineligible'
  | 'execution_unverified'
  | 'technical_ineligible'
  | 'operation_unauthorized'
  | 'environment_ineligible';

export interface CapabilityEligibilityInput {
  capability: CapabilityRecord;
  releases: CapabilityReleasePolicy[];
  eligibilityPolicies?: CapabilityEligibilityPolicy[];
  context: CapabilityEligibilityContext;
  technicalEligible: boolean;
  operationAuthorized: boolean;
  environmentEligible: boolean;
}

export interface CapabilityEligibilityDecision {
  selectable: boolean;
  reasons: CapabilityEligibilityReason[];
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError(field, `${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

export function createCapabilityRecord(input: CreateCapabilityRecordInput): CapabilityRecord {
  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  return {
    id: requireStableIdentifier(input.id, 'id'),
    kind: requireEnum(input.kind, 'kind', CAPABILITY_KINDS),
    source: requireStableIdentifier(input.source, 'source'),
    sourceRef: requireNonBlank(input.sourceRef, 'sourceRef'),
    displayName: requireNonBlank(input.displayName, 'displayName'),
    maturity: requireEnum(input.maturity, 'maturity', CAPABILITY_MATURITY_STATES),
    governanceState: requireEnum(
      input.governanceState, 'governanceState', CAPABILITY_GOVERNANCE_STATES,
    ),
    executionVerification: requireEnum(
      input.executionVerification,
      'executionVerification',
      CAPABILITY_EXECUTION_VERIFICATION_STATES,
    ),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
    updatedAt: new Date(createdAt.getTime()),
  };
}

export function createCapabilityReleasePolicy(
  input: CreateCapabilityReleasePolicyInput,
): CapabilityReleasePolicy {
  const scope = requireEnum(input.scope, 'scope', CAPABILITY_RELEASE_SCOPES);
  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  const missingScopeField =
    (scope === 'organisation' && input.organisationId === undefined)
    || (scope === 'project' && (input.organisationId === undefined || input.projectId === undefined))
    || (scope === 'project_role' && (input.organisationId === undefined || input.projectRole === undefined))
    || (scope === 'team' && (input.organisationId === undefined || input.teamId === undefined))
    || (scope === 'cohort' && (input.organisationId === undefined || input.cohortId === undefined))
    || (scope === 'user' && (input.organisationId === undefined || input.userId === undefined));
  if (missingScopeField) throw new DomainValidationError('scope', `${scope} release is missing required scope fields`);
  const policy: CapabilityReleasePolicy = {
    id: requireStableIdentifier(input.id, 'id'),
    capabilityId: requireStableIdentifier(input.capabilityId, 'capabilityId'),
    scope,
    status: 'active',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
  };
  if (input.organisationId !== undefined) {
    policy.organisationId = requireStableIdentifier(input.organisationId, 'organisationId');
  }
  if (input.projectId !== undefined) {
    policy.projectId = requireStableIdentifier(input.projectId, 'projectId');
  }
  if (input.projectRole !== undefined) {
    policy.projectRole = requireStableIdentifier(input.projectRole, 'projectRole');
  }
  if (input.teamId !== undefined) policy.teamId = requireStableIdentifier(input.teamId, 'teamId');
  if (input.cohortId !== undefined) policy.cohortId = requireStableIdentifier(input.cohortId, 'cohortId');
  if (input.userId !== undefined) policy.userId = requireStableIdentifier(input.userId, 'userId');
  return policy;
}

export function createCapabilityEligibilityPolicy(
  input: CreateCapabilityEligibilityPolicyInput,
): CapabilityEligibilityPolicy {
  const scope = requireEnum(input.scope, 'scope', CAPABILITY_ELIGIBILITY_SCOPES);
  const decision = requireEnum(input.decision, 'decision', ['allow', 'deny'] as const);
  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  const missingScopeField =
    (scope === 'project' && input.projectId === undefined)
    || (scope === 'project_role' && input.projectRole === undefined)
    || (scope === 'team' && input.teamId === undefined)
    || (scope === 'cohort' && input.cohortId === undefined)
    || (scope === 'user' && input.userId === undefined);
  if (missingScopeField) {
    throw new DomainValidationError('scope', `${scope} eligibility policy is missing required scope fields`);
  }
  const policy: CapabilityEligibilityPolicy = {
    id: requireStableIdentifier(input.id, 'id'),
    capabilityId: requireStableIdentifier(input.capabilityId, 'capabilityId'),
    scope,
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    decision,
    status: 'active',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
  };
  if (input.projectId !== undefined) policy.projectId = requireStableIdentifier(input.projectId, 'projectId');
  if (input.projectRole !== undefined) policy.projectRole = requireStableIdentifier(input.projectRole, 'projectRole');
  if (input.teamId !== undefined) policy.teamId = requireStableIdentifier(input.teamId, 'teamId');
  if (input.cohortId !== undefined) policy.cohortId = requireStableIdentifier(input.cohortId, 'cohortId');
  if (input.userId !== undefined) policy.userId = requireStableIdentifier(input.userId, 'userId');
  return policy;
}
function releaseMatches(
  release: CapabilityReleasePolicy,
  capabilityId: string,
  context: CapabilityEligibilityContext,
): boolean {
  if (release.status !== 'active' || release.capabilityId !== capabilityId) return false;
  if (release.scope === 'platform') return true;
  if (release.organisationId !== context.organisationId) return false;
  if (release.scope === 'organisation') return true;
  if (release.scope === 'project') return release.projectId === context.projectId;
  if (release.scope === 'project_role') {
    return release.projectRole === context.projectRole
      && (release.projectId === undefined || release.projectId === context.projectId);
  }
  if (release.scope === 'team') return release.teamId !== undefined && context.teamIds.includes(release.teamId);
  if (release.scope === 'cohort') return release.cohortId !== undefined && context.cohortIds.includes(release.cohortId);
  return release.scope === 'user' && release.userId === context.userId;
}

function eligibilityPolicyMatches(
  policy: CapabilityEligibilityPolicy,
  capabilityId: string,
  context: CapabilityEligibilityContext,
): boolean {
  if (policy.status !== 'active' || policy.capabilityId !== capabilityId) return false;
  if (policy.organisationId !== context.organisationId) return false;
  if (policy.scope === 'organisation') return true;
  if (policy.scope === 'project') return policy.projectId === context.projectId;
  if (policy.scope === 'project_role') {
    return policy.projectRole === context.projectRole
      && (policy.projectId === undefined || policy.projectId === context.projectId);
  }
  if (policy.scope === 'team') return policy.teamId !== undefined && context.teamIds.includes(policy.teamId);
  if (policy.scope === 'cohort') return policy.cohortId !== undefined && context.cohortIds.includes(policy.cohortId);
  return policy.scope === 'user' && policy.userId === context.userId;
}
export function evaluateCapabilityEligibility(
  input: CapabilityEligibilityInput,
): CapabilityEligibilityDecision {
  const { capability, context } = input;
  if (capability.governanceState === 'disabled') {
    return { selectable: false, reasons: ['disabled'] };
  }
  if (capability.governanceState === 'trial_calibration' && !context.allowTrialCalibration) {
    return { selectable: false, reasons: ['trial_only'] };
  }
  if (capability.governanceState !== 'approved'
    && capability.governanceState !== 'trial_calibration') {
    return { selectable: false, reasons: ['not_approved'] };
  }
  if (capability.executionVerification !== 'verified') {
    return { selectable: false, reasons: ['execution_unverified'] };
  }
  if (!input.releases.some((release) => releaseMatches(release, capability.id, context))) {
    return { selectable: false, reasons: ['not_released'] };
  }
  const policies = (input.eligibilityPolicies ?? []).filter(
    (policy) => policy.status === 'active' && policy.capabilityId === capability.id,
  );
  if (policies.some(
    (policy) => policy.decision === 'deny' && eligibilityPolicyMatches(policy, capability.id, context),
  )) {
    return { selectable: false, reasons: ['policy_ineligible'] };
  }
  const allowPolicies = policies.filter((policy) => policy.decision === 'allow');
  if (allowPolicies.length > 0
    && !allowPolicies.some((policy) => eligibilityPolicyMatches(policy, capability.id, context))) {
    return { selectable: false, reasons: ['policy_ineligible'] };
  }
  if (!input.technicalEligible) {
    return { selectable: false, reasons: ['technical_ineligible'] };
  }
  if (!input.operationAuthorized) {
    return { selectable: false, reasons: ['operation_unauthorized'] };
  }
  if (!input.environmentEligible) {
    return { selectable: false, reasons: ['environment_ineligible'] };
  }
  return { selectable: true, reasons: [] };
}
export type AgentRecordStatus = 'active' | 'disabled';

export interface AgentRecord {
  id: string;
  capabilityId: string;
  displayName: string;
  specialistRole: string;
  description: string;
  status: AgentRecordStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentRecordInput {
  id: string;
  capabilityId: string;
  displayName: string;
  specialistRole: string;
  description: string;
  status?: AgentRecordStatus;
  createdBy: string;
  createdAt?: Date;
}
export function createAgentRecord(input: CreateAgentRecordInput): AgentRecord {
  const raw = input as unknown as Record<string, unknown>;
  if ('modelRouteId' in raw || 'harnessId' in raw) {
    throw new DomainValidationError(
      'agent',
      'agent records cannot bind a model route or harness',
    );
  }
  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  const status = input.status ?? 'active';
  if (status !== 'active' && status !== 'disabled') {
    throw new DomainValidationError('status', 'status must be active or disabled');
  }
  return {
    id: requireStableIdentifier(input.id, 'id'),
    capabilityId: requireStableIdentifier(input.capabilityId, 'capabilityId'),
    displayName: requireNonBlank(input.displayName, 'displayName'),
    specialistRole: requireStableIdentifier(input.specialistRole, 'specialistRole'),
    description: requireNonBlank(input.description, 'description'),
    status,
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
    updatedAt: new Date(createdAt.getTime()),
  };
}