import { validateRunnerTaskEnvelope, type RunnerTaskEnvelope } from '@engineering-os/domain';
import type { CapabilityName, ModelRoute, ProviderCapabilities } from './types.js';

const STABLE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CAPABILITY_NAMES: readonly CapabilityName[] = ['chat', 'tools', 'vision', 'files', 'mcp', 'localWorkspace', 'headless', 'structuredOutput'];

export class HarnessExecutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessExecutionValidationError';
  }
}

export class NoEligibleHarnessAdapterError extends Error {
  constructor() {
    super('No eligible harness execution adapter satisfies this request');
    this.name = 'NoEligibleHarnessAdapterError';
  }
}
export type HarnessMetadataValue = null | string | number | boolean | HarnessMetadataValue[] | { [key: string]: HarnessMetadataValue };

export interface HarnessExecutionRequest {
  envelope: RunnerTaskEnvelope;
  route: ModelRoute;
  requiredCapabilities: CapabilityName[];
  operations: string[];
  workspaceScope: string;
  instruction: string;
}

export interface HarnessExecutionAdapter {
  id: string;
  harnessId: string;
  capabilities: ProviderCapabilities;
  execute(request: HarnessExecutionRequest): Promise<HarnessExecutionResult>;
}

export type HarnessExecutionStatus = 'completed' | 'failed' | 'paused';
export type HarnessStatusEventState = 'starting' | 'running' | 'completed' | 'failed' | 'paused';

export interface HarnessStatusEvent {
  type: 'status';
  at: Date;
  status: HarnessStatusEventState;
  metadata?: Record<string, HarnessMetadataValue>;
}
export interface HarnessCheckpointEvent {
  type: 'checkpoint';
  at: Date;
  checkpointId: string;
  metadata?: Record<string, HarnessMetadataValue>;
}

export type HarnessExecutionEvent = HarnessStatusEvent | HarnessCheckpointEvent;

export interface HarnessExecutionResult {
  status: HarnessExecutionStatus;
  output?: string;
  events: HarnessExecutionEvent[];
  metadata?: Record<string, HarnessMetadataValue>;
}

function requireStableIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !STABLE_IDENTIFIER_PATTERN.test(value)) {
    throw new HarnessExecutionValidationError(`${field} must be a valid stable identifier`);
  }
  return value;
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HarnessExecutionValidationError(`${field} must be a valid Date`);
  }
  return value;
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessExecutionValidationError(`${field} must be non-blank`);
  }
  return value;
}
function requireCapabilityList(value: readonly CapabilityName[]): CapabilityName[] {
  if (!Array.isArray(value)) {
    throw new HarnessExecutionValidationError('requiredCapabilities must be an array');
  }
  const result: CapabilityName[] = [];
  const seen = new Set<CapabilityName>();
  for (const capability of value) {
    if (!CAPABILITY_NAMES.includes(capability)) {
      throw new HarnessExecutionValidationError(`unknown required capability: ${String(capability)}`);
    }
    if (seen.has(capability)) {
      throw new HarnessExecutionValidationError(`duplicate required capability: ${capability}`);
    }
    seen.add(capability);
    result.push(capability);
  }
  return result;
}

function requireOperationList(value: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    throw new HarnessExecutionValidationError('operations must be an array');
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const operation of value) {
    const normalized = requireStableIdentifier(operation, 'operation');
    if (seen.has(normalized)) {
      throw new HarnessExecutionValidationError(`duplicate operation: ${normalized}`);
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'cookie',
  'cookies',
  'session',
  'providersession',
  'credential',
  'credentials',
  'secret',
  'secretrefid',
  'authorization',
  'authorizationheader'
]);

function normalizedMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
const FORBIDDEN_METADATA_KEY_SUFFIXES = [
  'password',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'cookie',
  'cookies',
  'providersession',
  'credential',
  'credentials',
  'secret',
  'secretrefid',
  'authorization',
  'authorizationheader'
] as const;

function metadataKeyIsForbidden(key: string): boolean {
  const normalized = normalizedMetadataKey(key);
  if (FORBIDDEN_METADATA_KEYS.has(normalized)) return true;
  return FORBIDDEN_METADATA_KEY_SUFFIXES.some(suffix => normalized.length > suffix.length && normalized.endsWith(suffix));
}

function safeMetadataValue(value: unknown, path: string, depth = 0, seen = new WeakSet<object>()): HarnessMetadataValue {
  if (depth > 12) {
    throw new HarnessExecutionValidationError(`${path} metadata nesting is too deep`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new HarnessExecutionValidationError(`${path} metadata number must be finite`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new HarnessExecutionValidationError(`${path} metadata must be JSON-safe`);
  }
  if (seen.has(value)) {
    throw new HarnessExecutionValidationError(`${path} metadata must not be cyclic`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => safeMetadataValue(item, `${path}[${index}]`, depth + 1, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new HarnessExecutionValidationError(`${path} metadata must use plain objects`);
    }
    const result: Record<string, HarnessMetadataValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (metadataKeyIsForbidden(key)) {
        throw new HarnessExecutionValidationError(`${path}.${key} contains provider credential metadata`);
      }
      result[key] = safeMetadataValue(item, `${path}.${key}`, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
function safeMetadata(value: unknown, path: string): Record<string, HarnessMetadataValue> | undefined {
  if (value === undefined) return undefined;
  const normalized = safeMetadataValue(value, path);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
    throw new HarnessExecutionValidationError(`${path} metadata must be an object`);
  }
  return normalized;
}

function canonicalModelRoute(route: ModelRoute): ModelRoute {
  const id = requireStableIdentifier(route.id, 'route id');
  const provider = requireStableIdentifier(route.provider, 'route provider');
  if (provider === 'auto') {
    throw new HarnessExecutionValidationError('route provider cannot be auto');
  }
  const model = requireNonBlank(route.model, 'route model');
  if (!['subscription', 'api', 'manual'].includes(route.executionMode)) {
    throw new HarnessExecutionValidationError('route executionMode is invalid');
  }
  if (!['included_subscription', 'provider_credit', 'metered_api', 'manual'].includes(route.costType)) {
    throw new HarnessExecutionValidationError('route costType is invalid');
  }
  if (typeof route.available !== 'boolean') {
    throw new HarnessExecutionValidationError('route available must be boolean');
  }
  if (!Number.isFinite(route.priority)) {
    throw new HarnessExecutionValidationError('route priority must be finite');
  }
  const capabilities = {} as ProviderCapabilities;
  for (const capability of CAPABILITY_NAMES) {
    if (typeof route.capabilities?.[capability] !== 'boolean') {
      throw new HarnessExecutionValidationError(`route capability ${capability} must be boolean`);
    }
    capabilities[capability] = route.capabilities[capability];
  }
  return { id, provider, model, executionMode: route.executionMode, costType: route.costType, available: route.available, priority: route.priority, capabilities };
}
export function validateHarnessExecutionRequest(request: HarnessExecutionRequest, at = new Date()): HarnessExecutionRequest {
  const now = requireDate(at, 'execution time');
  const taskEnvelope = validateRunnerTaskEnvelope(request.envelope);
  const modelRoute = canonicalModelRoute(request.route);
  if (taskEnvelope.issuedAt.getTime() > now.getTime()) {
    throw new HarnessExecutionValidationError('task envelope has not been issued yet');
  }
  if (taskEnvelope.expiresAt.getTime() <= now.getTime()) {
    throw new HarnessExecutionValidationError('task envelope is expired');
  }
  if (modelRoute.id !== taskEnvelope.routeId) {
    throw new HarnessExecutionValidationError('route does not match task envelope route');
  }
  const workspaceScope = requireNonBlank(request.workspaceScope, 'workspaceScope');
  if (workspaceScope !== taskEnvelope.workspaceScope) {
    throw new HarnessExecutionValidationError('workspace scope exceeds or differs from task envelope scope');
  }
  const operations = requireOperationList(request.operations);
  for (const operation of operations) {
    if (!taskEnvelope.allowedOperations.includes(operation)) {
      throw new HarnessExecutionValidationError(`operation ${operation} is outside task envelope scope`);
    }
  }
  const requiredCapabilities = requireCapabilityList(request.requiredCapabilities);
  const instruction = requireNonBlank(request.instruction, 'instruction');

  return {
    envelope: taskEnvelope,
    route: modelRoute,
    requiredCapabilities,
    operations,
    workspaceScope,
    instruction
  };
}

function validateHarnessExecutionEvent(event: HarnessExecutionEvent): HarnessExecutionEvent {
  const at = requireDate(event.at, 'event.at');
  if (event.type === 'checkpoint') {
    const normalized: HarnessCheckpointEvent = {
      type: 'checkpoint',
      at,
      checkpointId: requireStableIdentifier(event.checkpointId, 'checkpointId')
    };
    const metadata = safeMetadata(event.metadata, 'checkpoint');
    if (metadata !== undefined) normalized.metadata = metadata;
    return normalized;
  }
  const allowedStatuses: readonly HarnessStatusEventState[] = ['starting', 'running', 'completed', 'failed', 'paused'];
  if (!allowedStatuses.includes(event.status)) {
    throw new HarnessExecutionValidationError('status event contains an unknown state');
  }
  const normalized: HarnessStatusEvent = {
    type: 'status',
    at,
    status: event.status
  };
  const metadata = safeMetadata(event.metadata, 'status');
  if (metadata !== undefined) normalized.metadata = metadata;
  return normalized;
}

export function validateHarnessExecutionResult(result: HarnessExecutionResult): HarnessExecutionResult {
  const allowedStatuses: readonly HarnessExecutionStatus[] = ['completed', 'failed', 'paused'];
  if (!allowedStatuses.includes(result.status)) {
    throw new HarnessExecutionValidationError('result contains an unknown status');
  }
  if (!Array.isArray(result.events)) {
    throw new HarnessExecutionValidationError('result events must be an array');
  }
  const normalized: HarnessExecutionResult = {
    status: result.status,
    events: result.events.map(validateHarnessExecutionEvent)
  };
  if (result.output !== undefined) {
    if (typeof result.output !== 'string') {
      throw new HarnessExecutionValidationError('result output must be a string');
    }
    normalized.output = result.output;
  }
  const metadata = safeMetadata(result.metadata, 'result');
  if (metadata !== undefined) normalized.metadata = metadata;
  return normalized;
}

function adapterSupports(capabilities: ProviderCapabilities, requiredCapabilities: readonly CapabilityName[]): boolean {
  return requiredCapabilities.every(capability => capabilities[capability] === true);
}

export function selectHarnessExecutionAdapter(adapters: readonly HarnessExecutionAdapter[], request: HarnessExecutionRequest, at = new Date()): HarnessExecutionAdapter {
  const validated = validateHarnessExecutionRequest(request, at);
  if (!validated.route.available || !adapterSupports(validated.route.capabilities, validated.requiredCapabilities)) {
    throw new NoEligibleHarnessAdapterError();
  }

  const eligible = adapters
    .map(candidate => ({
      candidate,
      id: requireStableIdentifier(candidate.id, 'adapter id'),
      harnessId: requireStableIdentifier(candidate.harnessId, 'adapter harnessId')
    }))
    .filter(({ candidate, harnessId }) => harnessId === validated.envelope.harnessId && adapterSupports(candidate.capabilities, validated.requiredCapabilities))
    .sort((left, right) => left.id.localeCompare(right.id));

  const selected = eligible[0]?.candidate;
  if (!selected) throw new NoEligibleHarnessAdapterError();
  return selected;
}

export async function executeHarnessRequest(adapters: readonly HarnessExecutionAdapter[], request: HarnessExecutionRequest, at = new Date()): Promise<HarnessExecutionResult> {
  const validated = validateHarnessExecutionRequest(request, at);
  const selected = selectHarnessExecutionAdapter(adapters, validated, at);
  const result = await selected.execute(validated);
  return validateHarnessExecutionResult(result);
}
