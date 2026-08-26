import type { AIRunnerRecord } from './ai-runner.js';
import { assertSensitiveTextSafe, DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const RUNTIME_CAPABILITY_STATES = ['declared', 'available', 'unavailable', 'unknown'] as const;
export type RuntimeCapabilityState = (typeof RUNTIME_CAPABILITY_STATES)[number];

export const RUNTIME_CAPABILITY_SOURCES = [
  'runner', 'runtime_probe', 'environment', 'harness', 'connection', 'policy', 'platform',
] as const;
export type RuntimeCapabilitySource = (typeof RUNTIME_CAPABILITY_SOURCES)[number];

export interface RuntimeCapabilityObservation {
  id: string;
  state: RuntimeCapabilityState;
  source: RuntimeCapabilitySource;
  reason?: string;
}

export interface CreateRuntimeCapabilityManifestInput {
  runnerId?: string;
  environmentId?: string;
  harnessId?: string;
  connectionId?: string;
  observedAt: Date;
  capabilities: readonly RuntimeCapabilityObservation[];
}

export interface RuntimeCapabilityManifest {
  runnerId?: string;
  environmentId?: string;
  harnessId?: string;
  connectionId?: string;
  observedAt: Date;
  capabilities: readonly RuntimeCapabilityObservation[];
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError('observedAt', 'observedAt must be a valid Date');
  }
  return new Date(value.getTime());
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireStableIdentifier(value, field);
}

export function createRuntimeCapabilityManifest(
  input: CreateRuntimeCapabilityManifestInput,
): RuntimeCapabilityManifest {
  const seen = new Set<string>();
  const capabilities = input.capabilities.map((capability, index) => {
    const id = requireStableIdentifier(capability.id, `capabilities[${index}].id`);
    if (seen.has(id)) throw new DomainValidationError('capabilities', `duplicate capability id: ${id}`);
    seen.add(id);
    const state = requireEnum(capability.state, RUNTIME_CAPABILITY_STATES, `capabilities[${index}].state`);
    const source = requireEnum(capability.source, RUNTIME_CAPABILITY_SOURCES, `capabilities[${index}].source`);
    const item: RuntimeCapabilityObservation = { id, state, source };
    if (capability.reason !== undefined) {
      const reason = requireNonBlank(capability.reason, `capabilities[${index}].reason`);
      if (reason.length > 1024) throw new DomainValidationError('reason', 'capability reason is too long');
      assertSensitiveTextSafe(reason, `capabilities[${index}].reason`);
      item.reason = reason;
    }
    return Object.freeze(item);
  }).sort((left, right) => left.id.localeCompare(right.id));

  const manifest: RuntimeCapabilityManifest = {
    observedAt: requireDate(input.observedAt),
    capabilities: Object.freeze(capabilities),
  };
  const optionals = [
    ['runnerId', optionalIdentifier(input.runnerId, 'runnerId')],
    ['environmentId', optionalIdentifier(input.environmentId, 'environmentId')],
    ['harnessId', optionalIdentifier(input.harnessId, 'harnessId')],
    ['connectionId', optionalIdentifier(input.connectionId, 'connectionId')],
  ] as const;
  for (const [key, value] of optionals) {
    if (value !== undefined) (manifest as unknown as Record<string, unknown>)[key] = value;
  }
  return Object.freeze(manifest);
}

export function runtimeCapabilityManifestFromRunner(
  runner: AIRunnerRecord,
  observedAt: Date,
): RuntimeCapabilityManifest {
  return createRuntimeCapabilityManifest({
    runnerId: runner.id,
    harnessId: runner.harnessId,
    observedAt,
    capabilities: runner.capabilities.map((id) => ({ id, state: 'declared' as const, source: 'runner' as const })),
  });
}
