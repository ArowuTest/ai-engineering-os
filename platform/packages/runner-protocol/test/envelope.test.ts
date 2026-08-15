import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RunnerTaskEnvelope } from '@engineering-os/domain';
import {
  RUNNER_TASK_ENVELOPE_VERSION,
  digestRunnerTaskPayload,
  signRunnerTaskEnvelope,
  validateSignedRunnerTaskEnvelope,
  verifyRunnerTaskEnvelope,
  type RunnerTaskDispatch,
  type RunnerTaskPayload,
} from '../src/index.js';

function makeKeyPair() {
  return generateKeyPairSync('ed25519');
}

function makeTaskEnvelope(): RunnerTaskEnvelope {
  return {
    id: 'task-envelope-1',
    organisationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    connectionId: 'connection-1',
    routeId: 'openrouter-qwen',
    harnessId: 'codex',
    allowedOperations: ['write', 'read'],
    workspaceScope: 'C:/worktrees/task-1',
    issuedAt: new Date('2026-08-15T17:00:00.000Z'),
    expiresAt: new Date('2026-08-15T18:00:00.000Z'),
    nonce: 'nonce-1',
  };
}

function makePayload(): RunnerTaskPayload {
  return {
    objective: 'Implement the reviewed change.',
    contextReferences: ['file:src/index.ts', 'file:src/service.ts'],
    requiredCapabilities: ['localWorkspace', 'headless'],
  };
}

function makeDispatch(): RunnerTaskDispatch {
  return {
    dispatchId: 'dispatch-1',
    runnerId: 'runner-1',
    requesterUserId: 'user-1',
    attempt: 1,
    idempotencyKey: 'idem-1',
    taskEnvelope: makeTaskEnvelope(),
    payload: makePayload(),
  };
}

const VERIFY_AT = new Date('2026-08-15T17:30:00.000Z');

describe('runner task payload digest', () => {
  it('is deterministic over normalized payload content', () => {
    const first = digestRunnerTaskPayload(makePayload());
    const second = digestRunnerTaskPayload({
      objective: ' Implement the reviewed change. ',
      contextReferences: ['file:src/service.ts', 'file:src/index.ts'],
      requiredCapabilities: ['headless', 'localWorkspace'],
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('changes when execution payload meaning changes', () => {
    const base = digestRunnerTaskPayload(makePayload());
    expect(digestRunnerTaskPayload({ ...makePayload(), objective: 'Different objective' })).not.toBe(base);
    expect(digestRunnerTaskPayload({
      ...makePayload(),
      contextReferences: ['file:src/other.ts'],
    })).not.toBe(base);
    expect(digestRunnerTaskPayload({
      ...makePayload(),
      requiredCapabilities: ['headless'],
    })).not.toBe(base);
  });

  it('rejects duplicate or blank payload arrays instead of silently changing them', () => {
    expect(() => digestRunnerTaskPayload({
      ...makePayload(),
      contextReferences: ['file:a.ts', 'file:a.ts'],
    })).toThrow(/contextReferences/);
    expect(() => digestRunnerTaskPayload({
      ...makePayload(),
      requiredCapabilities: ['headless', 'headless'],
    })).toThrow(/requiredCapabilities/);
    expect(() => digestRunnerTaskPayload({
      ...makePayload(),
      contextReferences: ['   '],
    })).toThrow(/contextReferences/);
  });
});

describe('signed runner task envelope', () => {
  it('wraps and verifies the canonical RunnerTaskEnvelope', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(signed.schemaVersion).toBe(RUNNER_TASK_ENVELOPE_VERSION);
    expect(signed.signatureAlgorithm).toBe('ed25519');
    expect(signed.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.taskEnvelope.issuedAt).toBe('2026-08-15T17:00:00.000Z');
    expect(signed.taskEnvelope.expiresAt).toBe('2026-08-15T18:00:00.000Z');
    expect(signed.taskEnvelope.allowedOperations).toEqual(['read', 'write']);
    expect(signed.payload.requiredCapabilities).toEqual(['headless', 'localWorkspace']);
    expect(signed.payload.contextReferences).toEqual(['file:src/index.ts', 'file:src/service.ts']);

    const result = verifyRunnerTaskEnvelope(signed, publicKey, { now: VERIFY_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runnerId).toBe('runner-1');
      expect(result.value.taskEnvelope.expiresAt).toEqual(new Date('2026-08-15T18:00:00.000Z'));
      expect(result.value.payload).toEqual(signed.payload);
    }
  });

  it('is deterministic for the same canonical input and Ed25519 key', () => {
    const { privateKey } = makeKeyPair();
    const first = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    const second = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(first.signature).toBe(second.signature);
    expect(first.payloadDigest).toBe(second.payloadDigest);
  });

  it('snapshots caller-owned dates and arrays before signing', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const dispatch = makeDispatch();
    const signed = signRunnerTaskEnvelope(dispatch, privateKey);

    dispatch.taskEnvelope.allowedOperations[0] = 'execute';
    dispatch.taskEnvelope.expiresAt.setUTCFullYear(2030);
    dispatch.payload.contextReferences.push('file:evil.ts');
    dispatch.payload.requiredCapabilities[0] = 'vision';

    expect(signed.taskEnvelope.allowedOperations).toEqual(['read', 'write']);
    expect(signed.taskEnvelope.expiresAt).toBe('2026-08-15T18:00:00.000Z');
    expect(signed.payload.contextReferences).toEqual(['file:src/index.ts', 'file:src/service.ts']);
    expect(signed.payload.requiredCapabilities).toEqual(['headless', 'localWorkspace']);
    expect(verifyRunnerTaskEnvelope(signed, publicKey, { now: VERIFY_AT }).ok).toBe(true);
  });

  it('detects payload and authority tampering with distinct verification reasons', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);

    expect(verifyRunnerTaskEnvelope({
      ...signed,
      payload: { ...signed.payload, objective: 'Tampered objective' },
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'payload_digest_mismatch' });

    expect(verifyRunnerTaskEnvelope({
      ...signed,
      runnerId: 'runner-2',
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'invalid_signature' });

    expect(verifyRunnerTaskEnvelope({
      ...signed,
      attempt: 2,
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('fails closed on wrong runner, wrong dispatch, expiry, and wrong signing key', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const { publicKey: otherPublicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);

    expect(verifyRunnerTaskEnvelope(signed, publicKey, {
      now: VERIFY_AT,
      expectedRunnerId: 'runner-2',
    })).toEqual({ ok: false, reason: 'runner_mismatch' });
    expect(verifyRunnerTaskEnvelope(signed, publicKey, {
      now: VERIFY_AT,
      expectedDispatchId: 'dispatch-2',
    })).toEqual({ ok: false, reason: 'dispatch_mismatch' });
    expect(verifyRunnerTaskEnvelope(signed, publicKey, {
      now: new Date('2026-08-15T18:00:00.000Z'),
    })).toEqual({ ok: false, reason: 'expired' });
    expect(verifyRunnerTaskEnvelope(signed, otherPublicKey, {
      now: VERIFY_AT,
    })).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects malformed identity and canonical task-envelope inputs before signing', () => {
    const { privateKey } = makeKeyPair();
    expect(() => signRunnerTaskEnvelope({
      ...makeDispatch(),
      attempt: 0,
    }, privateKey)).toThrow(/attempt/);

    const malformed = makeDispatch();
    malformed.taskEnvelope.allowedOperations = ['read', 'read'];
    expect(() => signRunnerTaskEnvelope(malformed, privateKey)).toThrow(/allowedOperations/);
  });

  it('rejects not-yet-valid tasks and malformed wire envelopes during verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(verifyRunnerTaskEnvelope(signed, publicKey, {
      now: new Date('2026-08-15T16:59:59.999Z'),
    })).toEqual({ ok: false, reason: 'not_yet_valid' });

    expect(verifyRunnerTaskEnvelope(null as never, publicKey, {
      now: VERIFY_AT,
    })).toEqual({ ok: false, reason: 'invalid_envelope' });
    expect(verifyRunnerTaskEnvelope({
      ...signed,
      taskEnvelope: { ...signed.taskEnvelope, expiresAt: 'not-a-date' },
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'invalid_envelope' });
  });

  it('checks payload digest before signature and returns a detached verified snapshot', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(verifyRunnerTaskEnvelope({
      ...signed,
      payloadDigest: 'a'.repeat(64),
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'payload_digest_mismatch' });

    const result = verifyRunnerTaskEnvelope(signed, publicKey, { now: VERIFY_AT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      signed.payload.contextReferences[0] = 'file:mutated.ts';
      signed.taskEnvelope.allowedOperations[0] = 'execute';
      expect(result.value.payload.contextReferences).toEqual(['file:src/index.ts', 'file:src/service.ts']);
      expect(result.value.taskEnvelope.allowedOperations).toEqual(['read', 'write']);
    }
  });
});

// Hardening regressions: transport fields are closed and signing key type is explicit.
describe('runner task envelope hardening', () => {
  it('rejects a non-Ed25519 signing key with a deterministic protocol error', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => signRunnerTaskEnvelope(makeDispatch(), privateKey)).toThrow(
      'privateKey must be an Ed25519 private key',
    );
  });

  it('rejects unsigned extra fields that could smuggle untrusted metadata', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    const withExtraField = {
      ...signed,
      providerCredential: 'must-not-be-accepted',
    };
    expect(verifyRunnerTaskEnvelope(withExtraField, publicKey, { now: VERIFY_AT })).toEqual({
      ok: false,
      reason: 'invalid_envelope',
    });
  });

  it('cryptographically binds replay identity such as idempotencyKey', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(verifyRunnerTaskEnvelope({
      ...signed,
      idempotencyKey: 'idem-2',
    }, publicKey, { now: VERIFY_AT })).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});

describe('signed envelope structural snapshot', () => {
  it('validateSignedRunnerTaskEnvelope rejects unknown fields and returns detached data', () => {
    const { privateKey } = makeKeyPair();
    const signed = signRunnerTaskEnvelope(makeDispatch(), privateKey);
    expect(() => validateSignedRunnerTaskEnvelope({ ...signed, extra: 'nope' })).toThrow(/unexpected|missing/i);
    const validated = validateSignedRunnerTaskEnvelope(signed);
    signed.payload.contextReferences[0] = 'file:mutated.ts';
    expect(validated.payload.contextReferences).toEqual(['file:src/index.ts', 'file:src/service.ts']);
  });
});