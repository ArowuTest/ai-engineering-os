import {
  STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS,
  assertSensitiveTextSafe,
  type StudioArtifactKind,
  type StudioArtifactSource,
} from '@engineering-os/domain';

export type StudioArtifactContextErrorCode =
  | 'invalid_payload'
  | 'invalid_text_encoding'
  | 'normalizer_unavailable'
  | 'normalization_failed';

export class StudioArtifactContextError extends Error {
  constructor(
    readonly code: StudioArtifactContextErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StudioArtifactContextError';
  }
}

export interface StudioArtifactSemanticNormalizerInput {
  kind: StudioArtifactKind;
  source: StudioArtifactSource;
  mediaType: string;
  data: Uint8Array;
}

export interface StudioArtifactSemanticNormalizer {
  normalize(input: StudioArtifactSemanticNormalizerInput): Promise<string>;
}

export interface MaterializeStudioArtifactContextInput extends StudioArtifactSemanticNormalizerInput {
  normalizer?: StudioArtifactSemanticNormalizer;
}

function normalizeContextText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new StudioArtifactContextError('normalization_failed', 'Artifact context is blank');
  }
  const bounded = normalized.slice(0, STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS);
  assertSensitiveTextSafe(bounded, 'contextText');
  return bounded;
}

function localTextMediaType(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase();
  return normalized.startsWith('text/') || normalized === 'application/json';
}

function decodeUtf8(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (error) {
    throw new StudioArtifactContextError(
      'invalid_text_encoding', 'Artifact text is not valid UTF-8', { cause: error },
    );
  }
}

export async function materializeStudioArtifactContext(
  input: MaterializeStudioArtifactContextInput,
): Promise<string> {
  if (!(input.data instanceof Uint8Array) || input.data.byteLength <= 0) {
    throw new StudioArtifactContextError('invalid_payload', 'Artifact payload must not be empty');
  }

  if (input.kind === 'document' && localTextMediaType(input.mediaType)) {
    return normalizeContextText(decodeUtf8(input.data));
  }

  if (!input.normalizer) {
    throw new StudioArtifactContextError(
      'normalizer_unavailable',
      `No semantic normalizer is configured for ${input.kind}/${input.mediaType}`,
    );
  }

  try {
    return normalizeContextText(await input.normalizer.normalize(input));
  } catch (error) {
    if (error instanceof StudioArtifactContextError) throw error;
    throw new StudioArtifactContextError(
      'normalization_failed', 'Artifact semantic normalization failed', { cause: error },
    );
  }
}
