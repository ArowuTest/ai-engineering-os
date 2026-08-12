// AI connection usage-window inputs are authored in browser
// <input type="datetime-local"> controls, which submit timezone-less strings
// like "2026-08-13T09:30". Handing such a string straight to `new Date()` would
// parse it in the server's local TZ — so a share window would land on a
// different absolute instant depending on where the Next.js server runs. Worse,
// host parsing silently ROLLS OVER calendar-invalid values (2026-02-30 becomes
// 2026-03-02; 24:00 becomes next-day 00:00). To be deterministic across hosts
// AND fail closed on impossible values, we parse the components ourselves,
// construct the instant with Date.UTC, and verify the resulting Date round-trips
// back to the same components. Offset-bearing ISO strings (with 'Z' or
// '±HH:MM') get the same calendar validation on their authored wall-clock
// components before we hand them to the host parser, so values like
// '2026-02-30T09:30:00Z' fail closed instead of silently rolling forward.
// The host parser then produces the absolute instant the offset dictates.
const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

// Offset-bearing ISO string: same shape as datetime-local, then either 'Z' or
// ±HH:MM. We validate calendar components ourselves so that offset-suffixed
// values like '2026-02-30T09:30:00Z' do not silently roll forward under
// host `new Date()` parsing.
const OFFSET_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/;

function assertValidCalendarComponents(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
): void {
  if (month < 1 || month > 12) throw new Error('value must be a valid ISO date');
  if (day < 1 || day > 31) throw new Error('value must be a valid ISO date');
  if (hour < 0 || hour > 23) throw new Error('value must be a valid ISO date');
  if (minute < 0 || minute > 59) throw new Error('value must be a valid ISO date');
  if (second < 0 || second > 59) throw new Error('value must be a valid ISO date');
  // Round-trip against UTC to catch calendar-invalid days (e.g. 2026-02-30)
  // that per-field range checks alone can't detect.
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error('value must be a valid ISO date');
  }
}

function parseBareDateTimeLocal(value: string): string {
  const match = DATETIME_LOCAL_RE.exec(value);
  if (!match) throw new Error('value must be a valid ISO date');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const fractional = match[7];
  assertValidCalendarComponents(year, month, day, hour, minute, second);
  let ms = 0;
  if (fractional !== undefined) {
    const padded = (fractional + '000').slice(0, 3);
    ms = Number(padded);
  }
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (Number.isNaN(instant)) throw new Error('value must be a valid ISO date');
  return new Date(instant).toISOString();
}

export function parseAIConnectionDateTime(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('value is required');
  if (DATETIME_LOCAL_RE.test(trimmed)) {
    return parseBareDateTimeLocal(trimmed);
  }
  const offsetMatch = OFFSET_ISO_RE.exec(trimmed);
  if (offsetMatch) {
    // Validate calendar components against the AUTHORED wall-clock time before
    // host `new Date()` has a chance to silently roll forward invalid days.
    // The offset only shifts the absolute instant afterwards.
    assertValidCalendarComponents(
      Number(offsetMatch[1]), Number(offsetMatch[2]), Number(offsetMatch[3]),
      Number(offsetMatch[4]), Number(offsetMatch[5]),
      offsetMatch[6] !== undefined ? Number(offsetMatch[6]) : 0,
    );
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('value must be a valid ISO date');
  }
  return parsed.toISOString();
}
