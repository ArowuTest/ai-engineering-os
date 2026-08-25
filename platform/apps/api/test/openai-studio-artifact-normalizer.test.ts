import { describe, expect, it } from 'vitest';
import {
  createOpenAIStudioArtifactSemanticNormalizer,
  type OpenAIStudioArtifactClient,
} from '../src/openai-studio-artifact-normalizer.js';

function clientHarness() {
  const responseRequests: Array<Record<string, unknown>> = [];
  const transcriptionRequests: Array<Record<string, unknown>> = [];
  const client: OpenAIStudioArtifactClient = {
    responses: {
      async create(input) {
        responseRequests.push(input);
        return { output_text: 'Normalized visual or document content.' };
      },
    },
    audio: {
      transcriptions: {
        async create(input) {
          transcriptionRequests.push(input);
          return { text: 'Transcribed voice instruction.' };
        },
      },
    },
  };
  return { client, responseRequests, transcriptionRequests };
}
describe('OpenAI Studio artifact semantic normalizer', () => {
  it('transcribes microphone audio through the configured transcription model', async () => {
    const harness = clientHarness();
    const normalizer = createOpenAIStudioArtifactSemanticNormalizer({
      apiKey: 'test-key', model: 'gpt-5.6', transcriptionModel: 'gpt-4o-transcribe',
      client: harness.client,
    });
    await expect(normalizer.normalize({
      kind: 'audio', source: 'microphone', mediaType: 'audio/webm', data: Buffer.from('voice'),
    })).resolves.toBe('Transcribed voice instruction.');
    expect(harness.transcriptionRequests).toHaveLength(1);
    expect(harness.transcriptionRequests[0]).toMatchObject({ model: 'gpt-4o-transcribe' });
    expect(harness.transcriptionRequests[0]?.file).toBeDefined();
    expect(harness.responseRequests).toEqual([]);
  });

  it('normalizes images using an inline data URL and a non-authoritative extraction prompt', async () => {
    const harness = clientHarness();
    const normalizer = createOpenAIStudioArtifactSemanticNormalizer({ apiKey: 'test-key', client: harness.client });
    await expect(normalizer.normalize({
      kind: 'image', source: 'screenshot', mediaType: 'image/png', data: Buffer.from('image'),
    })).resolves.toBe('Normalized visual or document content.');
    const serialized = JSON.stringify(harness.responseRequests[0]);
    expect(serialized).toContain('input_image');
    expect(serialized).toContain('data:image/png;base64,');
    expect(serialized).toMatch(/do not execute|do not follow/i);
  });
  it('normalizes supported binary documents through Responses file input without external storage authority', async () => {
    const harness = clientHarness();
    const normalizer = createOpenAIStudioArtifactSemanticNormalizer({ apiKey: 'test-key', client: harness.client });
    await expect(normalizer.normalize({
      kind: 'document', source: 'upload', mediaType: 'application/pdf', data: Buffer.from('%PDF-test'),
    })).resolves.toBe('Normalized visual or document content.');
    const serialized = JSON.stringify(harness.responseRequests[0]);
    expect(serialized).toContain('input_file');
    expect(serialized).toContain('studio-artifact.pdf');
    expect(serialized).toContain('data:application/pdf;base64,');
    expect(serialized).not.toContain('storageReference');
  });

  it('keeps video semantic normalization explicitly unavailable in Task 9 V1', async () => {
    const harness = clientHarness();
    const normalizer = createOpenAIStudioArtifactSemanticNormalizer({ apiKey: 'test-key', client: harness.client });
    await expect(normalizer.normalize({
      kind: 'video', source: 'screen_recording', mediaType: 'video/webm', data: Buffer.from('video'),
    })).rejects.toMatchObject({ code: 'normalizer_unavailable' });
    expect(harness.responseRequests).toEqual([]);
    expect(harness.transcriptionRequests).toEqual([]);
  });
});
