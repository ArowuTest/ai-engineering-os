import { describe, expect, it } from 'vitest';
import type {
  ConnectionFamilyPolicyRegistry,
  TrustedConnectionFamilyPolicy,
} from '../src/ai-connection-policy.js';
import {
  createConnectionFamilyPolicyRegistry,
  productionConnectionFamilyPolicyRegistry,
} from '../src/ai-connection-policy.js';

const futureSubscription: TrustedConnectionFamilyPolicy = {
  id: 'future-subscription',
  providerId: 'future-provider-2027',
  displayName: 'Future Subscription',
  executionMode: 'subscription',
  harnessId: 'future-harness',
  allowedOwnership: ['personal'],
  credentialStrategies: ['runner_managed'],
  delegatable: true,
  requiresRunner: true,
  persistentSupported: true,
};

const openaiApi: TrustedConnectionFamilyPolicy = {
  id: 'openai-api',
  providerId: 'openai',
  displayName: 'OpenAI API',
  executionMode: 'api',
  allowedOwnership: ['organisation'],
  credentialStrategies: ['external_secret_ref'],
  delegatable: false,
  requiresRunner: false,
  persistentSupported: false,
};

describe('ConnectionFamilyPolicyRegistry (custom fixture)', () => {
  const registry: ConnectionFamilyPolicyRegistry = createConnectionFamilyPolicyRegistry([
    futureSubscription,
    openaiApi,
  ]);

  it('returns trusted metadata for a registered family', () => {
    const policy = registry.get('future-subscription');
    expect(policy).not.toBeNull();
    expect(policy?.providerId).toBe('future-provider-2027');
    expect(policy?.harnessId).toBe('future-harness');
    expect(policy?.executionMode).toBe('subscription');
    expect(policy?.delegatable).toBe(true);
    expect(policy?.requiresRunner).toBe(true);
    expect(policy?.persistentSupported).toBe(true);
  });

  it('fails closed for unknown families', () => {
    expect(registry.get('never-added')).toBeNull();
    expect(registry.get('')).toBeNull();
  });

  it('listSafe never exposes credential strategies', () => {
    const listed = registry.listSafe();
    expect(listed.length).toBe(2);
    for (const entry of listed) {
      expect(Object.prototype.hasOwnProperty.call(entry, 'credentialStrategies')).toBe(false);
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.providerId).toBe('string');
    }
  });

  it('ignores caller-supplied "delegatable" because the get input is only the family ID string', () => {
    // Structural: get accepts a string id, not a rich input object.
    const rogue = 'openai-api';
    const policy = registry.get(rogue);
    expect(policy?.delegatable).toBe(false);
  });

  it('cannot be mutated after construction (frozen entries)', () => {
    const policy = registry.get('future-subscription')!;
    expect(() => {
      (policy as { delegatable: boolean }).delegatable = false;
    }).toThrow();
  });

  it('rejects duplicate policy IDs at registry construction', () => {
    expect(() =>
      createConnectionFamilyPolicyRegistry([futureSubscription, futureSubscription]),
    ).toThrow(/duplicate/i);
  });
});

describe('productionConnectionFamilyPolicyRegistry', () => {
  const registry = productionConnectionFamilyPolicyRegistry;

  it('registers known API families as organisation-owned metadata', () => {
    for (const id of ['openai-api', 'anthropic-api', 'google-api']) {
      const p = registry.get(id);
      expect(p, `expected ${id} to be present`).not.toBeNull();
      expect(p!.executionMode).toBe('api');
      expect(p!.allowedOwnership).toContain('organisation');
      expect(p!.delegatable).toBe(false);
    }
  });

  it('keeps subscription families fail-closed until a full safe engineering vertical slice is live-proven', () => {
    for (const id of ['codex-subscription', 'claude-code-subscription', 'antigravity-subscription']) {
      const p = registry.get(id);
      expect(p, `expected ${id} to be present`).not.toBeNull();
      expect(p!.executionMode).toBe('subscription');
      expect(p!.allowedOwnership).toEqual(['personal']);
      expect(p!.delegatable).toBe(false);
      expect(p!.requiresRunner).toBe(true);
      expect(p!.persistentSupported).toBe(false);
    }
  });

  it('does not register Kimi/Grok families (extensibility proven at registry construction, not initial UI)', () => {
    expect(registry.get('moonshot-api')).toBeNull();
    expect(registry.get('kimi-api')).toBeNull();
    expect(registry.get('xai-api')).toBeNull();
    expect(registry.get('grok-api')).toBeNull();
  });

  it('fails closed for any unknown family', () => {
    expect(registry.get('unverified-anything')).toBeNull();
  });

  it('safe listing omits credentialStrategies for every entry', () => {
    for (const entry of registry.listSafe()) {
      expect(Object.prototype.hasOwnProperty.call(entry, 'credentialStrategies')).toBe(false);
    }
  });
});
