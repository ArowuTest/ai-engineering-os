import { describe, expect, it } from 'vitest';
import {
  assertStudioArtifactBytes,
  assertStudioArtifactCount,
  assertStudioArtifactSourceKind,
  normalizeStudioSelectionValue,
  studioArtifactKindForMediaType,
  groupStudioModelRoutes,
} from './studio-composer.js';

describe('Studio composer governance helpers', () => {
  it('treats Auto and blank selectors as no explicit capability constraint', () => {
    expect(normalizeStudioSelectionValue('auto')).toBeUndefined();
    expect(normalizeStudioSelectionValue('  auto  ')).toBeUndefined();
    expect(normalizeStudioSelectionValue('')).toBeUndefined();
    expect(normalizeStudioSelectionValue('agent.backend')).toBe('agent.backend');
  });

  it('groups exact model routes for progressive disclosure without collapsing route identity', () => {
    const groups = groupStudioModelRoutes([
      { id: 'managed-gpt', provider: 'openai', model: 'gpt-x' },
      { id: 'user-openrouter-a', provider: 'openrouter', model: 'vendor/a', connection: { id: 'c1', ownerType: 'user' } },
      { id: 'user-openrouter-b', provider: 'openrouter', model: 'vendor/b', connection: { id: 'c2', ownerType: 'user' } },
      { id: 'org-gateway-a', provider: 'company-gateway', model: 'vendor/a', connection: { id: 'c3', ownerType: 'organisation' } },
    ]);

    expect(groups.map((group) => [group.label, group.routes.map((route) => route.id)])).toEqual([
      ['AIOS Managed', ['managed-gpt']],
      ['My OpenRouter', ['user-openrouter-a', 'user-openrouter-b']],
      ['Organisation Models', ['org-gateway-a']],
    ]);
  });

  it('classifies supported media types and rejects unknown binary input', () => {
    expect(studioArtifactKindForMediaType('image/png')).toBe('image');
    expect(studioArtifactKindForMediaType('audio/webm')).toBe('audio');
    expect(studioArtifactKindForMediaType('video/webm')).toBe('video');
    expect(studioArtifactKindForMediaType('application/pdf')).toBe('document');
    expect(studioArtifactKindForMediaType('text/plain')).toBe('document');
    expect(() => studioArtifactKindForMediaType('application/octet-stream')).toThrow(/unsupported/i);
  });
  it('enforces capture-source and media-kind consistency', () => {
    expect(() => assertStudioArtifactSourceKind('microphone', 'audio')).not.toThrow();
    expect(() => assertStudioArtifactSourceKind('screenshot', 'image')).not.toThrow();
    expect(() => assertStudioArtifactSourceKind('screen_recording', 'video')).not.toThrow();
    expect(() => assertStudioArtifactSourceKind('microphone', 'image')).toThrow(/microphone/i);
    expect(() => assertStudioArtifactSourceKind('screenshot', 'audio')).toThrow(/screenshot/i);
  });

  it('enforces the same 16-artifact turn ceiling before upload', () => {
    expect(() => assertStudioArtifactCount(16)).not.toThrow();
    expect(() => assertStudioArtifactCount(17)).toThrow(/16/);
  });

  it('bounds aggregate Studio upload bytes before any object-store write', () => {
    expect(() => assertStudioArtifactBytes(25 * 1024 * 1024)).not.toThrow();
    expect(() => assertStudioArtifactBytes((25 * 1024 * 1024) + 1)).toThrow(/25 MiB/i);
  });
});