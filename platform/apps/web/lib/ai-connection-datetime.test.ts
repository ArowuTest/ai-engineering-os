import { describe, expect, it } from 'vitest';
import { parseAIConnectionDateTime } from './ai-connection-datetime.js';

describe('parseAIConnectionDateTime', () => {
  it('treats a bare datetime-local value as UTC regardless of server timezone', () => {
    // Simulate a browser-submitted <input type="datetime-local"> value with no
    // timezone. The absolute instant must be the same on every host.
    const originalTZ = process.env.TZ;
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      const parsed = parseAIConnectionDateTime('2026-08-13T09:30');
      expect(parsed, `TZ=${tz}`).toBe('2026-08-13T09:30:00.000Z');
    }
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it('accepts bare datetime-local with explicit seconds and normalises to UTC', () => {
    expect(parseAIConnectionDateTime('2026-08-13T09:30:45')).toBe(
      '2026-08-13T09:30:45.000Z',
    );
  });

  it('accepts fractional seconds and normalises to UTC (documenting current permissive behaviour)', () => {
    expect(parseAIConnectionDateTime('2026-08-13T09:30:45.500')).toBe(
      '2026-08-13T09:30:45.500Z',
    );
  });

  it('preserves the absolute instant of an already-offset ISO string', () => {
    // 09:30 in +02:00 is 07:30 UTC — must not be re-interpreted as UTC-local.
    expect(parseAIConnectionDateTime('2026-08-13T09:30:00+02:00')).toBe(
      '2026-08-13T07:30:00.000Z',
    );
    // 'Z' suffix must round-trip to the same instant.
    expect(parseAIConnectionDateTime('2026-08-13T09:30:00Z')).toBe(
      '2026-08-13T09:30:00.000Z',
    );
  });

  it('preserves negative-offset and DST-boundary authored instants', () => {
    expect(parseAIConnectionDateTime('2026-08-13T09:30:00-05:00')).toBe(
      '2026-08-13T14:30:00.000Z',
    );
    // Explicit offsets are authoritative even when the wall-clock happens to
    // sit on a regional DST transition; no host-local reinterpretation occurs.
    expect(parseAIConnectionDateTime('2026-03-08T02:30:00-05:00')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseAIConnectionDateTime('  2026-08-13T09:30  ')).toBe(
      '2026-08-13T09:30:00.000Z',
    );
  });

  it('throws for an empty or whitespace-only string', () => {
    expect(() => parseAIConnectionDateTime('')).toThrow(/required/);
    expect(() => parseAIConnectionDateTime('   ')).toThrow(/required/);
  });

  it('throws for a non-ISO garbage value', () => {
    expect(() => parseAIConnectionDateTime('not-a-date')).toThrow(/valid ISO/);
  });

  it('accepts a valid leap-day datetime-local value and normalises to UTC', () => {
    // 2028 is a leap year — Feb 29 must round-trip untouched.
    expect(parseAIConnectionDateTime('2028-02-29T12:00')).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });

  it('fails closed on a calendar-invalid day like 2026-02-30 (never silently rolls forward)', () => {
    // Host `new Date()` parsing would silently roll 2026-02-30 forward to
    // 2026-03-02. Component parsing + Date.UTC + round-trip verification
    // must reject the value instead.
    expect(() => parseAIConnectionDateTime('2026-02-30T09:30')).toThrow(/valid ISO/);
  });

  it('fails closed on non-leap Feb 29 and leap-year Feb 30', () => {
    expect(() => parseAIConnectionDateTime('2027-02-29T09:30')).toThrow(/valid ISO/);
    expect(() => parseAIConnectionDateTime('2028-02-30T09:30:00+00:00')).toThrow(/valid ISO/);
  });

  it('fails closed on an invalid month (e.g. month 13)', () => {
    expect(() => parseAIConnectionDateTime('2026-13-01T09:30')).toThrow(/valid ISO/);
  });

  it('fails closed on invalid hour or minute components', () => {
    expect(() => parseAIConnectionDateTime('2026-08-13T24:00')).toThrow(/valid ISO/);
    expect(() => parseAIConnectionDateTime('2026-08-13T09:60')).toThrow(/valid ISO/);
  });

  it('fails closed on a calendar-invalid day carried on a Z-suffixed ISO string', () => {
    // Host `new Date('2026-02-30T09:30:00Z')` silently rolls the day forward
    // to 2026-03-02 and returns a valid instant. The parser must reject the
    // value instead of normalising a nonexistent calendar day.
    expect(() => parseAIConnectionDateTime('2026-02-30T09:30:00Z')).toThrow(/valid ISO/);
  });

  it('fails closed on a calendar-invalid day carried on an offset-bearing ISO string', () => {
    // Same guarantee for numeric offsets: 2026-02-30 does not exist regardless
    // of the trailing +02:00.
    expect(() => parseAIConnectionDateTime('2026-02-30T09:30:00+02:00')).toThrow(/valid ISO/);
  });
});
