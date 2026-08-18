import { createHash } from 'node:crypto';
import { DomainValidationError, requireNonBlank, requireStableIdentifier } from './validation.js';

export const MEMORY_SCOPES = [
  'project', 'workstream', 'agent', 'session', 'review', 'user', 'organisation',
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_VISIBILITIES = [
  'session_private', 'workstream_shared', 'project_shared', 'organisation_shared',
  'reviewer_private', 'adjudication_shared', 'user_private',
] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

export const MEMORY_TRUST_STATES = [
  'unreviewed', 'verified', 'governed', 'superseded', 'rejected',
] as const;
export type MemoryTrustState = (typeof MEMORY_TRUST_STATES)[number];

export const MEMORY_KINDS = [
  'context', 'decision', 'fact', 'handoff', 'lesson', 'note', 'preference',
  'runbook', 'evidence', 'checkpoint', 'blocker',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SOURCE_TYPES = ['human', 'agent', 'ecc_import', 'review_council', 'system'] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];
export interface CreateCollaborativeMemoryRecordInput {
  id: string;
  organisationId?: string;
  projectId?: string;
  workstreamId?: string;
  scope: MemoryScope;
  visibility: MemoryVisibility;
  kind: MemoryKind;
  trust: MemoryTrustState;
  title: string;
  content: string;
  ownerUserId?: string;
  createdBy: string;
  sourceType: MemorySourceType;
  sourceAgentId?: string;
  sourceSessionId?: string;
  sourceHarnessId?: string;
  sourceSchema?: string;
  sourceDocumentDigest?: string;
  sourceReference?: string;
  tags?: string[];
  reviewerAssignmentId?: string;
  targetAgentIds?: string[];
  targetSessionIds?: string[];
  targetHarnessIds?: string[];
  createdAt: Date;
}

export interface CollaborativeMemoryRecord extends CreateCollaborativeMemoryRecordInput {
  contentDigest: string;
}

export const MEMORY_LINK_RELATIONS = ['supersedes', 'supports', 'relates_to', 'handoff_from', 'references'] as const;
export type MemoryLinkRelation = (typeof MEMORY_LINK_RELATIONS)[number];
export interface MemoryLink {
  sourceMemoryId: string;
  targetMemoryId: string;
  relation: MemoryLinkRelation;
}

export const ENGINEERING_SESSION_STATUSES = ['active', 'paused', 'completed', 'failed', 'cancelled'] as const;
export type EngineeringSessionStatus = (typeof ENGINEERING_SESSION_STATUSES)[number];

export interface EngineeringSession {
  id: string;
  organisationId: string;
  projectId: string;
  workstreamId?: string;
  taskId: string;
  agentId: string;
  status: EngineeringSessionStatus;
  harnessId?: string;
  modelRouteId?: string;
  runnerId?: string;
  environmentId?: string;
  workspaceReference?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEngineeringSessionInput {
  id: string;
  organisationId: string;
  projectId: string;
  workstreamId?: string;
  taskId: string;
  agentId: string;
  harnessId?: string;
  modelRouteId?: string;
  runnerId?: string;
  environmentId?: string;
  workspaceReference?: string;
  createdBy: string;
  createdAt: Date;
}
export interface AgentHandoff {
  id: string;
  organisationId: string;
  projectId: string;
  sourceSessionId: string;
  sourceAgentId: string;
  targetSessionIds: string[];
  targetAgentIds: string[];
  summary: string;
  evidenceReferences: string[];
  blockers: string[];
  sourceCommit?: string;
  workspaceReference?: string;
  createdBy: string;
  createdAt: Date;
}

export interface MemoryAccessContext {
  organisationId?: string;
  projectId?: string;
  workstreamId?: string;
  sessionId?: string;
  userId?: string;
  agentId?: string;
  harnessId?: string;
  reviewerAssignmentId?: string;
  reviewPhase?: 'normal' | 'blind_collecting' | 'adjudicating';
  canAdjudicate?: boolean;
  projectAuthorized: boolean;
  organisationAuthorized: boolean;
}

const PROJECT_SCOPES = new Set<MemoryScope>(['project', 'workstream', 'agent', 'session', 'review']);
const MAX_MEMORY_CONTENT_BYTES = 65_536;
const MAX_MEMORY_TITLE_LENGTH = 512;
const ECC_MEMORY_IDENTIFIER_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
function requireEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DomainValidationError(field, `${field} must be a supported value`);
  }
  return value as T;
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DomainValidationError(field, `${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function requireMemoryIdentifier(value: unknown, field: string): string {
  if (typeof value === 'string' && ECC_MEMORY_IDENTIFIER_PATTERN.test(value)) return value;
  return requireStableIdentifier(value, field);
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireStableIdentifier(value, field);
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new DomainValidationError(field, field + ' must be a lowercase SHA-256 digest');
  }
  return value;
}


function identifierList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new DomainValidationError(field, `${field} must be an array`);
  const result = value.map((item, index) => requireStableIdentifier(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new DomainValidationError(field, `${field} must not contain duplicates`);
  }
  return result;
}

function tagList(value: unknown): string[] | undefined {
  const tags = identifierList(value, 'tags');
  if (tags !== undefined && tags.length > 32) {
    throw new DomainValidationError('tags', 'tags has too many values');
  }
  return tags;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(field, `${field} must be an array`);
  const result = value.map((item, index) => requireNonBlank(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) throw new DomainValidationError(field, `${field} must not contain duplicates`);
  return result;
}
function requireSafeText(value: unknown, field: string, maxLength: number, utf8Bytes = false): string {
  const normalized = requireNonBlank(value, field);
  const measuredLength = utf8Bytes ? Buffer.byteLength(normalized, 'utf8') : normalized.length;
  if (measuredLength > maxLength) {
    throw new DomainValidationError(field, `${field} is too long`);
  }
  assertMemoryTextSafe(normalized, field);
  return normalized;
}

function assertMemoryTextSafe(value: string, field: string): void {
  const privateKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
  const bearer = /\b(?:authorization\s*:\s*)?bearer\s+\S{16,}/i;
  const assignedSecret = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key)\s*[:=]\s*\S{8,}/i;
  if (privateKey.test(value) || bearer.test(value) || assignedSecret.test(value)) {
    throw new DomainValidationError(field, `${field} contains secret or credential-like content`);
  }
}

export function digestMemoryContent(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function validateMemoryScope(input: CreateCollaborativeMemoryRecordInput): void {
  if (PROJECT_SCOPES.has(input.scope) && (!input.organisationId || !input.projectId)) {
    throw new DomainValidationError('projectId', `${input.scope} memory requires organisationId and projectId`);
  }
  if (input.scope === 'user' && (input.visibility !== 'user_private' || !input.ownerUserId)) {
    throw new DomainValidationError('ownerUserId', 'user memory requires user_private visibility and ownerUserId');
  }
  if (input.scope === 'organisation' && !input.organisationId) {
    throw new DomainValidationError('organisationId', 'organisation memory requires organisationId');
  }
}
function validateMemoryVisibility(input: CreateCollaborativeMemoryRecordInput): void {
  if (input.visibility === 'session_private' && !input.sourceSessionId) {
    throw new DomainValidationError('sourceSessionId', 'session_private memory requires sourceSessionId');
  }
  if (input.visibility === 'workstream_shared' && !input.workstreamId) {
    throw new DomainValidationError('workstreamId', 'workstream_shared memory requires workstreamId');
  }
  if (input.visibility === 'reviewer_private' && (input.scope !== 'review' || !input.reviewerAssignmentId)) {
    throw new DomainValidationError('reviewerAssignmentId', 'reviewer_private memory requires review scope and assignment');
  }
  if (input.visibility === 'adjudication_shared' && input.scope !== 'review') {
    throw new DomainValidationError('visibility', 'adjudication_shared memory requires review scope');
  }
  if (input.visibility === 'project_shared' && !input.projectId) {
    throw new DomainValidationError('projectId', 'project_shared memory requires projectId');
  }
  if (input.visibility === 'organisation_shared' && !input.organisationId) {
    throw new DomainValidationError('organisationId', 'organisation_shared memory requires organisationId');
  }
  if (input.visibility === 'user_private' && !input.ownerUserId) {
    throw new DomainValidationError('ownerUserId', 'user_private memory requires ownerUserId');
  }
}

export function createCollaborativeMemoryRecord(input: CreateCollaborativeMemoryRecordInput): CollaborativeMemoryRecord {
  const scope = requireEnum(input.scope, MEMORY_SCOPES, 'scope');
  const visibility = requireEnum(input.visibility, MEMORY_VISIBILITIES, 'visibility');
  const kind = requireEnum(input.kind, MEMORY_KINDS, 'kind');
  const trust = requireEnum(input.trust, MEMORY_TRUST_STATES, 'trust');
  const sourceType = requireEnum(input.sourceType, MEMORY_SOURCE_TYPES, 'sourceType');
  if (sourceType === 'ecc_import' && (input.sourceSchema === undefined || input.sourceDocumentDigest === undefined)) {
    throw new DomainValidationError('sourceDocumentDigest', 'ECC import provenance requires source schema and source document digest');
  }
  validateMemoryScope({ ...input, scope, visibility, kind, trust, sourceType });
  validateMemoryVisibility({ ...input, scope, visibility, kind, trust, sourceType });
  const content = requireSafeText(input.content, 'content', MAX_MEMORY_CONTENT_BYTES, true);
  const title = requireSafeText(input.title, 'title', MAX_MEMORY_TITLE_LENGTH);
  const record: CollaborativeMemoryRecord = {
    id: requireMemoryIdentifier(input.id, 'id'),
    scope, visibility, kind, trust, title, content,
    contentDigest: digestMemoryContent(content),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    sourceType,
    createdAt: requireDate(input.createdAt, 'createdAt'),
  };
  const optionals: Array<[keyof CollaborativeMemoryRecord, string | undefined]> = [
    ['organisationId', optionalIdentifier(input.organisationId, 'organisationId')],
    ['projectId', optionalIdentifier(input.projectId, 'projectId')],
    ['workstreamId', optionalIdentifier(input.workstreamId, 'workstreamId')],
    ['ownerUserId', optionalIdentifier(input.ownerUserId, 'ownerUserId')],
    ['sourceAgentId', optionalIdentifier(input.sourceAgentId, 'sourceAgentId')],
    ['sourceSessionId', optionalIdentifier(input.sourceSessionId, 'sourceSessionId')],
    ['sourceHarnessId', optionalIdentifier(input.sourceHarnessId, 'sourceHarnessId')],
    ['reviewerAssignmentId', optionalIdentifier(input.reviewerAssignmentId, 'reviewerAssignmentId')],
  ];
  for (const [key, value] of optionals) {
    if (value !== undefined) (record as unknown as Record<string, unknown>)[key] = value;
  }
  if (input.sourceSchema !== undefined) record.sourceSchema = requireStableIdentifier(input.sourceSchema, 'sourceSchema');
  if (input.sourceDocumentDigest !== undefined) {
    record.sourceDocumentDigest = requireSha256(input.sourceDocumentDigest, 'sourceDocumentDigest');
  }
  if (input.sourceReference !== undefined) {
    record.sourceReference = requireSafeText(input.sourceReference, 'sourceReference', 4096);
  }
  const tags = tagList(input.tags);
  if (tags !== undefined) record.tags = tags;
  for (const [key, value] of [
    ['targetAgentIds', identifierList(input.targetAgentIds, 'targetAgentIds')],
    ['targetSessionIds', identifierList(input.targetSessionIds, 'targetSessionIds')],
    ['targetHarnessIds', identifierList(input.targetHarnessIds, 'targetHarnessIds')],
  ] as const) {
    if (value !== undefined && value.length > 0) (record as unknown as Record<string, unknown>)[key] = value;
  }
  return record;
}

export function createMemoryLink(input: MemoryLink): MemoryLink {
  const sourceMemoryId = requireMemoryIdentifier(input.sourceMemoryId, 'sourceMemoryId');
  const targetMemoryId = requireMemoryIdentifier(input.targetMemoryId, 'targetMemoryId');
  if (sourceMemoryId === targetMemoryId) throw new DomainValidationError('targetMemoryId', 'memory cannot link to itself');
  return { sourceMemoryId, targetMemoryId, relation: requireEnum(input.relation, MEMORY_LINK_RELATIONS, 'relation') };
}
export function createEngineeringSession(input: CreateEngineeringSessionInput): EngineeringSession {
  const createdAt = requireDate(input.createdAt, 'createdAt');
  const session: EngineeringSession = {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    projectId: requireStableIdentifier(input.projectId, 'projectId'),
    taskId: requireStableIdentifier(input.taskId, 'taskId'),
    agentId: requireStableIdentifier(input.agentId, 'agentId'),
    status: 'active',
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
    updatedAt: createdAt,
  };
  for (const [key, value] of [
    ['workstreamId', input.workstreamId], ['harnessId', input.harnessId],
    ['modelRouteId', input.modelRouteId], ['runnerId', input.runnerId],
    ['environmentId', input.environmentId], ['workspaceReference', input.workspaceReference],
  ] as const) {
    if (value === undefined) continue;
    (session as unknown as Record<string, unknown>)[key] = key === 'workspaceReference'
      ? requireNonBlank(value, key)
      : requireStableIdentifier(value, key);
  }
  return session;
}

export function rebindEngineeringSessionExecution(
  session: EngineeringSession,
  input: {
    harnessId?: string; modelRouteId?: string; runnerId?: string; environmentId?: string;
    workspaceReference?: string; updatedAt: Date;
  },
): EngineeringSession {
  const updatedAt = requireDate(input.updatedAt, 'updatedAt');
  if (updatedAt.getTime() <= session.updatedAt.getTime()) {
    throw new DomainValidationError('updatedAt', 'updatedAt must advance current session state');
  }
  const rebound: EngineeringSession = { ...session, updatedAt };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'updatedAt' || value === undefined) continue;
    (rebound as unknown as Record<string, unknown>)[key] = key === 'workspaceReference'
      ? requireNonBlank(value, key)
      : requireStableIdentifier(value, key);
  }
  return rebound;
}
export function createAgentHandoff(input: AgentHandoff): AgentHandoff {
  const summary = requireSafeText(input.summary, 'summary', 16_384);
  const evidenceReferences = stringList(input.evidenceReferences, 'evidenceReferences');
  const blockers = stringList(input.blockers, 'blockers');
  const handoff: AgentHandoff = {
    id: requireStableIdentifier(input.id, 'id'),
    organisationId: requireStableIdentifier(input.organisationId, 'organisationId'),
    projectId: requireStableIdentifier(input.projectId, 'projectId'),
    sourceSessionId: requireStableIdentifier(input.sourceSessionId, 'sourceSessionId'),
    sourceAgentId: requireStableIdentifier(input.sourceAgentId, 'sourceAgentId'),
    targetSessionIds: identifierList(input.targetSessionIds, 'targetSessionIds') ?? [],
    targetAgentIds: identifierList(input.targetAgentIds, 'targetAgentIds') ?? [],
    summary,
    evidenceReferences,
    blockers,
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt: requireDate(input.createdAt, 'createdAt'),
  };
  if (handoff.targetSessionIds.length === 0 && handoff.targetAgentIds.length === 0) {
    throw new DomainValidationError('targetSessionIds', 'handoff requires a target session or agent');
  }
  if (input.sourceCommit !== undefined) handoff.sourceCommit = requireNonBlank(input.sourceCommit, 'sourceCommit');
  if (input.workspaceReference !== undefined) {
    handoff.workspaceReference = requireNonBlank(input.workspaceReference, 'workspaceReference');
  }
  return handoff;
}

function sameTenantProject(record: CollaborativeMemoryRecord, context: MemoryAccessContext): boolean {
  if (record.organisationId !== undefined && record.organisationId !== context.organisationId) return false;
  if (record.projectId !== undefined && record.projectId !== context.projectId) return false;
  return true;
}

export function collaborativeMemoryTargetsAllow(record: CollaborativeMemoryRecord, context: Pick<MemoryAccessContext, 'agentId' | 'sessionId' | 'harnessId'>): boolean {
  if (record.targetAgentIds && record.targetAgentIds.length > 0 && !record.targetAgentIds.includes(context.agentId ?? '')) return false;
  if (record.targetSessionIds && record.targetSessionIds.length > 0 && !record.targetSessionIds.includes(context.sessionId ?? '')) return false;
  if (record.targetHarnessIds && record.targetHarnessIds.length > 0 && !record.targetHarnessIds.includes(context.harnessId ?? '')) return false;
  return true;
}
export function canRecallCollaborativeMemory(
  record: CollaborativeMemoryRecord,
  context: MemoryAccessContext,
): boolean {
  if (record.trust === 'rejected' || record.trust === 'superseded') return false;
  if (!collaborativeMemoryTargetsAllow(record, context)) return false;
  if (record.visibility === 'user_private') return record.ownerUserId === context.userId;
  if (!sameTenantProject(record, context)) return false;

  switch (record.visibility) {
    case 'session_private':
      return context.projectAuthorized && record.sourceSessionId === context.sessionId;
    case 'workstream_shared':
      return context.projectAuthorized && record.workstreamId === context.workstreamId;
    case 'project_shared':
      return context.projectAuthorized;
    case 'organisation_shared':
      return context.organisationAuthorized;
    case 'reviewer_private':
      return context.projectAuthorized && context.reviewPhase === 'blind_collecting' &&
        record.reviewerAssignmentId === context.reviewerAssignmentId;
    case 'adjudication_shared':
      return context.projectAuthorized && context.reviewPhase === 'adjudicating' && context.canAdjudicate === true;
  }
}
