import { describe, expect, it } from 'vitest';
import { createConfiguredModelGateway } from '../src/model-runtime.js';

describe('configured model runtime', () => {
  it('registers no live routes when no provider credentials are present', () => {
    const gateway = createConfiguredModelGateway({});
    expect(gateway.listRoutes()).toEqual([]);
  });

  it('registers only providers with nonblank credentials', () => {
    const gateway = createConfiguredModelGateway({
      OPENAI_API_KEY: 'test-openai-key',
      ANTHROPIC_API_KEY: '   ',
      GEMINI_API_KEY: '',
    });
    expect(gateway.listRoutes().map((route) => route.provider)).toEqual(['openai']);
    expect(JSON.stringify(gateway.listRoutes())).not.toContain('test-openai-key');
  });

  it('uses configured model overrides without exposing credentials', () => {
    const gateway = createConfiguredModelGateway({
      OPENAI_API_KEY: 'openai-secret-value',
      OPENAI_MODEL: 'gpt-custom',
      ANTHROPIC_API_KEY: 'anthropic-secret-value',
      ANTHROPIC_MODEL: 'claude-custom',
      GEMINI_API_KEY: 'gemini-secret-value',
      GEMINI_MODEL: 'gemini-custom',
    });

    expect(gateway.listRoutes().map((route) => [route.provider, route.model])).toEqual([
      ['openai', 'gpt-custom'],
      ['anthropic', 'claude-custom'],
      ['google', 'gemini-custom'],
    ]);
    const serialized = JSON.stringify(gateway.listRoutes());
    expect(serialized).not.toContain('openai-secret-value');
    expect(serialized).not.toContain('anthropic-secret-value');
    expect(serialized).not.toContain('gemini-secret-value');
  });
});
