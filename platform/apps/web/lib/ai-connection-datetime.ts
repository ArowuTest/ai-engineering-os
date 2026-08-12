// AI connection usage-window inputs are authored in browser
// <input type="datetime-local"> controls, which submit timezone-less strings
// like "2026-08-13T09:30". Handing such a string straight to `new Date()` would
// parse it in the server's local TZ — so a share window would land on a
// different absolute instant depending on where the Next.js server runs.
// This helper normalises to UTC BEFORE parsing so behaviour is deterministic
// across hosts. Already-offset ISO strings (with 'Z' or '±HH:MM') pass through
// unchanged and preserve their absolute instant.
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

export function parseAIConnectionDateTime(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('value is required');
  const normalised = DATETIME_LOCAL_RE.test(trimmed) ? trimmed + 'Z' : trimmed;
  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('value must be a valid ISO date');
  }
  return parsed.toISOString();
}
