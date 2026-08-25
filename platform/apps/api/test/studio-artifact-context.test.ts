import { describe, expect, it } from 'vitest';
import {
  StudioArtifactContextError,
  materializeStudioArtifactContext,
  type StudioArtifactSemanticNormalizer,
} from '../src/studio-artifact-context.js';

function semantic(output: string, calls: Array<Record<string, unknown>>): StudioArtifactSemanticNormalizer {
  return {
    async normalize(input) {
      calls.push(input as unknown as Record<string, unknown>);
      return output;
    },
  };
}

describe('Studio artifact context materialization', () => {
  it('materializes plain text and JSON locally without an external model', async () => {
    await expect(materializeStudioArtifactContext({
      kind: 'document', source: 'upload', mediaType: 'text/plain',
      data: Buffer.from('  checkout retry rules  ', 'utf8'),
    })).resolves.toBe('checkout retry rules');
    await expect(materializeStudioArtifactContext({
      kind: 'document', source: 'upload', mediaType: 'application/json',
      data: Buffer.from('{"retry":3}', 'utf8'),
    })).resolves.toBe('{"retry":3}');
  });

  it('uses the semantic normalizer for microphone, image and binary document content', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const normalizer = semantic('derived context', calls);
    for (const input of [
      { kind: 'audio' as const, source: 'microphone' as const, mediaType: 'audio/webm' },
      { kind: 'image' as const, source: 'screenshot' as const, mediaType: 'image/png' },
      { kind: 'document' as const, source: 'upload' as const, mediaType: 'application/pdf' },
    ]) {
      await expect(materializeStudioArtifactContext({
        ...input, data: Buffer.from('binary-payload'), normalizer,
      })).resolves.toBe('derived context');
    }
    expect(calls).toHaveLength(3);
  });

  it('fails closed when binary semantic normalization is unavailable', async () => {
    await expect(materializeStudioArtifactContext({
      kind: 'audio', source: 'microphone', mediaType: 'audio/webm', data: Buffer.from('voice'),
    })).rejects.toMatchObject({ code: 'normalizer_unavailable' });
  });

  it('rejects invalid UTF-8 and blank normalizer output instead of silently discarding it', async () => {
    await expect(materializeStudioArtifactContext({
      kind: 'document', source: 'upload', mediaType: 'text/plain',
      data: Uint8Array.from([0xc3, 0x28]),
    })).rejects.toBeInstanceOf(StudioArtifactContextError);

    await expect(materializeStudioArtifactContext({
      kind: 'image', source: 'upload', mediaType: 'image/png', data: Buffer.from('image'),
      normalizer: semantic('   ', []),
    })).rejects.toMatchObject({ code: 'normalization_failed' });
  });

  it('bounds context materialization before it reaches a Product Partner request', async () => {
    const output = 'x'.repeat(20_000);
    const context = await materializeStudioArtifactContext({
      kind: 'image', source: 'upload', mediaType: 'image/png', data: Buffer.from('image'),
      normalizer: semantic(output, []),
    });
    expect(context.length).toBe(16_384);
  });
});
