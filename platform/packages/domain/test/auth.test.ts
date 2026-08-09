import { describe, expect, it } from 'vitest';
import {
  calculateInvitationExpiry,
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isInvitationRedeemable,
  normalizeUserId,
  requireOrganisationRole,
  requireProjectRole,
  verifyPassword,
} from '../src/auth.js';

describe('authentication domain', () => {
  it('normalizes User IDs case-insensitively', () => {
    expect(normalizeUserId('  FS.Owner_01 ')).toBe('fs.owner_01');
    expect(() => normalizeUserId('bad user id')).toThrow(/userId/);
  });

  it('validates organisation and project roles', () => {
    expect(requireOrganisationRole('owner')).toBe('owner');
    expect(requireProjectRole('reviewer')).toBe('reviewer');
    expect(() => requireOrganisationRole('reviewer')).toThrow(/organisationRole/);
    expect(() => requireProjectRole('admin')).toThrow(/projectRole/);
  });

  it('uses a 30-minute default invitation TTL and supports overrides', () => {
    const issuedAt = new Date('2026-08-09T12:00:00Z');
    expect(calculateInvitationExpiry(issuedAt).toISOString()).toBe('2026-08-09T12:30:00.000Z');
    expect(calculateInvitationExpiry(issuedAt, 90).toISOString()).toBe('2026-08-09T13:30:00.000Z');
    expect(() => calculateInvitationExpiry(issuedAt, 0)).toThrow(/ttlMinutes/);
  });

  it('allows redemption only while a pending invitation is unexpired', () => {
    const now = new Date('2026-08-09T12:15:00Z');
    const future = new Date('2026-08-09T12:30:00Z');
    const past = new Date('2026-08-09T12:10:00Z');
    expect(isInvitationRedeemable('pending', future, now)).toBe(true);
    expect(isInvitationRedeemable('pending', past, now)).toBe(false);
    for (const status of ['consumed', 'expired', 'revoked', 'replaced'] as const) {
      expect(isInvitationRedeemable(status, future, now)).toBe(false);
    }
  });

  it('hashes passwords and verifies them without storing plaintext', async () => {
    const encoded = await hashPassword('A-strong-password-2026');
    expect(encoded).not.toContain('A-strong-password-2026');
    expect(await verifyPassword('A-strong-password-2026', encoded)).toBe(true);
    expect(await verifyPassword('wrong-password-value', encoded)).toBe(false);
  });

  it('generates opaque tokens and stores only deterministic token hashes', () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(generateOpaqueToken())).not.toBe(hashOpaqueToken(token));
  });
});
