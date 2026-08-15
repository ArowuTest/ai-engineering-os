import { DomainValidationError, validateRunnerTaskEnvelope, type RunnerTaskEnvelope } from '@engineering-os/domain';
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
function requireCapabilityList(value: unknown): CapabilityName[] {
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

function requireOperationList(value: unknown): string[] {
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
  'passwd',
  'bearer',
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
  'passwd',
  'bearer',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'cookie',
  'cookies',
  'session',
  'sessionid',
  'providersession',
  'credential',
  'credentials',
  'secret',
  'secretkey',
  'secretaccesskey',
  'accesskey',
  'accesskeyid',
  'privatekey',
  'privatekeyid',
  'signingkey',
  'signingkeyid',
  'passphrase',
  'secretrefid',
  'authorization',
  'authorizationheader'
] as const;
const FORBIDDEN_METADATA_STRUCTURE_KEYS = new Set(['proto', 'prototype', 'constructor']);
const SAFE_OPERATIONAL_KEY_NAMES = new Set(['cachekey', 'idempotencykey', 'partitionkey', 'sortkey', 'primarykey', 'foreignkey', 'routingkey', 'dedupekey']);
const FORBIDDEN_METADATA_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'bearer',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'authorization',
  'credential',
  'privatekey',
  'secretkey',
  'secretaccesskey',
  'accesskeyid',
  'signingkey',
  'passphrase',
  'clientsecret',
  'providersession',
  'usersession',
  'sessionid',
  'tokenvalue',
  'tokensecret'
] as const;

function metadataKeyIsAsciiMachineKey(key: string): boolean {
  return key.length > 0 && key.length <= 128 && /^[\x20-\x7e]+$/.test(key);
}

function metadataKeyIsForbidden(key: string): boolean {
  const normalized = normalizedMetadataKey(key);
  if (FORBIDDEN_METADATA_KEYS.has(normalized)) return true;
  if (normalized.endsWith('key') && !SAFE_OPERATIONAL_KEY_NAMES.has(normalized)) return true;
  if (FORBIDDEN_METADATA_KEY_SUFFIXES.some(suffix => normalized.length >= suffix.length && normalized.endsWith(suffix))) {
    return true;
  }
  return FORBIDDEN_METADATA_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function metadataKeyIsStructurallyUnsafe(key: string): boolean {
  return FORBIDDEN_METADATA_STRUCTURE_KEYS.has(normalizedMetadataKey(key));
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
    const result = Object.create(null) as Record<string, HarnessMetadataValue>;
    for (const [key, item] of Object.entries(value)) {
      if (!metadataKeyIsAsciiMachineKey(key)) {
        throw new HarnessExecutionValidationError(`${path}.${key} metadata key must use printable ASCII`);
      }
      if (metadataKeyIsStructurallyUnsafe(key)) {
        throw new HarnessExecutionValidationError(`${path}.${key} is not allowed in metadata`);
      }
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

function requirePlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessExecutionValidationError(`${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new HarnessExecutionValidationError(`${field} must use a plain object`);
  }
  return value as Record<string, unknown>;
}

function requireObjectRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessExecutionValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}
function canonicalCapabilities(value: unknown, field: string): ProviderCapabilities {
  const record = requirePlainRecord(value, field);
  const capabilities = {} as ProviderCapabilities;
  for (const capability of CAPABILITY_NAMES) {
    if (typeof record[capability] !== 'boolean') {
      throw new HarnessExecutionValidationError(`${field}.${capability} must be boolean`);
    }
    capabilities[capability] = record[capability] as boolean;
  }
  return capabilities;
}
function canonicalModelRoute(route: unknown): ModelRoute {
  const record = requirePlainRecord(route, 'route');
  const id = requireStableIdentifier(record.id, 'route id');
  const provider = requireStableIdentifier(record.provider, 'route provider');
  if (provider === 'auto') {
    throw new HarnessExecutionValidationError('route provider cannot be auto');
  }
  const model = requireNonBlank(record.model, 'route model');
  const executionMode = record.executionMode;
  if (executionMode !== 'subscription' && executionMode !== 'api' && executionMode !== 'manual') {
    throw new HarnessExecutionValidationError('route executionMode is invalid');
  }
  const costType = record.costType;
  if (costType !== 'included_subscription' && costType !== 'provider_credit' && costType !== 'metered_api' && costType !== 'manual') {
    throw new HarnessExecutionValidationError('route costType is invalid');
  }
  if (typeof record.available !== 'boolean') {
    throw new HarnessExecutionValidationError('route available must be boolean');
  }
  if (typeof record.priority !== 'number' || !Number.isFinite(record.priority)) {
    throw new HarnessExecutionValidationError('route priority must be finite');
  }
  return {
    id,
    provider,
    model,
    executionMode,
    costType,
    available: record.available,
    priority: record.priority,
    capabilities: canonicalCapabilities(record.capabilities, 'route capabilities')
  };
}
export function validateHarnessExecutionRequest(request: HarnessExecutionRequest, at = new Date()): HarnessExecutionRequest {
  const now = requireDate(at, 'execution time');
  const requestRecord = requirePlainRecord(request, 'request');
  const envelopeRecord = requirePlainRecord(requestRecord.envelope, 'task envelope');
  let validatedEnvelope: RunnerTaskEnvelope;
  try {
    validatedEnvelope = validateRunnerTaskEnvelope(envelopeRecord as unknown as RunnerTaskEnvelope);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new HarnessExecutionValidationError(`task envelope is invalid: ${error.message}`);
    }
    throw error;
  }
  const taskEnvelope: RunnerTaskEnvelope = {
    ...validatedEnvelope,
    allowedOperations: [...validatedEnvelope.allowedOperations],
    issuedAt: new Date(validatedEnvelope.issuedAt.getTime()),
    expiresAt: new Date(validatedEnvelope.expiresAt.getTime())
  };
  const modelRoute = canonicalModelRoute(requestRecord.route);
  if (taskEnvelope.issuedAt.getTime() > now.getTime()) {
    throw new HarnessExecutionValidationError('task envelope has not been issued yet');
  }
  if (taskEnvelope.expiresAt.getTime() <= now.getTime()) {
    throw new HarnessExecutionValidationError('task envelope is expired');
  }
  if (modelRoute.id !== taskEnvelope.routeId) {
    throw new HarnessExecutionValidationError('route does not match task envelope route');
  }
  const workspaceScope = requireNonBlank(requestRecord.workspaceScope, 'workspaceScope');
  if (workspaceScope !== taskEnvelope.workspaceScope) {
    throw new HarnessExecutionValidationError('workspace scope exceeds or differs from task envelope scope');
  }
  const operations = requireOperationList(requestRecord.operations);
  for (const operation of operations) {
    if (!taskEnvelope.allowedOperations.includes(operation)) {
      throw new HarnessExecutionValidationError(`operation ${operation} is outside task envelope scope`);
    }
  }
  const requiredCapabilities = requireCapabilityList(requestRecord.requiredCapabilities);
  const instruction = requireNonBlank(requestRecord.instruction, 'instruction');

  return {
    envelope: taskEnvelope,
    route: modelRoute,
    requiredCapabilities,
    operations,
    workspaceScope,
    instruction
  };
}
function validateHarnessExecutionEvent(event: unknown): HarnessExecutionEvent {
  const record = requirePlainRecord(event, 'event');
  const type = record.type;
  if (type !== 'checkpoint' && type !== 'status') {
    throw new HarnessExecutionValidationError('execution event type must be checkpoint or status');
  }
  const at = new Date(requireDate(record.at, 'event.at').getTime());
  if (type === 'checkpoint') {
    const normalized: HarnessCheckpointEvent = {
      type: 'checkpoint',
      at,
      checkpointId: requireStableIdentifier(record.checkpointId, 'checkpointId')
    };
    const metadata = safeMetadata(record.metadata, 'checkpoint');
    if (metadata !== undefined) normalized.metadata = metadata;
    return normalized;
  }

  const allowedStatuses: readonly HarnessStatusEventState[] = ['starting', 'running', 'completed', 'failed', 'paused'];
  if (typeof record.status !== 'string' || !allowedStatuses.includes(record.status as HarnessStatusEventState)) {
    throw new HarnessExecutionValidationError('status event contains an unknown state');
  }
  const normalized: HarnessStatusEvent = {
    type: 'status',
    at,
    status: record.status as HarnessStatusEventState
  };
  const metadata = safeMetadata(record.metadata, 'status');
  if (metadata !== undefined) normalized.metadata = metadata;
  return normalized;
}

export function validateHarnessExecutionResult(result: HarnessExecutionResult): HarnessExecutionResult {
  const record = requirePlainRecord(result, 'result');
  const allowedStatuses: readonly HarnessExecutionStatus[] = ['completed', 'failed', 'paused'];
  if (typeof record.status !== 'string' || !allowedStatuses.includes(record.status as HarnessExecutionStatus)) {
    throw new HarnessExecutionValidationError('result contains an unknown status');
  }
  if (!Array.isArray(record.events)) {
    throw new HarnessExecutionValidationError('result events must be an array');
  }
  const normalized: HarnessExecutionResult = {
    status: record.status as HarnessExecutionStatus,
    events: record.events.map(validateHarnessExecutionEvent)
  };
  if (record.output !== undefined) {
    if (typeof record.output !== 'string') {
      throw new HarnessExecutionValidationError('result output must be a string');
    }
    normalized.output = record.output;
  }
  const metadata = safeMetadata(record.metadata, 'result');
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

  if (!Array.isArray(adapters)) {
    throw new HarnessExecutionValidationError('adapters must be an array');
  }
  const eligible = adapters
    .map((candidate, index) => {
      const record = requireObjectRecord(candidate, `adapter[${index}]`);
      const id = requireStableIdentifier(record.id, 'adapter id');
      const harnessId = requireStableIdentifier(record.harnessId, 'adapter harnessId');
      if (typeof record.execute !== 'function') {
        throw new HarnessExecutionValidationError(`adapter ${id} execute must be a function`);
      }
      return {
        candidate,
        id,
        harnessId,
        capabilities: canonicalCapabilities(record.capabilities, `adapter ${id} capabilities`)
      };
    })
    .filter(({ harnessId, capabilities }) => harnessId === validated.envelope.harnessId && adapterSupports(capabilities, validated.requiredCapabilities))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

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
