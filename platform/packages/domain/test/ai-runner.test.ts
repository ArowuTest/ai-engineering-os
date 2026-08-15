import { describe, expect, it } from 'vitest';
import {
  AI_RUNNER_STATUSES,
  AI_RUNNER_TRUST_STATES,
  DomainValidationError,
  createAIRunnerRecord,
  validateAIRunnerCapabilities,
  validateAIRunnerConnectionBinding,
  validateRunnerTaskEnvelope,
  type AIRunnerConnectionBinding,
  type AIRunnerRecord,
  type RunnerTaskEnvelope
} from '../src/index.js';

const now = new Date('2026-08-14T04:00:00.000Z');

function validEnvelope(): RunnerTaskEnvelope {
  return {
    id: 'envelope-1',
    organisationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    connectionId: 'connection-1',
    routeId: 'claude-code-sonnet',
    harnessId: 'claude-code',
    allowedOperations: ['read', 'write', 'execute'],
    workspaceScope: 'project-worktree',
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    nonce: 'nonce-1'
  };
}

describe('AI runner domain contracts', () => {
  it('creates a safe personal runner with explicit harness and capabilities', () => {
    const record = createAIRunnerRecord({
      organisationId: 'org-1',
      ownership: 'personal',
      ownerUserId: 'user-1',
      harnessId: 'claude-code',
      persistentSupported: true,
      capabilities: ['workspace', 'tools', 'mcp'],
      createdBy: 'user-1',
      createdAt: now
    });

    expect(record.ownership).toBe('personal');
    expect(record.ownerUserId).toBe('user-1');
    expect(record.status).toBe('registered');
    expect(record.trustState).toBe('pending');
    expect(record.capabilities).toEqual(['workspace', 'tools', 'mcp']);
    expect(record.createdAt).toEqual(now);
    expect(record.updatedAt).toEqual(now);
  });

  it('requires a personal owner and forbids ownerUserId for organisation runners', () => {
    expect(() =>
      createAIRunnerRecord({
        organisationId: 'org-1',
        ownership: 'personal',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'user-1'
      })
    ).toThrowError(DomainValidationError);

    expect(() =>
      createAIRunnerRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        ownerUserId: 'user-1',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'user-1'
      })
    ).toThrowError(DomainValidationError);
  });

  it('enumerates only supported runner status and trust states', () => {
    expect(AI_RUNNER_STATUSES).toEqual(['registered', 'online', 'offline', 'disabled', 'revoked']);
    expect(AI_RUNNER_TRUST_STATES).toEqual(['pending', 'trusted', 'restricted', 'revoked']);

    expect(() =>
      createAIRunnerRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'admin',
        status: 'unknown' as never
      })
    ).toThrowError(DomainValidationError);

    expect(() =>
      createAIRunnerRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'admin',
        trustState: 'root' as never
      })
    ).toThrowError(DomainValidationError);
  });

  it('validates capability identifiers and rejects duplicates instead of silently deduplicating', () => {
    expect(validateAIRunnerCapabilities(['workspace', 'tools', 'mcp'])).toEqual(['workspace', 'tools', 'mcp']);
    expect(() => validateAIRunnerCapabilities([])).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerCapabilities(['workspace', 'workspace'])).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerCapabilities(['Not A Capability'])).toThrowError(DomainValidationError);
  });

  it('rejects malformed runner identifiers and invalid dates', () => {
    expect(() =>
      createAIRunnerRecord({
        organisationId: 'Bad Org',
        ownership: 'organisation',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'admin'
      })
    ).toThrowError(DomainValidationError);

    expect(() =>
      createAIRunnerRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'admin',
        createdAt: new Date('invalid')
      })
    ).toThrowError(DomainValidationError);
  });

  it('does not expose provider credential or browser-session fields on runner records', () => {
    const record: AIRunnerRecord = createAIRunnerRecord({
      organisationId: 'org-1',
      ownership: 'organisation',
      harnessId: 'antigravity',
      persistentSupported: true,
      capabilities: ['workspace'],
      createdBy: 'admin',
      createdAt: now
    });
    const forbidden = ['password', 'apiKey', 'token', 'accessToken', 'refreshToken', 'cookie', 'cookies', 'session', 'providerSession', 'credential', 'credentials', 'secret', 'secretRefId'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
    }
  });

  it('strips credential-like unknown input fields from produced runner and envelope contracts', () => {
    const runnerInput = {
      organisationId: 'org-1',
      ownership: 'organisation',
      harnessId: 'codex',
      persistentSupported: false,
      capabilities: ['workspace'],
      createdBy: 'admin',
      apiKey: 'forbidden',
      token: 'forbidden',
      cookie: 'forbidden',
      providerSession: 'forbidden'
    } as Parameters<typeof createAIRunnerRecord>[0] & Record<string, unknown>;
    const record = createAIRunnerRecord(runnerInput);
    const envelope = validateRunnerTaskEnvelope({
      ...validEnvelope(),
      apiKey: 'forbidden',
      token: 'forbidden',
      cookie: 'forbidden',
      providerSession: 'forbidden',
      credentials: 'forbidden',
      secret: 'forbidden'
    } as RunnerTaskEnvelope & Record<string, unknown>);
    const forbidden = ['apiKey', 'token', 'cookie', 'providerSession', 'credentials', 'secret'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(envelope, key)).toBe(false);
    }
  });
  it('validates and normalizes safe runner-to-connection binding metadata', () => {
    const input = {
      id: 'binding-1',
      organisationId: 'org-1',
      runnerId: 'runner-1',
      connectionId: 'connection-1',
      createdBy: 'user-1',
      createdAt: now,
      token: 'forbidden',
      apiKey: 'forbidden',
      providerSession: 'forbidden'
    } as AIRunnerConnectionBinding & Record<string, unknown>;
    const binding = validateAIRunnerConnectionBinding(input);
    expect(binding.connectionId).toBe('connection-1');
    for (const key of ['credential', 'token', 'apiKey', 'providerSession', 'cookie', 'secret']) {
      expect(Object.prototype.hasOwnProperty.call(binding, key)).toBe(false);
    }
    expect(() => validateAIRunnerConnectionBinding({ ...input, runnerId: 'Bad Runner' })).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerConnectionBinding({ ...input, connectionId: '' })).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerConnectionBinding({ ...input, createdAt: new Date('invalid') })).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerConnectionBinding({ ...input, revokedAt: new Date('invalid') })).toThrowError(DomainValidationError);
    expect(() => validateAIRunnerConnectionBinding({ ...input, revokedAt: new Date(now.getTime() - 1) })).toThrowError(DomainValidationError);
  });

  it('accepts a complete scoped task envelope', () => {
    const envelope = validEnvelope();
    expect(validateRunnerTaskEnvelope(envelope)).toEqual(envelope);
  });

  it('rejects incomplete or malformed task envelope scope', () => {
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), projectId: '' })).toThrowError(DomainValidationError);
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), routeId: 'Bad Route' })).toThrowError(DomainValidationError);
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), workspaceScope: '   ' })).toThrowError(DomainValidationError);
  });

  it('requires non-empty unique stable operation identifiers', () => {
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), allowedOperations: [] })).toThrowError(DomainValidationError);
    expect(() =>
      validateRunnerTaskEnvelope({
        ...validEnvelope(),
        allowedOperations: ['read', 'read']
      })
    ).toThrowError(DomainValidationError);
    expect(() =>
      validateRunnerTaskEnvelope({
        ...validEnvelope(),
        allowedOperations: ['read', 'Shell Exec']
      })
    ).toThrowError(DomainValidationError);
  });

  it('explicitly rejects malformed replay nonces', () => {
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), nonce: '' })).toThrowError(DomainValidationError);
    expect(() => validateRunnerTaskEnvelope({ ...validEnvelope(), nonce: 'Bad Nonce' })).toThrowError(DomainValidationError);
  });
  it('requires valid task-envelope timestamps with expiry strictly after issue time', () => {
    expect(() =>
      validateRunnerTaskEnvelope({
        ...validEnvelope(),
        issuedAt: new Date('invalid')
      })
    ).toThrowError(DomainValidationError);
    expect(() =>
      validateRunnerTaskEnvelope({
        ...validEnvelope(),
        expiresAt: now
      })
    ).toThrowError(DomainValidationError);
    expect(() =>
      validateRunnerTaskEnvelope({
        ...validEnvelope(),
        expiresAt: new Date(now.getTime() - 1)
      })
    ).toThrowError(DomainValidationError);
  });

  it('rejects an explicitly supplied empty runner id instead of generating a replacement', () => {
    expect(() =>
      createAIRunnerRecord({
        id: '',
        organisationId: 'org-1',
        ownership: 'organisation',
        harnessId: 'codex',
        persistentSupported: false,
        capabilities: ['workspace'],
        createdBy: 'admin'
      })
    ).toThrowError(DomainValidationError);
  });
});
