# Task 8 Final Minor Hardening — Behavioral Test Durability

**Branch:** `feature/ai-connection-delegation-administration`
**Base HEAD:** `84d40d6d fix: harden AI connection usage window controls`
**Scope:** Test-durability hardening only. No production behaviour changes to service, repository, migration, policy registry, model gateway, runners, ECC, HTTP handler, or unrelated UI.

## Prior review observations addressed

1. UTC parsing was pinned mainly by a static regex-source assertion in `test/ai-connections-ui.test.mjs`. That test proved a string existed in a file; it did not exercise `Date` semantics or verify that the parser is TZ-independent.
2. HTTP `hasWindow` detection combined with explicit-`null` bound clearing was covered end-to-end at the service layer only. There was no HTTP-tier proof that a Fastify PATCH carrying `{availableFrom:null, availableUntil:null}` clears both bounds while preserving share mode.
3. The parser regex permits fractional seconds. That behaviour was neither documented nor asserted, so a future tightening could silently regress the accepted input surface.

## Production change (minimal, TDD-driven)

Extracted the pure UTC-normalising parser out of the server-action module so it is directly unit-testable:

- **New:** `platform/apps/web/lib/ai-connection-datetime.ts` — single pure export `parseAIConnectionDateTime(raw: string): string`. Same regex-plus-`Z` normalisation the action file already used; error text unchanged from the caller's perspective.
- **Refactored:** `platform/apps/web/app/actions.ts` — `optionalIsoDate` now delegates to the helper. Wire-behaviour unchanged: same input classes accepted, same ISO output, same rejection message shape (`"<key> must be a valid ISO date"`).

No other production files touched.

## New behavioural tests

### 1. `platform/apps/web/lib/ai-connection-datetime.test.ts` (unit, vitest)

Seven executable assertions covering the parser directly:

- Bare `2026-08-13T09:30` normalises to `2026-08-13T09:30:00.000Z` under `TZ=UTC`, `TZ=America/Los_Angeles`, and `TZ=Asia/Tokyo` — real deterministic-UTC proof, not source inspection.
- Bare-with-seconds `2026-08-13T09:30:45` → `2026-08-13T09:30:45.000Z`.
- **Fractional seconds** `2026-08-13T09:30:45.500` → `2026-08-13T09:30:45.500Z` — now an intentional, documented contract instead of accidental permissiveness.
- Offset-preserving: `2026-08-13T09:30:00+02:00` → `2026-08-13T07:30:00.000Z`; `...Z` round-trips to the same instant.
- Whitespace trimmed before parsing.
- Empty / whitespace-only input throws `/required/`.
- Non-ISO garbage throws `/valid ISO/`.

### 2. `platform/apps/api/test/ai-connections-http.integration.test.ts` — new case

Added a delegatable test-policy registry (`test-personal-delegatable`) and reused the existing Fastify app harness. The new case exercises the exact wire path a browser would use:

1. Owner registers a delegatable personal connection over HTTP.
2. Owner `POST`s a project share with a non-empty window (`availableFrom` + `availableUntil`).
3. Direct SQL confirms both bounds land in `ai_connection_project_shares` and `mode='online_only'`.
4. Owner `PATCH`es with **explicit `{availableFrom:null, availableUntil:null}`** and receives `204`.
5. Direct SQL confirms both `available_from` and `available_until` are `NULL` and `mode` is still `'online_only'` — proving `hasWindow` was detected on nulls, that the empty usage-policy path is taken, and that the mode-mutation branch was not reached.
6. `GET /projects/:id/ai-connections` shows the requester-tier `share` entry with `mode='online_only'`, no `availableFrom`, no `availableUntil`.
7. A different member of the same organisation attempting the same `PATCH` receives `403`/`404` — proves the null-bounds clear path is authorisation-gated end-to-end at HTTP, not just at parse time.

### 3. Static UI contract (adjusted, not deleted)

`platform/test/ai-connections-ui.test.mjs` previously matched the raw source regex to argue UTC parsing. That assertion is replaced by two stronger, still-cheap static claims:

- `actions.ts` must `import { parseAIConnectionDateTime } from '../lib/ai-connection-datetime'`.
- `actions.ts` must call `parseAIConnectionDateTime(` — not re-implement inline parsing.

The `clearAIConnectionShareWindowAction` explicit-null assertions are retained unchanged. The behavioural evidence for UTC handling now lives in the executable unit tests, so the static test only pins the wiring, not the internal implementation.

## Verification (all green)

| Suite | Command | Result |
| --- | --- | --- |
| New unit — datetime parser | `npx vitest run apps/web/lib/ai-connection-datetime.test.ts` | 7/7 pass |
| Full unit suite | `npx vitest run --exclude '**/*.integration.test.ts'` | 122/122 pass across 15 files |
| Static UI contract | `node --test test/*.test.mjs` | 33/33 pass |
| HTTP integration — AI connections | `npx vitest run apps/api/test/ai-connections-http.integration.test.ts --maxWorkers=1 --no-file-parallelism` | 13/13 pass (12 pre-existing + new null-bounds clear case) |
| Typecheck — base project | `npx tsc --noEmit --project tsconfig.base.json` | Exit 0 |
| Typecheck — web workspace | `npm run typecheck --workspace @engineering-os/web` | Exit 0 |
| Next build | `npx next build` (in `apps/web`) | Compiled successfully; 3 static + 5 dynamic routes generated |

## Files changed

**Added**
- `platform/apps/web/lib/ai-connection-datetime.ts`
- `platform/apps/web/lib/ai-connection-datetime.test.ts`

**Modified**
- `platform/apps/web/app/actions.ts` — imports and delegates to the new helper; no behavioural change.
- `platform/apps/api/test/ai-connections-http.integration.test.ts` — adds delegatable test-policy registry, factors `makeDependencies(policy?)`, adds the null-bounds clear case.
- `platform/test/ai-connections-ui.test.mjs` — replaces source-regex assertion with import + call-site assertions.

## Explicitly out of scope

- No changes to `platform/apps/api/src/app.ts`, `ai-connection-service.ts`, `ai-connection-policy.ts`, repositories, migrations, or the model gateway.
- No new production `parseAIConnectionDateTime` call sites — only the pre-existing `optionalIsoDate` path calls it, and only through the same server actions as before.
- Fractional-second handling is now **asserted as intentional** rather than tightened; if the product ever wants stricter input, that is a separate, TDD-first change.
