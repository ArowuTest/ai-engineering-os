import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  createAIConnectionRecord,
  validateAIConnectionUsagePolicy,
  isAIConnectionShareMode,
  AI_CONNECTION_SHARE_MODES,
  AI_CONNECTION_STATUSES,
  AI_CONNECTION_OWNERSHIPS,
  AI_CONNECTION_CREDENTIAL_STRATEGIES,
  type AIConnectionRecord,
  type AIConnectionShareMode,
} from '../src/index.js';

describe('AI connection domain contracts', () => {
  it('accepts arbitrary stable provider/family IDs including moonshot, xai and hyphenated future IDs', () => {
    const cases: Array<{ providerId: string; connectionFamilyId: string }> = [
      { providerId: 'moonshot', connectionFamilyId: 'moonshot-api' },
      { providerId: 'xai', connectionFamilyId: 'xai-api' },
      { providerId: 'future-provider-2027', connectionFamilyId: 'future-provider-2027.subscription' },
    ];
    for (const stable of cases) {
      const record = createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        providerId: stable.providerId,
        connectionFamilyId: stable.connectionFamilyId,
        credentialStrategy: 'external_secret_ref',
        secretRefId: 'secret-abc',
        createdBy: 'user-admin',
      });
      expect(record.providerId).toBe(stable.providerId);
      expect(record.connectionFamilyId).toBe(stable.connectionFamilyId);
    }
  });

  it('requires ownerUserId when ownership is personal', () => {
    expect(() =>
      createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'personal',
        providerId: 'openai',
        connectionFamilyId: 'openai-api',
        credentialStrategy: 'runner_managed',
        createdBy: 'user-1',
      }),
    ).toThrowError(DomainValidationError);
  });

  it('forbids ownerUserId when ownership is organisation', () => {
    expect(() =>
      createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        ownerUserId: 'user-1',
        providerId: 'openai',
        connectionFamilyId: 'openai-api',
        credentialStrategy: 'external_secret_ref',
        secretRefId: 'secret-1',
        createdBy: 'user-1',
      }),
    ).toThrowError(DomainValidationError);
  });

  it('couples secretRefId to external_secret_ref at the domain boundary', () => {
    expect(() =>
      createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        providerId: 'openai',
        connectionFamilyId: 'openai-api',
        credentialStrategy: 'external_secret_ref',
        createdBy: 'user-admin',
      }),
    ).toThrowError(DomainValidationError);

    expect(() =>
      createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'personal',
        ownerUserId: 'user-1',
        providerId: 'openai',
        connectionFamilyId: 'openai-subscription',
        credentialStrategy: 'runner_managed',
        secretRefId: 'must-not-be-here',
        createdBy: 'user-1',
      }),
    ).toThrowError(DomainValidationError);
  });

  it('creates a valid personal connection when ownerUserId is provided', () => {
    const record = createAIConnectionRecord({
      organisationId: 'org-1',
      ownership: 'personal',
      ownerUserId: 'user-1',
      providerId: 'anthropic',
      connectionFamilyId: 'anthropic-api',
      credentialStrategy: 'runner_managed',
      createdBy: 'user-1',
    });
    expect(record.ownership).toBe('personal');
    expect(record.ownerUserId).toBe('user-1');
    expect(record.status).toBe('configured');
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(record.updatedAt).toEqual(record.createdAt);
    expect(record.revokedAt).toBeUndefined();
  });

  it('rejects usage window when availableUntil is not after availableFrom', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const until = new Date('2026-01-01T00:00:00.000Z');
    expect(() => validateAIConnectionUsagePolicy({ availableFrom: from, availableUntil: until }))
      .toThrowError(DomainValidationError);
    const before = new Date('2025-12-31T23:59:59.000Z');
    expect(() => validateAIConnectionUsagePolicy({ availableFrom: from, availableUntil: before }))
      .toThrowError(DomainValidationError);
  });

  it('accepts usage window when availableUntil > availableFrom, or only one bound is set, or nothing is set', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const until = new Date('2026-02-01T00:00:00.000Z');
    expect(validateAIConnectionUsagePolicy({ availableFrom: from, availableUntil: until })).toBeUndefined();
    expect(validateAIConnectionUsagePolicy({ availableFrom: from })).toBeUndefined();
    expect(validateAIConnectionUsagePolicy({ availableUntil: until })).toBeUndefined();
    expect(validateAIConnectionUsagePolicy({})).toBeUndefined();
  });

  it('recognises only online_only and persistent as share modes', () => {
    expect(AI_CONNECTION_SHARE_MODES).toEqual(['online_only', 'persistent']);
    expect(isAIConnectionShareMode('online_only')).toBe(true);
    expect(isAIConnectionShareMode('persistent')).toBe(true);
    expect(isAIConnectionShareMode('offline')).toBe(false);
    expect(isAIConnectionShareMode('anything-else')).toBe(false);
  });

  it('enumerates known ownerships, statuses and credential strategies', () => {
    expect(AI_CONNECTION_OWNERSHIPS).toEqual(['personal', 'organisation']);
    expect(AI_CONNECTION_STATUSES).toEqual([
      'configured',
      'available',
      'reauth_required',
      'disabled',
      'revoked',
    ]);
    expect(AI_CONNECTION_CREDENTIAL_STRATEGIES).toEqual([
      'runner_managed',
      'environment',
      'external_secret_ref',
      'none',
    ]);
  });

  it('public AIConnectionRecord type does not name credential/token/cookie/refresh fields', () => {
    // Compile-time and runtime: enumerate keys created by the factory to confirm no secret material is exposed.
    const record: AIConnectionRecord = createAIConnectionRecord({
      organisationId: 'org-1',
      ownership: 'organisation',
      providerId: 'openai',
      connectionFamilyId: 'openai-api',
      credentialStrategy: 'external_secret_ref',
      secretRefId: 'secret-xyz',
      createdBy: 'user-admin',
    });
    const forbidden = ['password', 'token', 'accessToken', 'refreshToken', 'cookie', 'cookies', 'apiKey', 'secret'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(record, key)).toBe(false);
    }
  });

  it('rejects malformed stable IDs', () => {
    expect(() =>
      createAIConnectionRecord({
        organisationId: 'org-1',
        ownership: 'organisation',
        providerId: 'Not A Provider',
        connectionFamilyId: 'openai-api',
        credentialStrategy: 'external_secret_ref',
        secretRefId: 'secret-x',
        createdBy: 'user-admin',
      }),
    ).toThrowError(DomainValidationError);
  });

  it('exposes AIConnectionShareMode as an open string-union of the enumerated modes only', () => {
    const mode: AIConnectionShareMode = 'online_only';
    expect(mode).toBe('online_only');
  });
});
