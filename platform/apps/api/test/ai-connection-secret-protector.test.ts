import { describe, expect, it } from 'vitest';
import {
  createAesGcmAIConnectionSecretProtector,
  secretReferenceForId,
} from '../src/ai-connection-secret-protector.js';

const masterKey = Buffer.alloc(32, 7).toString('base64');
const protector = createAesGcmAIConnectionSecretProtector({
  masterKeyBase64: masterKey,
  keyVersion: 'test-v1',
});

function encrypted() {
  return protector.encrypt({
    id: '11111111-1111-4111-8111-111111111111',
    organisationId: 'org-001',
    connectionId: '22222222-2222-4222-8222-222222222222',
    value: 'provider-secret-value',
    createdBy: 'user-001',
    createdAt: new Date('2026-08-21T07:00:00.000Z'),
  });
}

describe('AES-GCM AI connection secret protector', () => {
  it('round-trips an opaque secret without storing plaintext', () => {
    const record = encrypted();
    expect(record.algorithm).toBe('aes-256-gcm');
    expect(record.keyVersion).toBe('test-v1');    expect(record.ciphertext.toString('utf8')).not.toContain('provider-secret-value');
    expect(record.iv).toHaveLength(12);
    expect(record.authTag).toHaveLength(16);
    expect(protector.decrypt(record)).toBe('provider-secret-value');
    expect(secretReferenceForId(record.id)).toBe(
      'dbsecret:11111111-1111-4111-8111-111111111111',
    );
  });

  it('binds ciphertext to tenant, connection, secret id and key version', () => {
    const record = encrypted();
    expect(() => protector.decrypt({ ...record, organisationId: 'org-002' }))
      .toThrow(/decrypt/i);
    expect(() => protector.decrypt({
      ...record,
      connectionId: '33333333-3333-4333-8333-333333333333',
    })).toThrow(/decrypt/i);
    expect(() => protector.decrypt({ ...record, keyVersion: 'other-v1' }))
      .toThrow(/key version|decrypt/i);
  });

  it('fails closed on ciphertext or authentication-tag tampering', () => {
    const record = encrypted();
    const ciphertext = Buffer.from(record.ciphertext);
    ciphertext[0] = ciphertext[0]! ^ 1;
    expect(() => protector.decrypt({ ...record, ciphertext })).toThrow(/decrypt/i);
    const authTag = Buffer.from(record.authTag);
    authTag[0] = authTag[0]! ^ 1;    expect(() => protector.decrypt({ ...record, authTag })).toThrow(/decrypt/i);
  });

  it('requires an exact 256-bit deployment key and never accepts blank secrets', () => {
    expect(() => createAesGcmAIConnectionSecretProtector({
      masterKeyBase64: Buffer.alloc(31).toString('base64'),
      keyVersion: 'bad-v1',
    })).toThrow(/32 bytes|256-bit/i);
    expect(() => protector.encrypt({
      id: '11111111-1111-4111-8111-111111111111',
      organisationId: 'org-001',
      connectionId: '22222222-2222-4222-8222-222222222222',
      value: '   ', createdBy: 'user-001', createdAt: new Date(),
    })).toThrow(/secret/i);
  });
});