// AI connection usage-window inputs are authored in browser
// <input type="datetime-local"> controls, which submit timezone-less strings
// like "2026-08-13T09:30". Handing such a string straight to `new Date()` would
// parse it in the server's local TZ — so a share window would land on a
// different absolute instant depending on where the Next.js server runs. Worse,
// host parsing silently ROLLS OVER calendar-invalid values (2026-02-30 becomes
// 2026-03-02; 24:00 becomes next-day 00:00). To be deterministic across hosts
// AND fail closed on impossible values, we parse the components ourselves,
// construct the instant with Date.UTC, and verify the resulting Date round-trips
// back to the same components. Already-offset ISO strings (with 'Z' or '±HH:MM')
// pass through the host parser and preserve their absolute instant.
const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

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
  // Component-range guards catch 13-month / 60-minute / 24-hour before Date.UTC
  // silently rolls them over.
  if (month < 1 || month > 12) throw new Error('value must be a valid ISO date');
  if (day < 1 || day > 31) throw new Error('value must be a valid ISO date');
  if (hour < 0 || hour > 23) throw new Error('value must be a valid ISO date');
  if (minute < 0 || minute > 59) throw new Error('value must be a valid ISO date');
  if (second < 0 || second > 59) throw new Error('value must be a valid ISO date');
  let ms = 0;
  if (fractional !== undefined) {
    const padded = (fractional + '000').slice(0, 3);
    ms = Number(padded);
  }
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (Number.isNaN(instant)) throw new Error('value must be a valid ISO date');
  const d = new Date(instant);
  // Round-trip verification: rejects calendar-invalid days like 2026-02-30
  // that would otherwise silently roll forward to 2026-03-02.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    throw new Error('value must be a valid ISO date');
  }
  return d.toISOString();
}

export function parseAIConnectionDateTime(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('value is required');
  if (DATETIME_LOCAL_RE.test(trimmed)) {
    return parseBareDateTimeLocal(trimmed);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('value must be a valid ISO date');
  }
  return parsed.toISOString();
}
