import {
  createCipheriv, createDecipheriv, randomBytes, randomUUID,
} from 'node:crypto';
import type { AIConnectionSecretRecord, AIConnectionSecretRepository } from '@engineering-os/database';

const ALGORITHM = 'aes-256-gcm' as const;
const SECRET_REFERENCE_PREFIX = 'dbsecret:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AesGcmAIConnectionSecretProtector {
  encrypt(input: {
    id?: string;
    organisationId: string;
    connectionId: string;
    value: string;
    createdBy: string;
    createdAt?: Date;
  }): AIConnectionSecretRecord;
  decrypt(record: AIConnectionSecretRecord): string;
}

function requireNonBlank(value: string, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${field} must be non-blank`);
  return normalized;
}

function aad(record: Pick<AIConnectionSecretRecord,
'id' | 'organisationId' | 'connectionId' | 'keyVersion' | 'algorithm'>): Buffer {  return Buffer.from([
    'aios-ai-connection-secret-v1', record.organisationId, record.connectionId,
    record.id, record.keyVersion, record.algorithm,
  ].join('\u0000'), 'utf8');
}

function decodeMasterKey(value: string): Buffer {
  const encoded = requireNonBlank(value, 'master key');
  const key = Buffer.from(encoded, 'base64');
  const canonical = key.toString('base64').replace(/=+$/, '');
  if (key.length !== 32 || canonical !== encoded.replace(/=+$/, '')) {
    throw new Error('master key must be a base64-encoded 32 bytes (256-bit) key');
  }
  return key;
}

export function secretReferenceForId(id: string): string {
  if (!UUID.test(id)) throw new Error('secret id must be a UUID');
  return `${SECRET_REFERENCE_PREFIX}${id.toLowerCase()}`;
}

export function secretIdFromReference(reference: string): string | null {
  if (typeof reference !== 'string' || !reference.startsWith(SECRET_REFERENCE_PREFIX)) return null;
  const id = reference.slice(SECRET_REFERENCE_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function createAesGcmAIConnectionSecretProtector(input: {
  masterKeyBase64: string;
  keyVersion: string;
}): AesGcmAIConnectionSecretProtector {  const key = decodeMasterKey(input.masterKeyBase64);
  const keyVersion = requireNonBlank(input.keyVersion, 'key version');

  return Object.freeze({
    encrypt(valueInput: Parameters<AesGcmAIConnectionSecretProtector['encrypt']>[0]) {
      const value = requireNonBlank(valueInput.value, 'secret');
      const id = valueInput.id ?? randomUUID();
      if (!UUID.test(id)) throw new Error('secret id must be a UUID');
      const recordBase = {
        id: id.toLowerCase(),
        organisationId: requireNonBlank(valueInput.organisationId, 'organisationId'),
        connectionId: requireNonBlank(valueInput.connectionId, 'connectionId'),
        keyVersion,
        algorithm: ALGORITHM,
      } as const;
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
      cipher.setAAD(aad(recordBase));
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return {
        ...recordBase, iv, ciphertext, authTag,
        createdBy: requireNonBlank(valueInput.createdBy, 'createdBy'),
        createdAt: valueInput.createdAt ?? new Date(),
      };
    },

    decrypt(record: AIConnectionSecretRecord) {
      if (record.algorithm !== ALGORITHM || record.keyVersion !== keyVersion) {
        throw new Error('AI connection secret key version or algorithm mismatch');
      }
      try {        if (record.iv.length !== 12 || record.authTag.length !== 16 || record.ciphertext.length < 1) {
          throw new Error('invalid encrypted record shape');
        }
        const decipher = createDecipheriv(ALGORITHM, key, record.iv, { authTagLength: 16 });
        decipher.setAAD(aad(record));
        decipher.setAuthTag(record.authTag);
        const plaintext = Buffer.concat([
          decipher.update(record.ciphertext), decipher.final(),
        ]).toString('utf8');
        if (!plaintext.trim()) throw new Error('blank decrypted secret');
        return plaintext;
      } catch {
        throw new Error('AI connection secret decrypt failed');
      }
    },
  });
}

export function createRepositoryAIConnectionCredentialResolver(input: {
  secrets: Pick<AIConnectionSecretRepository, 'getActive'>;
  protector: AesGcmAIConnectionSecretProtector;
}) {
  return {
    async resolve(value: { organisationId: string; connectionId: string; secretRefId: string }) {
      const id = secretIdFromReference(value.secretRefId);
      if (!id) throw new Error('managed AI connection secret reference required');
      const record = await input.secrets.getActive(value.organisationId, value.connectionId, id);
      if (!record) throw new Error('managed AI connection secret unavailable');
      return { value: input.protector.decrypt(record) };
    },
  };
}
