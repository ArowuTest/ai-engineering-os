import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainValidationError, requireNonBlank } from './validation.js';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export const ORGANISATION_ROLES = ['owner', 'admin', 'member'] as const;
export type OrganisationRole = (typeof ORGANISATION_ROLES)[number];

export const PROJECT_ROLES = [
  'product_owner',
  'contributor',
  'engineer',
  'reviewer',
  'viewer',
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const INVITATION_STATUSES = ['pending', 'consumed', 'expired', 'revoked', 'replaced'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export function normalizeUserId(value: unknown): string {
  const normalized = requireNonBlank(value, 'userId').toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
    throw new DomainValidationError(
      'userId',
      'userId must be 3-64 characters using letters, numbers, dot, underscore or hyphen',
    );
  }
  return normalized;
}

export function requireOrganisationRole(value: unknown): OrganisationRole {
  if (typeof value !== 'string' || !ORGANISATION_ROLES.includes(value as OrganisationRole)) {
    throw new DomainValidationError('organisationRole', 'organisationRole is invalid');
  }
  return value as OrganisationRole;
}

export function requireProjectRole(value: unknown): ProjectRole {
  if (typeof value !== 'string' || !PROJECT_ROLES.includes(value as ProjectRole)) {
    throw new DomainValidationError('projectRole', 'projectRole is invalid');
  }
  return value as ProjectRole;
}

export function calculateInvitationExpiry(issuedAt: Date, ttlMinutes = 30): Date {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new DomainValidationError('ttlMinutes', 'ttlMinutes must be a positive integer');
  }
  return new Date(issuedAt.getTime() + ttlMinutes * 60_000);
}

export function isInvitationRedeemable(
  status: InvitationStatus,
  expiresAt: Date,
  now = new Date(),
): boolean {
  return status === 'pending' && expiresAt.getTime() > now.getTime();
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(requireNonBlank(token, 'token')).digest('hex');
}

function requirePassword(password: string): string {
  const value = requireNonBlank(password, 'password');
  if (value.length < 12 || value.length > 256) {
    throw new DomainValidationError('password', 'password must be between 12 and 256 characters');
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  const value = requirePassword(password);
  const salt = randomBytes(16);
  const derived = (await scrypt(value, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  let value: string;
  try {
    value = requirePassword(password);
  } catch {
    return false;
  }
  const [algorithm, saltText, hashText, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText || extra !== undefined) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (expected.length !== PASSWORD_KEY_LENGTH) return false;
    const derived = (await scrypt(value, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
