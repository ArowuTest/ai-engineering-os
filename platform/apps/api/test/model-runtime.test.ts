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

describe('configured OpenRouter runtime', () => {
  it('registers each explicitly configured model as a separate swappable route', () => {
    const gateway = createConfiguredModelGateway({
      OPENROUTER_API_KEY: 'openrouter-secret-value',
      OPENROUTER_MODELS: 'qwen/qwen3.5, z-ai/glm-5, x-ai/grok-4',
    });

    expect(gateway.listRoutes().map((route) => [route.provider, route.model])).toEqual([
      ['openrouter', 'qwen/qwen3.5'],
      ['openrouter', 'z-ai/glm-5'],
      ['openrouter', 'x-ai/grok-4'],
    ]);
    expect(new Set(gateway.listRoutes().map((route) => route.id)).size).toBe(3);
    expect(JSON.stringify(gateway.listRoutes())).not.toContain('openrouter-secret-value');
  });

  it('fails closed when an OpenRouter key has no explicit model catalogue', () => {
    expect(() => createConfiguredModelGateway({ OPENROUTER_API_KEY: 'x' })).toThrow(
      'OPENROUTER_MODELS must be a non-blank comma-separated list',
    );
  });

  it('rejects duplicate configured model slugs instead of silently changing routing', () => {
    expect(() => createConfiguredModelGateway({
      OPENROUTER_API_KEY: 'x',
      OPENROUTER_MODELS: 'qwen/qwen3.5, qwen/qwen3.5',
    })).toThrow('Duplicate OpenRouter model slug');
  });
});
