import { randomUUID } from 'node:crypto';
import { assertSensitiveTextSafe, DomainValidationError, requireNonBlank } from './validation.js';

export const STUDIO_ARTIFACT_KINDS = ['document', 'image', 'audio', 'video'] as const;
export type StudioArtifactKind = (typeof STUDIO_ARTIFACT_KINDS)[number];

export const STUDIO_ARTIFACT_SOURCES = [
  'upload', 'microphone', 'screenshot', 'screen_recording',
] as const;
export type StudioArtifactSource = (typeof STUDIO_ARTIFACT_SOURCES)[number];

export const STUDIO_ARTIFACT_VISIBILITIES = ['project'] as const;
export type StudioArtifactVisibility = (typeof STUDIO_ARTIFACT_VISIBILITIES)[number];

export const STUDIO_ARTIFACT_RETENTION_POLICIES = ['project_default', 'ephemeral'] as const;
export type StudioArtifactRetentionPolicy = (typeof STUDIO_ARTIFACT_RETENTION_POLICIES)[number];

export const STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS = 16_384;

export interface StudioInteractionArtifact {
  id: string;
  organisationId: string;
  projectId: string;
  kind: StudioArtifactKind;
  source: StudioArtifactSource;
  storageReference: string;
  digestSha256: string;
  mediaType: string;  byteSize: number;
  contextText?: string;
  visibility: StudioArtifactVisibility;
  retentionPolicy: StudioArtifactRetentionPolicy;
  createdBy: string;
  createdAt: Date;
}

export interface CreateStudioInteractionArtifactInput {
  id?: string;
  organisationId: string;
  projectId: string;
  kind: StudioArtifactKind;
  source: StudioArtifactSource;
  storageReference: string;
  digestSha256: string;
  mediaType: string;
  byteSize: number;
  contextText?: string;
  visibility: StudioArtifactVisibility;
  retentionPolicy: StudioArtifactRetentionPolicy;
  createdBy: string;
  createdAt?: Date;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
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

function requireBoundedString(value: unknown, field: string, maxLength: number): string {
  const normalized = requireNonBlank(value, field);
  if (normalized.length > maxLength) {
    throw new DomainValidationError(field, `${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new DomainValidationError('digestSha256', 'digestSha256 must be a lowercase sha256 hex digest');
  }
  return value;
}

function requireByteSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError('byteSize', 'byteSize must be a positive safe integer');
  }
  return value;
}

function requireSourceKindCompatibility(source: StudioArtifactSource, kind: StudioArtifactKind): void {
  const requiredKind = source === 'microphone' ? 'audio'
    : source === 'screenshot' ? 'image'
    : source === 'screen_recording' ? 'video'
    : undefined;
  if (requiredKind !== undefined && kind !== requiredKind) {
    throw new DomainValidationError('source', `${source} artifacts must use kind ${requiredKind}`);
  }
}

const DOCUMENT_MEDIA_TYPES = new Set([
  'application/pdf', 'application/json', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function requireMediaTypeForKind(value: unknown, kind: StudioArtifactKind): string {
  const mediaType = requireBoundedString(value, 'mediaType', 256).toLowerCase();
  const matches = kind === 'image' ? mediaType.startsWith('image/')
    : kind === 'audio' ? mediaType.startsWith('audio/')
    : kind === 'video' ? mediaType.startsWith('video/')
    : mediaType.startsWith('text/') || DOCUMENT_MEDIA_TYPES.has(mediaType);
  if (!matches) throw new DomainValidationError('mediaType', `mediaType is not supported for ${kind}`);
  return mediaType;
}

export interface StudioArtifactDeclaration {
  kind: StudioArtifactKind;
  source: StudioArtifactSource;
  mediaType: string;
}

export function validateStudioArtifactDeclaration(input: {
  kind: unknown;
  source: unknown;
  mediaType: unknown;
}): StudioArtifactDeclaration {
  const kind = requireEnum(input.kind, 'kind', STUDIO_ARTIFACT_KINDS);
  const source = requireEnum(input.source, 'source', STUDIO_ARTIFACT_SOURCES);
  requireSourceKindCompatibility(source, kind);
  return {
    kind,
    source,
    mediaType: requireMediaTypeForKind(input.mediaType, kind),
  };
}

export function createStudioInteractionArtifact(
  input: CreateStudioInteractionArtifactInput,
): StudioInteractionArtifact {
  const declaration = validateStudioArtifactDeclaration(input);
  const { kind, source, mediaType } = declaration;
  const createdAt = requireDate(input.createdAt ?? new Date(), 'createdAt');
  const record: StudioInteractionArtifact = {
    id: input.id ?? randomUUID(),
    organisationId: requireNonBlank(input.organisationId, 'organisationId'),
    projectId: requireNonBlank(input.projectId, 'projectId'),
    kind,
    source,
    storageReference: requireBoundedString(input.storageReference, 'storageReference', 2048),
    digestSha256: requireDigest(input.digestSha256),
    mediaType,
    byteSize: requireByteSize(input.byteSize),
    visibility: requireEnum(input.visibility, 'visibility', STUDIO_ARTIFACT_VISIBILITIES),
    retentionPolicy: requireEnum(
      input.retentionPolicy, 'retentionPolicy', STUDIO_ARTIFACT_RETENTION_POLICIES,
    ),
    createdBy: requireNonBlank(input.createdBy, 'createdBy'),
    createdAt,
  };
  if (input.contextText !== undefined) {
    const contextText = requireBoundedString(
      input.contextText, 'contextText', STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS,
    );
    assertSensitiveTextSafe(contextText, 'contextText');
    record.contextText = contextText;
  }
  return record;
}
