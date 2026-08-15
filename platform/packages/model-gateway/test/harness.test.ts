import { describe, expect, it } from 'vitest';
import type { RunnerTaskEnvelope } from '@engineering-os/domain';
import {
  HarnessExecutionValidationError,
  NoEligibleHarnessAdapterError,
  executeHarnessRequest,
  selectHarnessExecutionAdapter,
  validateHarnessExecutionRequest,
  validateHarnessExecutionResult,
  type HarnessExecutionAdapter,
  type HarnessExecutionRequest,
  type HarnessExecutionResult,
  type ModelRoute,
  type ProviderCapabilities
} from '../src/index.js';

const now = new Date('2026-08-15T12:00:00.000Z');

function capabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    chat: true,
    tools: false,
    vision: false,
    files: false,
    mcp: false,
    localWorkspace: false,
    headless: false,
    structuredOutput: false,
    ...overrides
  };
}
function route(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    id: 'codex-sonnet',
    provider: 'openai',
    model: 'gpt-5.6-codex',
    executionMode: 'subscription',
    costType: 'included_subscription',
    available: true,
    priority: 10,
    capabilities: capabilities({ tools: true, localWorkspace: true }),
    ...overrides
  };
}

function envelope(overrides: Partial<RunnerTaskEnvelope> = {}): RunnerTaskEnvelope {
  return {
    id: 'envelope-1',
    organisationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    connectionId: 'connection-1',
    routeId: 'codex-sonnet',
    harnessId: 'codex',
    allowedOperations: ['read', 'write', 'execute'],
    workspaceScope: 'project-worktree',
    issuedAt: new Date(now.getTime() - 1_000),
    expiresAt: new Date(now.getTime() + 60_000),
    nonce: 'nonce-1',
    ...overrides
  };
}
function request(overrides: Partial<HarnessExecutionRequest> = {}): HarnessExecutionRequest {
  return {
    envelope: envelope(),
    route: route(),
    requiredCapabilities: ['chat', 'tools', 'localWorkspace'],
    operations: ['read', 'write'],
    workspaceScope: 'project-worktree',
    instruction: 'Inspect the repository and implement the approved task.',
    ...overrides
  };
}

function adapter(id: string, harnessId: string, adapterCapabilities: ProviderCapabilities): HarnessExecutionAdapter {
  return {
    id,
    harnessId,
    capabilities: adapterCapabilities,
    async execute(): Promise<HarnessExecutionResult> {
      return { status: 'completed', events: [] };
    }
  };
}

describe('harness-neutral execution boundary', () => {
  it('selects adapters by envelope harness and required capabilities, not provider name', () => {
    const candidates = [
      adapter('claude-full', 'claude-code', capabilities({ tools: true, localWorkspace: true })),
      adapter('codex-chat', 'codex', capabilities()),
      adapter('codex-full', 'codex', capabilities({ tools: true, localWorkspace: true }))
    ];

    const selected = selectHarnessExecutionAdapter(candidates, request(), now);
    expect(selected.id).toBe('codex-full');
  });

  it('fails closed when route or adapter capabilities cannot satisfy the request', () => {
    const candidates = [adapter('codex-chat', 'codex', capabilities()), adapter('claude-full', 'claude-code', capabilities({ tools: true, localWorkspace: true }))];
    expect(() => selectHarnessExecutionAdapter(candidates, request(), now)).toThrowError(NoEligibleHarnessAdapterError);

    expect(() =>
      selectHarnessExecutionAdapter(
        [adapter('codex-full', 'codex', capabilities({ tools: true, localWorkspace: true }))],
        request({ route: route({ capabilities: capabilities({ tools: false, localWorkspace: true }) }) }),
        now
      )
    ).toThrowError(NoEligibleHarnessAdapterError);
  });

  it('rejects expired or not-yet-issued task envelopes at execution time', () => {
    expect(() => validateHarnessExecutionRequest(request({ envelope: envelope({ expiresAt: now }) }), now)).toThrow(/expired/i);
    expect(() =>
      validateHarnessExecutionRequest(
        request({
          envelope: envelope({
            issuedAt: new Date(now.getTime() + 1),
            expiresAt: new Date(now.getTime() + 60_000)
          })
        }),
        now
      )
    ).toThrow(/issued/i);
  });

  it('rejects route mismatch, operations outside the envelope, and broader workspace scope', () => {
    expect(() => validateHarnessExecutionRequest(request({ route: route({ id: 'other-route' }) }), now)).toThrow(/route/i);

    expect(() => validateHarnessExecutionRequest(request({ operations: ['read', 'delete'] }), now)).toThrow(/operation/i);

    expect(() => validateHarnessExecutionRequest(request({ workspaceScope: 'repository-root' }), now)).toThrow(/workspace/i);
  });

  it('normalizes a valid request without carrying unknown provider-auth fields', () => {
    const unsafe = {
      ...request(),
      route: { ...route(), apiKey: 'nested-forbidden' } as ModelRoute & Record<string, unknown>,
      apiKey: 'forbidden',
      refreshToken: 'forbidden',
      providerSession: 'forbidden'
    } as HarnessExecutionRequest & Record<string, unknown>;
    const validated = validateHarnessExecutionRequest(unsafe, now);
    expect(validated.envelope.harnessId).toBe('codex');
    expect(validated.operations).toEqual(['read', 'write']);
    for (const key of ['apiKey', 'refreshToken', 'providerSession']) {
      expect(Object.prototype.hasOwnProperty.call(validated, key)).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(validated.route, 'apiKey')).toBe(false);
  });

  it('canonical execution passes only the normalized request to the selected adapter', async () => {
    let received: HarnessExecutionRequest | undefined;
    const candidate: HarnessExecutionAdapter = {
      ...adapter('codex-safe', 'codex', capabilities({ tools: true, localWorkspace: true })),
      async execute(input) {
        received = input;
        return { status: 'completed', events: [] };
      }
    };
    const unsafe = {
      ...request(),
      route: { ...route(), apiKey: 'nested-forbidden' } as ModelRoute & Record<string, unknown>,
      refreshToken: 'forbidden'
    } as HarnessExecutionRequest & Record<string, unknown>;

    await executeHarnessRequest([candidate], unsafe, now);
    expect(received).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(received!, 'refreshToken')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(received!.route, 'apiKey')).toBe(false);
  });

  it('canonical execution validates adapter results before returning them', async () => {
    const candidate: HarnessExecutionAdapter = {
      ...adapter('codex-unsafe-result', 'codex', capabilities({ tools: true, localWorkspace: true })),
      async execute() {
        return { status: 'completed', events: [], metadata: { openaiAccessToken: 'forbidden' } };
      }
    };
    await expect(executeHarnessRequest([candidate], request(), now)).rejects.toThrow(/credential|metadata/i);
  });
  it('rejects provider credential material anywhere in result or checkpoint metadata', () => {
    expect(() =>
      validateHarnessExecutionResult({
        status: 'completed',
        events: [],
        metadata: { provider: { accessToken: 'forbidden' } }
      })
    ).toThrow(/credential|metadata|accessToken/i);

    expect(() =>
      validateHarnessExecutionResult({
        status: 'completed',
        events: [
          {
            type: 'checkpoint',
            at: now,
            checkpointId: 'checkpoint-1',
            metadata: { nested: [{ cookie: 'forbidden' }] }
          }
        ]
      })
    ).toThrow(/credential|metadata|cookie/i);
    expect(() =>
      validateHarnessExecutionResult({
        status: 'completed',
        events: [],
        metadata: { provider: { openaiAccessToken: 'forbidden' } }
      })
    ).toThrow(/credential|metadata|openaiAccessToken/i);
  });

  it('rejects malformed result and event shapes with the harness validation error', () => {
    expect(() => validateHarnessExecutionResult(null as unknown as HarnessExecutionResult)).toThrow(HarnessExecutionValidationError);
    expect(() =>
      validateHarnessExecutionResult({
        status: 'completed',
        events: [null]
      } as unknown as HarnessExecutionResult)
    ).toThrow(HarnessExecutionValidationError);
  });

  it('rejects unknown execution event types instead of coercing them to status events', () => {
    expect(() =>
      validateHarnessExecutionResult({
        status: 'completed',
        events: [{ type: 'log', at: now, status: 'running', message: 'x' }]
      } as unknown as HarnessExecutionResult)
    ).toThrow(HarnessExecutionValidationError);
  });

  it('rejects malformed adapter capability maps with a controlled validation error', () => {
    const malformed = {
      ...adapter('codex-malformed', 'codex', capabilities({ tools: true, localWorkspace: true })),
      capabilities: null
    } as unknown as HarnessExecutionAdapter;
    expect(() => selectHarnessExecutionAdapter([malformed], request(), now)).toThrow(HarnessExecutionValidationError);
  });
  it('rejects common provider credential key variants recursively', () => {
    const forbiddenKeys = ['privateKey', 'secretKey', 'signingKey', 'passphrase', 'accessKeyId', 'awsSecretAccessKey', 'sessionId', 'userSession'];
    for (const key of forbiddenKeys) {
      expect(() =>
        validateHarnessExecutionResult({
          status: 'completed',
          events: [],
          metadata: { nested: [{ [key]: 'forbidden' }] }
        })
      ).toThrow(HarnessExecutionValidationError);
    }
  });

  it('rejects prototype-mutating metadata keys instead of materializing inherited values', () => {
    const metadata = JSON.parse('{"__proto__":{"injected":1}}') as Record<string, unknown>;
    expect(() => validateHarnessExecutionResult({ status: 'completed', events: [], metadata } as HarnessExecutionResult)).toThrow(HarnessExecutionValidationError);
  });
  it('accepts safe status/checkpoint metadata and preserves no provider secrets', () => {
    const result = validateHarnessExecutionResult({
      status: 'completed',
      output: 'Implemented and verified.',
      metadata: { filesChanged: 3, verifier: 'vitest' },
      events: [
        { type: 'status', at: now, status: 'running', metadata: { phase: 'test' } },
        {
          type: 'checkpoint',
          at: new Date(now.getTime() + 1),
          checkpointId: 'checkpoint-1',
          metadata: { commitSha: 'abc123' }
        }
      ]
    });

    expect(result.status).toBe('completed');
    expect(result.events).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/password|apiKey|accessToken|refreshToken|cookie|providerSession/i);
  });
});
