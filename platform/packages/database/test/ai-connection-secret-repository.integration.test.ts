import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AIConnectionRepository,
  AIConnectionSecretRepository,
  UserRepository,
} from '../src/index.js';
import {
  closeDatabase, pool, resetDatabase,
} from './database-test-harness.js';

const organisationId = 'org-001';
let userId = '';
let connectionId = '';

async function seedConnection(secretId: string) {
  const now = new Date('2026-08-21T07:10:00.000Z');
  userId = randomUUID();
  connectionId = randomUUID();
  await new UserRepository(pool).create({
    id: userId, userId: `secret-${userId.slice(0, 8)}`,
    passwordHash: 'scrypt$test$hash', status: 'active',
    createdAt: now, updatedAt: now,
  });
  await new AIConnectionRepository(pool).createConnection({
    id: connectionId, organisationId, ownership: 'personal',
    ownerUserId: userId, providerId: 'openrouter',
    connectionFamilyId: 'openrouter-api',
    credentialStrategy: 'external_secret_ref',    secretRefId: `dbsecret:${secretId}`,
    status: 'configured', createdBy: userId,
    createdAt: now, updatedAt: now,
  });
}

describe('AIConnectionSecretRepository', () => {
  beforeEach(async () => resetDatabase(), 30_000);
  afterAll(async () => closeDatabase());

  it('persists encrypted material only for the exact tenant and connection', async () => {
    const secretId = randomUUID();
    await seedConnection(secretId);
    const repository = new AIConnectionSecretRepository(pool);
    const createdAt = new Date('2026-08-21T07:11:00.000Z');
    await repository.create({
      id: secretId, organisationId, connectionId,
      keyVersion: 'test-v1', algorithm: 'aes-256-gcm',
      iv: Buffer.alloc(12, 1), ciphertext: Buffer.from('cipher-bytes'),
      authTag: Buffer.alloc(16, 2), createdBy: userId, createdAt,
    });

    const stored = await repository.getActive(organisationId, connectionId, secretId);
    expect(stored).toMatchObject({
      id: secretId, organisationId, connectionId,
      keyVersion: 'test-v1', algorithm: 'aes-256-gcm',
      createdBy: userId,
    });    expect(stored?.iv.equals(Buffer.alloc(12, 1))).toBe(true);
    expect(stored?.ciphertext.toString('utf8')).toBe('cipher-bytes');
    expect(await repository.getActive('org-002', connectionId, secretId)).toBeNull();
    expect(await repository.getActive(
      organisationId, randomUUID(), secretId,
    )).toBeNull();
  });

  it('revokes a secret without deleting its encrypted evidence', async () => {
    const secretId = randomUUID();
    await seedConnection(secretId);
    const repository = new AIConnectionSecretRepository(pool);
    const createdAt = new Date('2026-08-21T07:12:00.000Z');
    await repository.create({
      id: secretId, organisationId, connectionId,
      keyVersion: 'test-v1', algorithm: 'aes-256-gcm',
      iv: Buffer.alloc(12, 1), ciphertext: Buffer.from('cipher-bytes'),
      authTag: Buffer.alloc(16, 2), createdBy: userId, createdAt,
    });
    await repository.revoke(organisationId, connectionId, secretId,
      new Date('2026-08-21T07:13:00.000Z'));
    expect(await repository.getActive(organisationId, connectionId, secretId)).toBeNull();
    const retained = await repository.get(organisationId, connectionId, secretId);
    expect(retained?.revokedAt?.toISOString()).toBe('2026-08-21T07:13:00.000Z');
  });
});
