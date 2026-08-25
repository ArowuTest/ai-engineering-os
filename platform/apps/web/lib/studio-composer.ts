export type StudioComposerArtifactKind = 'document' | 'image' | 'audio' | 'video';
export type StudioComposerArtifactSource = 'upload' | 'microphone' | 'screenshot' | 'screen_recording';

const DOCUMENT_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export function normalizeStudioSelectionValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized === '' || normalized === 'auto' ? undefined : normalized;
}

export function studioArtifactKindForMediaType(mediaType: string): StudioComposerArtifactKind {
  const normalized = mediaType.trim().toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('video/')) return 'video';  if (normalized.startsWith('text/') || DOCUMENT_MEDIA_TYPES.has(normalized)) return 'document';
  throw new Error(`Unsupported Studio artifact media type: ${normalized || 'unknown'}`);
}

export function assertStudioArtifactSourceKind(
  source: StudioComposerArtifactSource,
  kind: StudioComposerArtifactKind,
): void {
  const requiredKind = source === 'microphone' ? 'audio'
    : source === 'screenshot' ? 'image'
    : source === 'screen_recording' ? 'video'
    : undefined;
  if (requiredKind !== undefined && kind !== requiredKind) {
    throw new Error(`${source} Studio artifacts must use kind ${requiredKind}`);
  }
}

export function assertStudioArtifactCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > 16) {
    throw new Error('A Studio turn supports between 0 and 16 artifacts');
  }
}
export const STUDIO_TURN_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function assertStudioArtifactBytes(byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > STUDIO_TURN_MAX_UPLOAD_BYTES) {
    throw new Error('A Studio turn supports at most 25 MiB of uploaded artifacts');
  }
}

export interface StudioModelRouteGroupingInput {
  id: string;
  provider: string;
  model: string;
  connection?: {
    id: string;
    ownerType: 'platform' | 'organisation' | 'team' | 'user';
    ownerId?: string;
  };
}

export interface StudioModelRouteGroup<T extends StudioModelRouteGroupingInput = StudioModelRouteGroupingInput> {
  key: string;
  label: string;
  routes: T[];
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
};

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_LABELS[normalized]
    ?? normalized
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
    ?? provider;
}

export function groupStudioModelRoutes<T extends StudioModelRouteGroupingInput>(
  routes: readonly T[],
): StudioModelRouteGroup<T>[] {
  const managed: T[] = [];
  const organisation: T[] = [];
  const team: T[] = [];
  const personalByProvider = new Map<string, T[]>();

  for (const route of routes) {
    const ownerType = route.connection?.ownerType;
    if (ownerType === 'user') {
      const key = route.provider.trim().toLowerCase();
      const existing = personalByProvider.get(key) ?? [];
      existing.push(route);
      personalByProvider.set(key, existing);
    } else if (ownerType === 'organisation') {
      organisation.push(route);
    } else if (ownerType === 'team') {
      team.push(route);
    } else {
      managed.push(route);
    }
  }

  const groups: StudioModelRouteGroup<T>[] = [];
  if (managed.length > 0) groups.push({ key: 'managed', label: 'AIOS Managed', routes: managed });
  for (const provider of [...personalByProvider.keys()].sort()) {
    groups.push({
      key: `personal:${provider}`,
      label: `My ${providerLabel(provider)}`,
      routes: personalByProvider.get(provider) ?? [],
    });
  }
  if (organisation.length > 0) {
    groups.push({ key: 'organisation', label: 'Organisation Models', routes: organisation });
  }
  if (team.length > 0) groups.push({ key: 'team', label: 'Team Models', routes: team });
  return groups;
}
