import {
  CAPABILITY_GOVERNANCE_STATES,
  CAPABILITY_KINDS,
  type CapabilityExecutionVerification,
  type CapabilityGovernanceState,
  type CapabilityKind,
  type CapabilityMaturity,
} from './capability-estate.js';
import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

const DOMAIN_PACK_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const UI_EXTENSION_SURFACES = ['studio', 'project', 'admin'] as const;
export type DomainPackUiSurface = (typeof UI_EXTENSION_SURFACES)[number];

export interface DomainPackCapabilityContribution {
  id: string;
  kind: CapabilityKind;
  displayName: string;
}

export interface DomainPackUiExtension {
  surface: DomainPackUiSurface;
  slot: string;
  viewId: string;
  label: string;
}

export interface CreateDomainPackDescriptorInput {
  id: string;
  version: string;
  publisher: string;
  source: string;
  governanceState: CapabilityGovernanceState;
  capabilities?: readonly DomainPackCapabilityContribution[];
  agentRoles?: readonly string[];
  workflowTypes?: readonly string[];
  artifactTypes?: readonly string[];
  evidenceTypes?: readonly string[];
  reviewPolicies?: readonly string[];
  toolRequirements?: readonly string[];
  executionRequirements?: readonly string[];
  schemaContributions?: readonly string[];
  uiExtensions?: readonly DomainPackUiExtension[];
}

export interface DomainPackDescriptor {
  readonly id: string;
  readonly version: string;
  readonly publisher: string;
  readonly source: string;
  readonly governanceState: CapabilityGovernanceState;
  readonly capabilities: readonly Readonly<DomainPackCapabilityContribution>[];
  readonly agentRoles: readonly string[];
  readonly workflowTypes: readonly string[];
  readonly artifactTypes: readonly string[];
  readonly evidenceTypes: readonly string[];
  readonly reviewPolicies: readonly string[];
  readonly toolRequirements: readonly string[];
  readonly executionRequirements: readonly string[];
  readonly schemaContributions: readonly string[];
  readonly uiExtensions: readonly Readonly<DomainPackUiExtension>[];
}

export interface DomainPackDiscoveredCapability {
  id: string;
  kind: CapabilityKind;
  source: 'domain_pack';
  sourceRef: string;
  displayName: string;
  maturity: CapabilityMaturity;
  governanceState: CapabilityGovernanceState;
  executionVerification: CapabilityExecutionVerification;
}

function requireVersion(value: unknown): string {
  if (typeof value !== 'string' || !DOMAIN_PACK_VERSION_PATTERN.test(value)) {
    throw new DomainValidationError('version', 'version must be an explicit semantic version');
  }
  return value;
}

function requireGovernanceState(value: unknown): CapabilityGovernanceState {
  if (typeof value !== 'string' || !CAPABILITY_GOVERNANCE_STATES.includes(value as CapabilityGovernanceState)) {
    throw new DomainValidationError('governanceState', 'governanceState must be supported');
  }
  return value as CapabilityGovernanceState;
}

function stableList(values: readonly string[] | undefined, field: string): readonly string[] {
  const result = (values ?? []).map((value, index) => requireStableIdentifier(value, `${field}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new DomainValidationError(field, `${field} must not contain duplicates`);
  }
  return Object.freeze(result);
}

function capabilityContributions(
  values: readonly DomainPackCapabilityContribution[] | undefined,
): readonly Readonly<DomainPackCapabilityContribution>[] {
  const seen = new Set<string>();
  const result = (values ?? []).map((value, index) => {
    const id = requireStableIdentifier(value.id, `capabilities[${index}].id`);
    if (seen.has(id)) throw new DomainValidationError('capabilities', `duplicate capability id: ${id}`);
    seen.add(id);
    if (!CAPABILITY_KINDS.includes(value.kind)) {
      throw new DomainValidationError(`capabilities[${index}].kind`, 'capability kind must be supported');
    }
    return Object.freeze({
      id,
      kind: value.kind,
      displayName: requireNonBlank(value.displayName, `capabilities[${index}].displayName`),
    });
  });
  return Object.freeze(result);
}

function uiExtensions(
  values: readonly DomainPackUiExtension[] | undefined,
): readonly Readonly<DomainPackUiExtension>[] {
  const seen = new Set<string>();
  const result = (values ?? []).map((value, index) => {
    if (!UI_EXTENSION_SURFACES.includes(value.surface)) {
      throw new DomainValidationError(`uiExtensions[${index}].surface`, 'UI surface must be supported');
    }
    const slot = requireStableIdentifier(value.slot, `uiExtensions[${index}].slot`);
    const viewId = requireStableIdentifier(value.viewId, `uiExtensions[${index}].viewId`);
    const key = `${value.surface}:${slot}:${viewId}`;
    if (seen.has(key)) throw new DomainValidationError('uiExtensions', `duplicate UI extension: ${key}`);
    seen.add(key);
    return Object.freeze({
      surface: value.surface,
      slot,
      viewId,
      label: requireNonBlank(value.label, `uiExtensions[${index}].label`),
    });
  });
  return Object.freeze(result);
}

export function createDomainPackDescriptor(input: CreateDomainPackDescriptorInput): DomainPackDescriptor {
  const descriptor: DomainPackDescriptor = {
    id: requireStableIdentifier(input.id, 'id'),
    version: requireVersion(input.version),
    publisher: requireStableIdentifier(input.publisher, 'publisher'),
    source: requireStableIdentifier(input.source, 'source'),
    governanceState: requireGovernanceState(input.governanceState),
    capabilities: capabilityContributions(input.capabilities),
    agentRoles: stableList(input.agentRoles, 'agentRoles'),
    workflowTypes: stableList(input.workflowTypes, 'workflowTypes'),
    artifactTypes: stableList(input.artifactTypes, 'artifactTypes'),
    evidenceTypes: stableList(input.evidenceTypes, 'evidenceTypes'),
    reviewPolicies: stableList(input.reviewPolicies, 'reviewPolicies'),
    toolRequirements: stableList(input.toolRequirements, 'toolRequirements'),
    executionRequirements: stableList(input.executionRequirements, 'executionRequirements'),
    schemaContributions: stableList(input.schemaContributions, 'schemaContributions'),
    uiExtensions: uiExtensions(input.uiExtensions),
  };
  return Object.freeze(descriptor);
}

export function domainPackDiscoveredCapabilities(
  descriptor: DomainPackDescriptor,
): DomainPackDiscoveredCapability[] {
  return descriptor.capabilities.map((capability) => ({
    id: capability.id,
    kind: capability.kind,
    source: 'domain_pack',
    sourceRef: `${descriptor.id}@${descriptor.version}:${capability.id}`,
    displayName: capability.displayName,
    maturity: 'discovered',
    governanceState: 'discovered',
    executionVerification: 'unverified',
  }));
}

export class DomainPackRegistry {
  private readonly descriptors = new Map<string, DomainPackDescriptor>();

  register(descriptor: DomainPackDescriptor): DomainPackDescriptor {
    const key = this.key(descriptor.id, descriptor.version);
    if (this.descriptors.has(key)) {
      throw new DomainValidationError('descriptor', `Domain Pack ${descriptor.id}@${descriptor.version} is already registered`);
    }
    this.descriptors.set(key, descriptor);
    return descriptor;
  }

  get(id: string, version: string): DomainPackDescriptor | undefined {
    return this.descriptors.get(this.key(requireStableIdentifier(id, 'id'), requireVersion(version)));
  }

  list(): DomainPackDescriptor[] {
    return [...this.descriptors.values()];
  }

  private key(id: string, version: string): string {
    return `${id}@${version}`;
  }
}
