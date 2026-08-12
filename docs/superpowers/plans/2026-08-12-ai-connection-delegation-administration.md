# AI Connection Delegation Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable, audited administration layer for personal and organisation AI connections, project-scoped sharing, usage windows, and project execution-pool eligibility without implementing Agent Bridge or live subscription-harness execution yet.

**Architecture:** Add provider-independent connection/share domain contracts, forward-only PostgreSQL persistence, a trusted server-side connection-family policy registry, transactional services/API endpoints, and a safe Next.js administration UI. Project-pool reads compose requester-owned, project-contributed, organisation-owned, and existing API fallback tiers while failing closed when provider policy, presence, runner requirements, or usage windows make a route ineligible.

**Tech Stack:** TypeScript, Fastify, Next.js 16, PostgreSQL 17, Vitest, Docker Compose, existing `ModelGateway`, `DatabaseUnitOfWork`, auth/RBAC and append-only audit infrastructure.

## Global Constraints

- Migrations `001` through `005` remain byte-identical; this slice adds only `006_ai_connections_and_delegation.sql`.
- Personal connections default to private because no project-share row exists.
- First explicit project share defaults to `online_only`; `persistent` requires a separate explicit owner action.
- Personal credentials/tokens/cookies/refresh tokens are never accepted or returned by these administration APIs.
- Organisation connections may store only a safe external secret-reference identifier, never secret plaintext.
- Delegation eligibility is trusted server policy keyed by `connectionFamilyId`; user input can never set `delegatable=true`.
- Unknown/unverified connection families fail closed for project delegation.
- Provider/model identifiers remain open stable IDs; future providers such as `moonshot`/Kimi and `xai`/Grok require no domain migration or closed-union edit.
- Agent Bridge, `ai_runners`, Codex/Claude Code/Antigravity execution adapters, ECC Engineering Studio execution, and live provider authentication are out of this plan.
- Material connection/share mutations and required audit events commit atomically through `DatabaseUnitOfWork`.
- Final workflow remains feature branch -> independent review -> local merge to `main` -> verify merged `main` -> push GitHub `main`.

---
## File Structure

- `platform/packages/domain/src/ai-connection.ts` — connection/share identifiers, statuses, modes, usage-window validation and safe public shapes.
- `platform/packages/domain/test/ai-connection.test.ts` — domain invariants and extensible-provider regression coverage.
- `platform/apps/api/src/ai-connection-policy.ts` — trusted connection-family policy registry and production manifest.
- `platform/apps/api/test/ai-connection-policy.test.ts` — fail-closed and future-provider policy tests.
- `platform/packages/database/migrations/006_ai_connections_and_delegation.sql` — durable connections and project-share history.
- `platform/packages/database/src/ai-connection-repository.ts` — tenant-safe connection/share persistence queries.
- `platform/packages/database/src/session-repository.ts` — active-presence query used by Online Only policy.
- `platform/packages/database/src/unit-of-work.ts` / `src/index.ts` — transaction-scoped repository composition/exports.
- `platform/packages/database/test/ai-connections.integration.test.ts` — schema, scoping, history, immutability and presence tests.
- `platform/apps/api/src/ai-connection-service.ts` — connection registration/revocation, sharing and project-pool policy.
- `platform/apps/api/test/ai-connection-service.integration.test.ts` — RBAC, audit rollback, sharing defaults, revocation and pool ordering.
- `platform/apps/api/src/app.ts` / `src/server.ts` — HTTP endpoints and production runtime composition.
- `platform/apps/api/test/ai-connections-http.integration.test.ts` — authenticated API/security contracts.
- `platform/apps/web/lib/api.ts` — safe browser/server client contracts.
- `platform/apps/web/app/actions.ts` — server actions for connection/share changes.
- `platform/apps/web/app/ai-connections/page.tsx` — personal/org connection administration and project-sharing UI.
- `platform/apps/web/app/globals.css` — focused connection page styling.
- `platform/test/ai-connections-ui.test.mjs` — static web contract/security assertions.

---

## Canonical Interfaces Used By All Tasks

```ts
export type AIConnectionOwnership = 'personal' | 'organisation';
export type AIConnectionStatus = 'configured' | 'available' | 'reauth_required' | 'disabled' | 'revoked';
export type AIConnectionShareMode = 'online_only' | 'persistent';
export type AIConnectionCredentialStrategy = 'runner_managed' | 'environment' | 'external_secret_ref' | 'none';

export interface AIConnectionUsagePolicy {
  availableFrom?: Date;
  availableUntil?: Date;
}

export interface AIConnectionRecord {
  id: string;
  organisationId: string;
  ownership: AIConnectionOwnership;
  ownerUserId?: string;
  providerId: string;
  connectionFamilyId: string;
  credentialStrategy: AIConnectionCredentialStrategy;
  secretRefId?: string;
  status: AIConnectionStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
}
```

```ts
export interface TrustedConnectionFamilyPolicy {
  id: string;
  providerId: string;
  displayName: string;
  executionMode: 'subscription' | 'api' | 'manual';
  harnessId?: string;
  allowedOwnership: readonly AIConnectionOwnership[];
  credentialStrategies: readonly AIConnectionCredentialStrategy[];
  delegatable: boolean;
  requiresRunner: boolean;
  persistentSupported: boolean;
}

export interface ConnectionFamilyPolicyRegistry {
  get(id: string): TrustedConnectionFamilyPolicy | null;
  listSafe(): Array<Omit<TrustedConnectionFamilyPolicy, 'credentialStrategies'>>;
}
```

```ts
export interface ProjectExecutionPoolEntry {
  connectionId: string;
  tier: 'requester' | 'project_pool' | 'organisation';
  providerId: string;
  connectionFamilyId: string;
  ownerUserId?: string;
  shareMode?: AIConnectionShareMode;
  eligible: boolean;
  reasons: string[];
}
```

The HTTP/public read model derives from these records but never includes `secretRefId`. It returns only `credentialConfigured: boolean`.

---

### Task 1: Domain contracts and trusted connection-family policy

**Files:**
- Create: `platform/packages/domain/src/ai-connection.ts`
- Modify: `platform/packages/domain/src/index.ts`
- Create: `platform/packages/domain/test/ai-connection.test.ts`
- Create: `platform/apps/api/src/ai-connection-policy.ts`
- Create: `platform/apps/api/test/ai-connection-policy.test.ts`

**Interfaces:**
- Produces `AIConnectionOwnership = 'personal' | 'organisation'`.
- Produces `AIConnectionStatus = 'configured' | 'available' | 'reauth_required' | 'disabled' | 'revoked'`.
- Produces `AIConnectionShareMode = 'online_only' | 'persistent'`.
- Produces `AIConnectionCredentialStrategy = 'runner_managed' | 'environment' | 'external_secret_ref' | 'none'`.
- Produces `AIConnectionUsagePolicy { availableFrom?: Date; availableUntil?: Date }`.
- Produces `TrustedConnectionFamilyPolicy` and `ConnectionFamilyPolicyRegistry.get(id)`; registry returns `null` for unknown families.
- [x] **Step 1: Write failing domain tests**

Test that stable IDs accept `moonshot`, `xai`, and future hyphenated IDs; personal ownership requires an owner user; organisation ownership forbids one; usage windows require `availableUntil > availableFrom`; share mode accepts only `online_only|persistent`; secret-like fields are not part of public connection input/output types.

- [x] **Step 2: Write failing policy-registry tests**

Create a registry fixture with `future-subscription` and prove: policy metadata determines provider/harness/execution kind; unknown family returns null; a caller-supplied `delegatable` value is ignored because no such field exists in the lookup input; production personal harness families are fail-closed for collaborative delegation until their harness slice verifies them.

- [x] **Step 3: Run RED**

Run: `cd platform && npx vitest run packages/domain/test/ai-connection.test.ts apps/api/test/ai-connection-policy.test.ts`
Expected: FAIL because the new module/registry does not exist.

- [x] **Step 4: Implement minimal contracts and registry**

Use the existing stable-ID validation pattern from `domain/src/validation.ts`. The production registry must be code-defined and readonly. Include known families for OpenAI API, Anthropic API, Google API and the future subscription harness identities, but keep subscription delegation false until the actual harness adapter is verified. Do not add Kimi/Grok to the initial UI selector; extensibility is demonstrated by open identifiers and registry construction tests.

- [x] **Step 5: Run GREEN + typecheck**

Run: `cd platform && npx vitest run packages/domain/test/ai-connection.test.ts apps/api/test/ai-connection-policy.test.ts && npx tsc --noEmit --project tsconfig.base.json`
Expected: PASS.

- [x] **Step 6: Commit**

`git add platform/packages/domain platform/apps/api/src/ai-connection-policy.ts platform/apps/api/test/ai-connection-policy.test.ts && git commit -m "feat: define AI connection policy contracts"`

---

### Task 2: Forward-only connection/share persistence

**Files:**
- Create: `platform/packages/database/migrations/006_ai_connections_and_delegation.sql`
- Create: `platform/packages/database/src/ai-connection-repository.ts`
- Modify: `platform/packages/database/src/session-repository.ts`
- Modify: `platform/packages/database/src/unit-of-work.ts`
- Modify: `platform/packages/database/src/index.ts`
- Create: `platform/packages/database/test/ai-connections.integration.test.ts`
- Modify: `platform/packages/database/test/migration-runner.integration.test.ts`

**Interfaces:**
- `AIConnectionRepository.createConnection(record)` / `getConnection(organisationId,id)` / `listForUser(...)` / `listOrganisationConnections(...)` / `setConnectionStatus(...)`.
- `createProjectShare(...)` / `getActiveProjectShare(...)` / `listActiveProjectShares(...)` / `revokeProjectShare(...)`.
- `SessionRepository.hasActiveForUser(userId, now): Promise<boolean>`.
- [ ] **Step 1: Write failing PostgreSQL tests**

Cover: migration 006 appears exactly once after 005; migrations 001-005 remain unchanged; personal/organisation ownership checks; project-share organisation/project/connection scope; only one active share per connection/project; revocation preserves historical rows; usage-window timestamps round-trip; no provider-secret columns exist; active-session presence excludes expired/revoked sessions.

- [ ] **Step 2: Run RED**

Run: `cd platform && $env:DATABASE_URL='postgres://engineering_os:engineering_os@127.0.0.1:55432/engineering_os_test'; npx vitest run packages/database/test/ai-connections.integration.test.ts packages/database/test/migration-runner.integration.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: FAIL because migration/repository APIs do not exist and migration list ends at 005.

- [ ] **Step 3: Implement migration 006**

Create `ai_connections` with tenant boundary, ownership, owner user, provider ID, connection-family ID, credential strategy, optional safe `secret_ref_id`, status, creator and timestamps. Create `ai_connection_project_shares` as historical rows with mode, optional `available_from`/`available_until`, creator/timestamps/revocation and a partial unique index for one active connection+project share. Use FK/tenant checks so cross-organisation/project links are rejected by PostgreSQL.

- [ ] **Step 4: Implement repository and UoW composition**

Keep every query organisation-scoped. `setConnectionStatus` may move to `revoked` but never deletes history. `revokeProjectShare` sets `revoked_at`; re-sharing creates a new row. Add `aiConnections` to `TransactionRepositories`. Add `hasActiveForUser` using `revoked_at IS NULL AND expires_at > now`.

- [ ] **Step 5: Run GREEN**

Run the same PostgreSQL command; expected PASS. Then run `npm run typecheck` from `platform`.

- [ ] **Step 6: Commit**

`git add platform/packages/database && git commit -m "feat: persist AI connections and project delegation"`

---

### Task 3: Connection administration service with RBAC and atomic audit

**Files:**
- Create: `platform/apps/api/src/ai-connection-service.ts`
- Create: `platform/apps/api/test/ai-connection-service.integration.test.ts`

**Interfaces:**
- `registerPersonalConnection({organisationId, actorUserId, connectionFamilyId})` always owns the connection by `actorUserId` and never accepts credentials.
- `registerOrganisationConnection({organisationId, actorUserId, connectionFamilyId, secretRefId?})` requires organisation owner/admin and only accepts policy-approved credential strategy.
- `listConnections({organisationId, actorUserId})` returns safe personal-own + organisation-visible records without secret values.
- `revokeConnection({organisationId, actorUserId, connectionId})` allows personal owner for own connection or organisation admin for organisation-owned connection; personal admin cannot seize/reassign ownership.
- `AIConnectionServiceError` has stable `forbidden | not_found | policy_blocked | conflict` codes.

- [ ] **Step 1: Write RED service tests**

Prove personal ownership cannot be spoofed; members cannot register organisation connections; unknown family fails closed; family ownership policy is enforced; personal registration defaults to no shares; list output never returns `secretRefId`; it returns only `credentialConfigured: boolean` and never exposes credential material; audit failure rolls back registration/revocation; revocation retains historical share/output rows.

- [ ] **Step 2: Run RED**

Run: `cd platform && $env:DATABASE_URL='postgres://engineering_os:engineering_os@127.0.0.1:55432/engineering_os_test'; npx vitest run apps/api/test/ai-connection-service.integration.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: FAIL because service does not exist.
- [ ] **Step 3: Implement service using trusted policy registry + UoW**

Never accept provider passwords/tokens/cookies/refresh tokens. For personal connections, policy must allow personal ownership and choose `runner_managed`/`none`; initial status is `configured`. For organisation connections, allow only policy-approved organisation families and optional `external_secret_ref` identifier. Registration/revocation and their `ai.connection.*` audit event must share one DB transaction.

- [ ] **Step 4: Run GREEN + regression**

Run targeted service test, then `npm run test:unit` and `npm run typecheck`.

- [ ] **Step 5: Commit**

`git add platform/apps/api/src/ai-connection-service.ts platform/apps/api/test/ai-connection-service.integration.test.ts && git commit -m "feat: govern AI connection administration"`

---

### Task 4: Project sharing modes and owner-controlled usage windows

**Files:**
- Modify: `platform/apps/api/src/ai-connection-service.ts`
- Modify: `platform/apps/api/test/ai-connection-service.integration.test.ts`

**Interfaces:**
- `shareConnectionWithProject({organisationId, actorUserId, projectId, connectionId, usagePolicy?})` creates an `online_only` share; caller cannot choose persistent in this operation.
- `setProjectShareMode({..., mode:'online_only'|'persistent'})` requires the personal connection owner; persistent allowed only when trusted family policy declares persistent support.
- `revokeProjectShare(...)` is owner-controlled and immediately removes the share from new pool eligibility.
- `updateProjectShareUsagePolicy(...)` supports optional `availableFrom`/`availableUntil`; project/org admins may restrict but never widen beyond owner policy.

- [ ] **Step 1: Add RED tests**

Prove absence means Do Not Share; first share is always Online Only even if body attempts Persistent; only connection owner can enable/change/revoke personal sharing; share is project-scoped; provider family with `delegatable=false` cannot be shared; unknown family fails closed; persistent requires trusted persistent support; invalid/expired time windows are rejected; audit failure rolls back every material share mutation.

- [ ] **Step 2: Run RED and capture expected failures**

Run the targeted service test with PostgreSQL and require failures for missing methods/behavior.

- [ ] **Step 3: Implement minimum sharing logic**

Check project belongs to same organisation, owner has active organisation membership, family policy is delegatable, and personal ownership matches actor. Keep explicit `online_only` creation separate from mode transition so Persistent can never be accidental. Audit `ai.connection.project_share.enabled`, `.mode_changed`, `.policy_changed`, `.revoked` with identifiers/safe metadata only.

- [ ] **Step 4: Run GREEN + full service regression**

Run the complete `ai-connection-service.integration.test.ts`; expected PASS.

- [ ] **Step 5: Commit**

`git add platform/apps/api/src/ai-connection-service.ts platform/apps/api/test/ai-connection-service.integration.test.ts && git commit -m "feat: add project-scoped AI connection sharing"`

---
### Task 5: Project execution-pool eligibility and tier ordering

**Files:**
- Modify: `platform/apps/api/src/ai-connection-service.ts`
- Modify: `platform/apps/api/test/ai-connection-service.integration.test.ts`

**Interfaces:**
- `listProjectExecutionPool({organisationId, projectId, requesterUserId, now})` returns ordered entries with `tier: 'requester' | 'project_pool' | 'organisation'`, `eligible`, and stable `reasons`.
- Ineligibility reasons include `connection_unavailable`, `policy_not_delegatable`, `owner_offline`, `runner_unavailable`, `usage_window_not_started`, `usage_window_expired`, and `persistent_not_supported`. Revoked share rows are historical records and are omitted from the active execution pool rather than emitted as an ineligible entry.
- Existing `ModelGateway` API routes remain a separate `apiFallbackRoutes` list rather than being represented as somebody's personal connection.

- [ ] **Step 1: Add RED pool tests**

Using an injected trusted test family that is delegatable and does not require a runner, prove requester's own available personal connection appears before contributed project shares; multiple contributed connections are deterministically ordered without project-owner priority; Online Only requires an active owner session; Persistent can remain eligible after owner sign-out only when family policy permits and no runner is required; runner-required families remain ineligible with `runner_unavailable` until the later runner slice; usage windows filter eligibility; revoked connections/shares disappear or return ineligible according to the safe read contract; organisation connections form the third connection tier.

- [ ] **Step 2: Run RED**

Run the service integration test and require failures for missing pool behavior.

- [ ] **Step 3: Implement pool construction**

Derive owner presence from `SessionRepository.hasActiveForUser`, never browser-supplied presence. Apply trusted family policy at read time so a policy downgrade immediately removes delegation eligibility. Do not invent runner state: if `requiresRunner=true`, return `runner_unavailable` until the Agent Bridge slice supplies a runner resolver. Sort requester first, then contributed pool by capability-neutral stable policy fields/created ID, then organisation connections; expose existing configured API routes separately.

- [ ] **Step 4: Run GREEN + typecheck**

Run service integration plus platform typecheck.

- [ ] **Step 5: Commit**

`git add platform/apps/api/src/ai-connection-service.ts platform/apps/api/test/ai-connection-service.integration.test.ts && git commit -m "feat: expose project AI execution pool policy"`

---

### Task 6: Authenticated HTTP API and runtime composition

**Files:**
- Modify: `platform/apps/api/src/app.ts`
- Modify: `platform/apps/api/src/server.ts`
- Create: `platform/apps/api/test/ai-connections-http.integration.test.ts`

**Interfaces:**
- `GET /ai-connection-families` — safe trusted family catalogue (`id`, provider/harness labels, ownership support, sharing eligibility/reason); no secret material.
- `GET /ai-connections` — current user's safe personal records plus visible organisation records.
- `POST /ai-connections/personal` — `{ connectionFamilyId }` only.
- `POST /admin/ai-connections` — `{ connectionFamilyId, secretRefId? }`, organisation owner/admin only.
- `DELETE /ai-connections/:connectionId` — owner/admin rules from service.
- `GET /projects/:id/ai-connections` — project-scoped shares/pool read.
- `POST /projects/:id/ai-connections/:connectionId/share` — first share, always Online Only.
- `PATCH /projects/:id/ai-connections/:connectionId/share` — explicit mode/usage-policy change.
- `DELETE /projects/:id/ai-connections/:connectionId/share` — owner revocation.
- [ ] **Step 1: Write RED HTTP tests**

Cover unauthenticated 401; cross-organisation isolation; member personal registration; member forbidden for organisation registration; body attempts to send `providerToken`, `password`, `cookie`, `refreshToken`, `delegatable`, or `ownerUserId` are rejected with 400 rather than ignored; first project share returns Online Only; non-owner cannot widen/change personal share; all read endpoints expose `credentialConfigured` only and never return `secretRefId`; runtime `createRuntimeApp()` composes the real repository/service and survives restart with persisted state.

- [ ] **Step 2: Run RED**

Run the new HTTP integration test on Docker PostgreSQL.

- [ ] **Step 3: Implement Fastify routes and safe body parsers**

Add an `AIConnectionService` dependency to `AppDependencies`, error mapping for stable service codes, and production composition in `server.ts`. Reject unexpected sensitive field names explicitly. Route authorization comes from existing `resolveIdentity`/project membership; never accept actor/user identity from forms or request bodies.

- [ ] **Step 4: Run GREEN + API regressions**

Run `ai-connections-http.integration.test.ts`, `auth-http.integration.test.ts`, `runtime.integration.test.ts`, then typecheck.

- [ ] **Step 5: Commit**

`git add platform/apps/api && git commit -m "feat: expose AI connection administration API"`

---

### Task 7: AI Connections web administration

**Files:**
- Modify: `platform/apps/web/lib/api.ts`
- Modify: `platform/apps/web/app/actions.ts`
- Create: `platform/apps/web/app/ai-connections/page.tsx`
- Modify: `platform/apps/web/app/globals.css`
- Create: `platform/test/ai-connections-ui.test.mjs`

**Interfaces:**
- Web types mirror safe HTTP read models only; no credential/token/password/cookie fields exist.
- Server actions: `registerPersonalAIConnectionAction`, `registerOrganisationAIConnectionAction`, `revokeAIConnectionAction`, `shareAIConnectionAction`, `setAIConnectionShareModeAction`, `updateAIConnectionUsageWindowAction`, `revokeAIConnectionShareAction`.

- [ ] **Step 1: Write RED static web tests**

Assert the API client exposes safe connection/share/pool types and calls; server actions never accept actor/owner/delegatable/credential secret fields; page renders Personal Connections, Organisation Connections and Project Sharing; Do Not Share is shown when no share exists; first share action says Online Only; Persistent is a separate action; ineligible families show the server-provided reason; no initial Product Studio provider-selector changes are made.

- [ ] **Step 2: Run RED**

Run: `cd platform && node --test test/ai-connections-ui.test.mjs`
Expected: FAIL because page/client/actions do not exist.

- [ ] **Step 3: Implement server-rendered page and actions**

Use existing authenticated cookies through `lib/api.ts`. Personal registration shows connection-family choices from a safe server endpoint/read contract, not a hardcoded provider union. Organisation registration controls render only for owner/admin. Project share controls list only projects the user can access and display server policy status. Never render `secretRefId` to ordinary project collaborators.

- [ ] **Step 4: Run GREEN + web build**

Run static contract, direct web typecheck, and `npm run build --workspace @engineering-os/web`.

- [ ] **Step 5: Commit**

`git add platform/apps/web platform/test/ai-connections-ui.test.mjs && git commit -m "feat: add AI connection administration UI"`

---
### Task 8: Full slice verification, review, merge and main push

**Files:**
- Modify only if a failing verification exposes a real defect; no opportunistic refactor.
- Evidence stays outside the repository under `<EXTERNAL_SDD_ARCHIVE_ROOT>/2026-08-12-ai-connection-delegation-administration/`.

- [ ] **Step 1: Fresh Docker PostgreSQL verification**

Run from `platform`: `docker compose down -v`, `docker compose up -d`, wait for `platform-postgres-1` healthy, then set `DATABASE_URL=postgres://engineering_os:engineering_os@127.0.0.1:55432/engineering_os_test`.

- [ ] **Step 2: Clean install and complete Platform gates**

Run `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build --workspace @engineering-os/web`, `npm audit signatures`, and `npm audit --omit=dev --audit-level=high`. Required platform result: all tests/typecheck/build pass and runtime high-severity vulnerability count is zero.

- [ ] **Step 3: Exact ECC/security gates**

From repo root run the same ECC validation commands used by `.github/workflows/ci.yml`: agents, hooks, commands, skills, install manifests, rules, workflow security, catalog, command registry, Unicode safety, no-personal-paths and supply-chain IOC scan. No `agents/`, `skills/`, `hooks/`, `commands/`, ECC scripts or upstream provenance may change in this slice.

- [ ] **Step 4: Security/migration audit**

Run `git diff --check`; prove migrations 001-005 are byte-identical to `main`; prove only migration 006 is new; grep added lines for token/password/cookie/refresh-secret handling; verify no `ai_runners`, Agent Bridge or subscription-harness execution leaked into scope; verify provider identifiers remain open and no Kimi/Grok-specific domain union was introduced.

- [ ] **Step 5: Product smoke**

Against the real Fastify API + production Next build with Docker PostgreSQL, verify: personal connection registration creates no share; organisation connection registration is admin-only; unknown/unverified family cannot be delegated; first eligible share is Online Only; Persistent requires a separate owner action; owner logout makes Online Only contributed route ineligible while project state remains readable; share revocation immediately removes new-use eligibility; project collaborators can read safe pool metadata but cannot obtain secret references; restart preserves connections/shares/audit history.

- [ ] **Step 6: Independent whole-branch review**

Fresh reviewer inspects `main...HEAD` against AI-CONN-FR-001..017 and this plan. Merge gate is zero Critical/Important findings. Minor findings must be recorded explicitly.

**Task 8 verification evidence (2026-08-12):** Steps 1–6 are complete. A new Compose project/volume was used for the fresh-DB gate because the remote safety layer blocked destructive volume deletion; the prior volume was preserved. Full results: 33 static + 131 unit + 185 integration tests, typecheck/build/audits green, ECC/security green, production smoke PASS, runtime restart persistence confirmed, and final whole-branch review 0 Critical / 0 Important. Production subscription sharing correctly remains fail-closed until Agent Bridge; trusted-policy integration tests prove the share-state-machine behaviors.
- [ ] **Step 7: Push feature branch for exact CI, then local merge**

Push `feature/ai-connection-delegation-administration`; require exact feature SHA Platform Verification + ECC success. Switch primary checkout to `main`, confirm `origin/main` unchanged from fork point or fast-forward safely, merge with an explicit merge commit, verify merged tree matches reviewed feature tree, rerun merged-main platform verification, then `git push origin main`.

- [ ] **Step 8: Verify GitHub main and clean merged feature branch**

Require GitHub CI success on the exact new `main` SHA. Prove the feature branch is contained in `main`, delete the remote/local feature branch and worktree, but preserve `ecc-seed`, `ecc-upstream` and Dependabot branches.

---

## Requirement Coverage Self-Check

- AI-CONN-FR-001/002: Tasks 1-3 ownership + absence-of-share private default.
- AI-CONN-FR-003/004/005: Task 4 Online Only default, explicit Persistent, project scope.
- AI-CONN-FR-006/008/009/010/011/016: Task 5 orchestrator-controlled tiered pool and fail-closed policy.
- AI-CONN-FR-007/014: Tasks 1, 3, 6, 7 credential boundary and runner placeholder only; live runner/auth remains next slice.
- AI-CONN-FR-012: Task 4 enforceable availability windows; execution-count limits remain additive once execution evidence is wired.
- AI-CONN-FR-013/015: Tasks 3-6 revocation/history and project continuity.
- AI-CONN-FR-017: Tasks 3-6 transactional audit plus Task 8 verification.

## Planned Next Slice After This Plan

After this administration layer is merged and green, create a separate approved implementation plan for `ai_runners` / Agent Bridge and subscription-backed harness adapters (Codex, Claude Code, Antigravity, then additional officially supported harnesses). That next slice will consume the connection/share/pool contracts built here rather than changing their ownership semantics.


