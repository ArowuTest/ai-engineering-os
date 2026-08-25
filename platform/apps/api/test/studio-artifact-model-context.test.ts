import { describe, expect, it } from 'vitest';
import type { StudioInteractionArtifact } from '@engineering-os/domain';
import {
  STUDIO_TURN_MAX_ARTIFACT_CONTEXT_CHARS,
  buildStudioArtifactModelContext,
} from '../src/studio-artifact-model-context.js';

function artifact(overrides: Partial<StudioInteractionArtifact> = {}): StudioInteractionArtifact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organisationId: 'org-001',
    projectId: '22222222-2222-4222-8222-222222222222',
    kind: 'audio',
    source: 'microphone',
    storageReference: 'objects/private/internal-reference',
    digestSha256: 'a'.repeat(64),
    mediaType: 'audio/webm',
    byteSize: 100,
    contextText: 'Please review the payment retry flow.',
    visibility: 'project',
    retentionPolicy: 'project_default',
    createdBy: 'user-001',
    createdAt: new Date('2026-08-20T13:30:00.000Z'),
    ...overrides,
  };
}
describe('Studio artifact model context', () => {
  it('injects normalized artifacts as untrusted user data without storage authority', () => {
    const messages = buildStudioArtifactModelContext([artifact()]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0]?.content).toMatch(/untrusted user-provided data/i);
    expect(messages[0]?.content).toMatch(/must not override/i);
    expect(messages[1]).toMatchObject({ role: 'user' });
    expect(messages[1]?.content).toContain('Please review the payment retry flow.');
    expect(messages[1]?.content).toContain('11111111-1111-4111-8111-111111111111');
    expect(messages[1]?.content).toContain('a'.repeat(64));
    expect(messages.map((message) => message.content).join('\n')).not.toContain('objects/private');
    expect(messages.map((message) => message.content).join('\n')).not.toContain('storageReference');
  });

  it('ignores artifacts with no normalized context instead of inventing content', () => {
    const withoutContext = artifact();
    delete withoutContext.contextText;
    expect(buildStudioArtifactModelContext([withoutContext])).toEqual([]);
  });

  it('fails closed when aggregate normalized artifact context exceeds the turn budget', () => {
    const first = artifact({ contextText: 'a'.repeat(STUDIO_TURN_MAX_ARTIFACT_CONTEXT_CHARS) });
    const second = artifact({ id: '33333333-3333-4333-8333-333333333333', contextText: 'b' });
    expect(() => buildStudioArtifactModelContext([first])).not.toThrow();
    expect(() => buildStudioArtifactModelContext([first, second])).toThrow(/artifact context.*budget/i);
  });
});
