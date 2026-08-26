import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TRUST_CLASSES,
  createContextProvenance,
  contextCanProveCurrentState,
  selectBestContextObservation,
} from '../src/index.js';

describe('context trust and source-of-truth arbitration', () => {
  it('keeps historical, agent-generated and untrusted context from proving current state', () => {
    expect(CONTEXT_TRUST_CLASSES).toContain('directly_observed');
    for (const trustClass of ['historical', 'agent_generated', 'untrusted'] as const) {
      const context = createContextProvenance({
        trustClass,
        sourceType: 'memory',
        sourceRef: 'memory:handoff-001',
        observedAt: new Date('2026-08-26T10:00:00Z'),
      });
      expect(context.instructionBearing).toBe(false);
      expect(contextCanProveCurrentState(context)).toBe(false);
    }
  });

  it('allows canonical or directly observed evidence to prove state while remaining non-instruction-bearing by default', () => {
    const observed = createContextProvenance({
      trustClass: 'directly_observed',
      sourceType: 'runtime',
      sourceRef: 'runtime:git-status',
      observedAt: new Date('2026-08-26T10:01:00Z'),
    });
    expect(contextCanProveCurrentState(observed)).toBe(true);
    expect(observed.instructionBearing).toBe(false);
  });

  it('selects fresher deterministic direct evidence over stale narrative', () => {
    const best = selectBestContextObservation([
      {
        value: 'handover says dirty',
        provenance: createContextProvenance({
          trustClass: 'historical', sourceType: 'memory', sourceRef: 'handover',
          observedAt: new Date('2026-08-25T10:00:00Z'),
        }),
        deterministic: false,
        direct: false,
      },
      {
        value: 'git status clean',
        provenance: createContextProvenance({
          trustClass: 'directly_observed', sourceType: 'repository', sourceRef: 'git:status',
          observedAt: new Date('2026-08-26T10:00:00Z'),
        }),
        deterministic: true,
        direct: true,
      },
    ]);
    expect(best?.value).toBe('git status clean');
  });

  it('rejects malformed provenance and instruction-bearing external context', () => {
    expect(() => createContextProvenance({
      trustClass: 'made_up' as never,
      sourceType: 'runtime',
      observedAt: new Date(),
    })).toThrow(/trust/i);
    expect(() => createContextProvenance({
      trustClass: 'untrusted',
      sourceType: 'external',
      sourceRef: 'web:article',
      observedAt: new Date(),
      instructionBearing: true,
    })).toThrow(/instruction/i);
  });
});
