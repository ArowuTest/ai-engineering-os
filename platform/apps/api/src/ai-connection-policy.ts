import type {
  AIConnectionCredentialStrategy,
  AIConnectionOwnership,
} from '@engineering-os/domain';

export interface TrustedConnectionFamilyPolicy {
  id: string;
  providerId: string;
  displayName: string;
  executionMode: 'subscription' | 'api' | 'manual';
  harnessId?: string;
  allowedOwnership: readonly AIConnectionOwnership[];
  credentialStrategies: readonly AIConnectionCredentialStrategy[];
  delegatable: boolean;
  requiresRunner: boolean;
  persistentSupported: boolean;
}

export type SafeConnectionFamilyPolicy = Omit<TrustedConnectionFamilyPolicy, 'credentialStrategies'>;

export interface ConnectionFamilyPolicyRegistry {
  get(id: string): TrustedConnectionFamilyPolicy | null;
  listSafe(): SafeConnectionFamilyPolicy[];
}

function freezePolicy(policy: TrustedConnectionFamilyPolicy): TrustedConnectionFamilyPolicy {
  return Object.freeze({
    ...policy,
    allowedOwnership: Object.freeze([...policy.allowedOwnership]) as readonly AIConnectionOwnership[],
    credentialStrategies: Object.freeze([...policy.credentialStrategies]) as readonly AIConnectionCredentialStrategy[],
  });
}

export function createConnectionFamilyPolicyRegistry(
  policies: readonly TrustedConnectionFamilyPolicy[],
): ConnectionFamilyPolicyRegistry {
  const map = new Map<string, TrustedConnectionFamilyPolicy>();
  for (const raw of policies) {
    if (map.has(raw.id)) {
      throw new Error(`duplicate connection family policy id: ${raw.id}`);
    }
    map.set(raw.id, freezePolicy(raw));
  }
  return Object.freeze({
    get(id: string): TrustedConnectionFamilyPolicy | null {
      if (typeof id !== 'string' || id.length === 0) return null;
      return map.get(id) ?? null;
    },
    listSafe(): SafeConnectionFamilyPolicy[] {
      return Array.from(map.values()).map((policy) => {
        const { credentialStrategies: _credentialStrategies, ...safe } = policy;
        void _credentialStrategies;
        return Object.freeze({ ...safe });
      });
    },
  });
}

const PRODUCTION_POLICIES: readonly TrustedConnectionFamilyPolicy[] = [
  {
    id: 'openai-api',
    providerId: 'openai',
    displayName: 'OpenAI API',
    executionMode: 'api',
    allowedOwnership: ['organisation'],
    credentialStrategies: ['external_secret_ref'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'anthropic-api',
    providerId: 'anthropic',
    displayName: 'Anthropic API',
    executionMode: 'api',
    allowedOwnership: ['organisation'],
    credentialStrategies: ['external_secret_ref'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'google-api',
    providerId: 'google',
    displayName: 'Google Generative AI API',
    executionMode: 'api',
    allowedOwnership: ['organisation'],
    credentialStrategies: ['external_secret_ref'],
    delegatable: false,
    requiresRunner: false,
    persistentSupported: false,
  },
  {
    id: 'codex-subscription',
    providerId: 'openai',
    displayName: 'Codex Subscription Harness',
    executionMode: 'subscription',
    harnessId: 'codex',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: false,
    requiresRunner: true,
    persistentSupported: false,
  },
  {
    id: 'claude-code-subscription',
    providerId: 'anthropic',
    displayName: 'Claude Code Subscription Harness',
    executionMode: 'subscription',
    harnessId: 'claude-code',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: true,
    requiresRunner: true,
    persistentSupported: false,
  },
  {
    id: 'antigravity-subscription',
    providerId: 'google',
    displayName: 'Antigravity Subscription Harness',
    executionMode: 'subscription',
    harnessId: 'antigravity',
    allowedOwnership: ['personal'],
    credentialStrategies: ['runner_managed'],
    delegatable: false,
    requiresRunner: true,
    persistentSupported: false,
  },
];

export const productionConnectionFamilyPolicyRegistry: ConnectionFamilyPolicyRegistry =
  createConnectionFamilyPolicyRegistry(PRODUCTION_POLICIES);
