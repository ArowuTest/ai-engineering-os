import { describe, expect, it } from 'vitest';
import {
  STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS,
  createStudioInteractionArtifact,
  validateStudioArtifactDeclaration,
} from '../src/index.js';

const base = {
  organisationId: 'org-001',
  projectId: '11111111-1111-4111-8111-111111111111',
  storageReference: 'objects/org-001/project-001/audio/input.webm',
  digestSha256: 'a'.repeat(64),
  mediaType: 'audio/webm',
  byteSize: 4096,
  visibility: 'project' as const,
  retentionPolicy: 'project_default' as const,
  createdBy: '22222222-2222-4222-8222-222222222222',
  createdAt: new Date('2026-08-20T03:30:00.000Z'),
};

describe('Studio interaction artifact', () => {
  it('creates governed microphone metadata without embedding the media bytes', () => {
    const record = createStudioInteractionArtifact({
      ...base, kind: 'audio', source: 'microphone', contextText: 'transcribed instruction',
    });
    expect(record).toMatchObject({
      kind: 'audio', source: 'microphone', mediaType: 'audio/webm', byteSize: 4096,
      contextText: 'transcribed instruction', visibility: 'project', retentionPolicy: 'project_default',
    });
    expect(record).not.toHaveProperty('bytes');
  });

  it('rejects capture modes that do not match the governed media kind', () => {
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'image', source: 'microphone', mediaType: 'image/png',
    })).toThrow(/microphone/i);
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'audio', source: 'screenshot', mediaType: 'audio/webm',
    })).toThrow(/screenshot/i);
  });

  it('validates source kind and media declaration before any storage or normalization work', () => {
    expect(validateStudioArtifactDeclaration({
      kind: 'audio', source: 'microphone', mediaType: 'audio/webm',
    })).toEqual({ kind: 'audio', source: 'microphone', mediaType: 'audio/webm' });
    expect(() => validateStudioArtifactDeclaration({
      kind: 'image', source: 'microphone', mediaType: 'image/png',
    })).toThrow(/microphone/i);
    expect(() => validateStudioArtifactDeclaration({
      kind: 'image', source: 'upload', mediaType: 'audio\/webm',
    })).toThrow(/mediaType/i);
  });

  it('requires a canonical sha256 digest for immutable provenance', () => {
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'audio', source: 'microphone', digestSha256: 'not-a-digest',
    })).toThrow(/digest/i);
  });

  it('bounds derived transcript/context text rather than storing unbounded payloads', () => {
    expect(() => createStudioInteractionArtifact({
      ...base,
      kind: 'audio',
      source: 'microphone',
      contextText: 'x'.repeat(STUDIO_ARTIFACT_MAX_CONTEXT_TEXT_CHARS + 1),
    })).toThrow(/contextText/i);
  });

  it('fails closed when declared media type does not match the governed artifact kind', () => {
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'image', source: 'upload', mediaType: 'audio/webm',
    })).toThrow(/mediaType/i);
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'video', source: 'upload', mediaType: 'image/png',
    })).toThrow(/mediaType/i);
    expect(() => createStudioInteractionArtifact({
      ...base, kind: 'document', source: 'upload', mediaType: 'application/octet-stream',
    })).toThrow(/mediaType/i);
  });

  it('accepts governed document, image, audio and video media families', () => {
    expect(() => createStudioInteractionArtifact({ ...base, kind: 'image', source: 'upload', mediaType: 'image/png' })).not.toThrow();
    expect(() => createStudioInteractionArtifact({ ...base, kind: 'audio', source: 'upload', mediaType: 'audio/webm' })).not.toThrow();
    expect(() => createStudioInteractionArtifact({ ...base, kind: 'video', source: 'upload', mediaType: 'video/webm' })).not.toThrow();
    expect(() => createStudioInteractionArtifact({ ...base, kind: 'document', source: 'upload', mediaType: 'application/pdf' })).not.toThrow();
    expect(() => createStudioInteractionArtifact({ ...base, kind: 'document', source: 'upload', mediaType: 'text/plain' })).not.toThrow();
  });

  it('rejects secret-like derived context before it can enter model context', () => {
    for (const contextText of [
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      'api_key=sk-super-secret-value-12345',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    ]) {
      expect(() => createStudioInteractionArtifact({
        ...base, kind: 'audio', source: 'microphone', contextText,
      })).toThrow(/secret|credential/i);
    }
  });
});