import type { AIConnectionOwnership } from '@engineering-os/domain';
import type { ModelAdapter, ModelRoute, ProviderCapabilities } from '@engineering-os/model-gateway';

export type AIConnectionValidationStatus = 'available' | 'reauth_required' | 'disabled';

export interface AIConnectionValidationResult {
  status: AIConnectionValidationStatus;
}

export interface AIConnectionProviderConnection {
  id: string;
  organisationId: string;
  ownership: AIConnectionOwnership;
  ownerUserId?: string;
  providerId: string;
  connectionFamilyId: string;
}

export interface AIConnectionProviderContext {
  connection: AIConnectionProviderConnection;
  credential?: { value: string };
}

export interface DiscoveredConnectionModel {
  providerModelId: string;
  displayName?: string;
  available: boolean;
  capabilities: ProviderCapabilities;
}
export interface AIConnectionProviderAdapter {
  id: string;
  validateConnection(input: AIConnectionProviderContext): Promise<unknown>;
  discoverModels(input: AIConnectionProviderContext): Promise<readonly unknown[]>;
  createModelAdapter?(input: {
    context: AIConnectionProviderContext;
    route: ModelRoute;
  }): Promise<ModelAdapter> | ModelAdapter;
}

export interface AIConnectionProviderAdapterRegistry {
  get(id: string): AIConnectionProviderAdapter | null;
  validateConnection(
    id: string,
    context: AIConnectionProviderContext,
  ): Promise<AIConnectionValidationResult>;
  discoverModels(
    id: string,
    context: AIConnectionProviderContext,
  ): Promise<DiscoveredConnectionModel[]>;
  validate(id: string, context: AIConnectionProviderContext): Promise<AIConnectionValidationResult>;
  discover(id: string, context: AIConnectionProviderContext): Promise<DiscoveredConnectionModel[]>;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CAPABILITY_NAMES = [
  'chat', 'tools', 'vision', 'files', 'mcp',
  'localWorkspace', 'headless', 'structuredOutput',
] as const satisfies readonly (keyof ProviderCapabilities)[];

function requireAdapterId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('provider adapter id must be a stable lower-case identifier');
  }
  return value;
}
function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeCapabilities(value: unknown): ProviderCapabilities {
  const record = requireRecord(value, 'capabilities');
  const result = {} as ProviderCapabilities;
  for (const name of CAPABILITY_NAMES) {
    const capability = record[name];
    if (capability !== undefined && typeof capability !== 'boolean') {
      throw new Error(`capabilities.${name} must be boolean when provided`);
    }
    result[name] = capability === true;
  }
  return result;
}

function normalizeValidation(value: unknown): AIConnectionValidationResult {
  const record = requireRecord(value, 'validation');
  const status = record.status;
  if (status !== 'available' && status !== 'reauth_required' && status !== 'disabled') {
    throw new Error('validation status must be available, reauth_required, or disabled');
  }
  return { status };
}

function normalizeDiscoveredModel(value: unknown): DiscoveredConnectionModel {
  const record = requireRecord(value, 'discovered model');
  const providerModelId = record.providerModelId;
  if (typeof providerModelId !== 'string' || providerModelId.trim() === '' || providerModelId.length > 512) {
    throw new Error('providerModelId must be a non-blank provider model identifier');
  }
  if (typeof record.available !== 'boolean') {
    throw new Error('available must be boolean');
  }
  const normalized: DiscoveredConnectionModel = {
    providerModelId: providerModelId.trim(),
    available: record.available,
    capabilities: normalizeCapabilities(record.capabilities),
  };
  if (record.displayName !== undefined) {
    if (
      typeof record.displayName !== 'string'
      || record.displayName.trim() === ''
      || record.displayName.length > 512
    ) {
      throw new Error('displayName must be a non-blank string when provided');
    }
    normalized.displayName = record.displayName.trim();
  }
  return normalized;
}

function adapterOrThrow(
  adapters: ReadonlyMap<string, AIConnectionProviderAdapter>,
  id: string,
): AIConnectionProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`unknown provider adapter: ${id}`);
  return adapter;
}

function normalizeDiscovery(discovered: readonly unknown[]): DiscoveredConnectionModel[] {
  const normalized = discovered.map(normalizeDiscoveredModel);
  const seen = new Set<string>();
  for (const model of normalized) {
    if (seen.has(model.providerModelId)) {
      throw new Error(`duplicate provider model identifier: ${model.providerModelId}`);
    }
    seen.add(model.providerModelId);
  }
  return normalized;
}
export function createAIConnectionProviderAdapterRegistry(
  input: readonly AIConnectionProviderAdapter[],
): AIConnectionProviderAdapterRegistry {
  const adapters = new Map<string, AIConnectionProviderAdapter>();
  for (const adapter of input) {
    const id = requireAdapterId(adapter.id);
    if (adapters.has(id)) throw new Error(`duplicate provider adapter id: ${id}`);
    adapters.set(id, Object.freeze({ ...adapter, id }));
  }

  const validateConnection = async (
    id: string,
    context: AIConnectionProviderContext,
  ): Promise<AIConnectionValidationResult> => {
    const adapter = adapterOrThrow(adapters, id);
    return normalizeValidation(await adapter.validateConnection(context));
  };
  const discoverModels = async (
    id: string,
    context: AIConnectionProviderContext,
  ): Promise<DiscoveredConnectionModel[]> => {
    const adapter = adapterOrThrow(adapters, id);
    const discovered = await adapter.discoverModels(context);
    if (!Array.isArray(discovered)) throw new Error('provider discovery must return an array');
    return normalizeDiscovery(discovered);
  };

  return Object.freeze({
    get(id: string) { return adapters.get(id) ?? null; },
    validateConnection,
    discoverModels,
    validate: validateConnection,
    discover: discoverModels,
  });
}