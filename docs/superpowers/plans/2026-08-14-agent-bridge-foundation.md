# Agent Bridge Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable, fail-closed Agent Bridge runner foundation required for subscription-backed Claude Code, Codex, Antigravity and future harness execution without transferring provider credentials to collaborators or making runner state canonical project memory.

**Architecture:** Extend the existing AI connection/delegation model with persisted runner identity/trust metadata and short-lived operational heartbeat state. Runners authenticate with scoped revocable platform credentials distinct from provider credentials, advertise safe harness/capability metadata, and become an eligibility input to the existing project execution pool. Actual provider-specific harness execution remains behind canonical adapter contracts and follows this foundation incrementally.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, Node test contracts, Next.js only where a later task surfaces runner status, existing `@engineering-os/domain`, `@engineering-os/database`, `@engineering-os/model-gateway` and API unit-of-work patterns.

## Global Constraints

- Preserve provider -> model -> execution route -> harness -> agent -> skill -> tool/MCP -> connection -> runner -> orchestrator as separate concepts.
- AI Engineering OS owns canonical project/task state; runner/harness sessions are replaceable execution state.
- Provider passwords, cookies, refresh tokens and web-session material must never enter normal platform storage, logs, audit metadata or collaborator-visible payloads.
- Runner credentials are platform-scoped, revocable and distinct from provider credentials.
- Agent Bridge initiates outbound connectivity and accepts only scoped task envelopes.
- `online_only` requires owner platform presence plus a reachable authorised runner where the route requires one.
- `persistent` may survive owner sign-out only while a trusted persistent-capable runner remains reachable and policy permits it.
- Material runner registration, disable/revoke and trust/capability changes require atomic audit; routine heartbeats do not.
- Migrations 001-006 remain byte-identical; all schema work is forward-only in migration 007.
- No provider-specific SDK may leak into core domain/API modules; harness adapters implement canonical contracts.
- Docker PostgreSQL, full platform tests, typecheck, production build, ECC/security checks and independent review remain mandatory acceptance gates.

---
## File Structure

- Create `platform/packages/domain/src/ai-runner.ts` for runner/trust/capability/task-envelope domain contracts and validation.
- Modify `platform/packages/domain/src/index.ts` to export runner contracts.
- Create `platform/packages/database/migrations/007_ai_runners.sql` for durable runner records, runner-connection bindings, scoped credential hashes and indexes.
- Create `platform/packages/database/src/ai-runner-repository.ts` for transaction-safe runner persistence and heartbeat updates.
- Modify `platform/packages/database/src/index.ts` and `unit-of-work.ts` to expose transaction-scoped runner persistence.
- Create `platform/apps/api/src/ai-runner-service.ts` for RBAC, registration, credential issuance/rotation, heartbeat, trust changes and revocation.
- Modify `platform/apps/api/src/ai-connection-service.ts` so execution-pool eligibility consumes runner availability without owning runner persistence.
- Modify `platform/apps/api/src/app.ts` and `server.ts` to compose authenticated runner/admin HTTP endpoints.
- Add `platform/apps/api/test/ai-runner-service.integration.test.ts` and `ai-runners-http.integration.test.ts`.
- Extend existing AI connection/pool integration tests for online-only/persistent runner semantics.
- Create `platform/packages/model-gateway/src/harness.ts` for harness-neutral execution adapter contracts; do not add provider-specific subprocess logic in the foundation tasks.
- Add `platform/packages/model-gateway/test/harness.test.ts` for contract-level capability and task-envelope validation.

### Task 1: Runner Domain Contracts

**Files:**
- Create: `platform/packages/domain/src/ai-runner.ts`
- Modify: `platform/packages/domain/src/index.ts`
- Test: `platform/packages/domain/test/ai-runner.test.ts`

**Interfaces:**
- Produces: `AIRunnerRecord`, `AIRunnerStatus`, `AIRunnerTrustState`, `AIRunnerCapability`, `AIRunnerConnectionBinding`, `createAIRunnerRecord()`, `validateAIRunnerCapabilities()` and `RunnerTaskEnvelope`.
- Consumes: stable organisation/user/connection identifiers and existing domain validation helpers.
- [ ] **Step 1: Write failing domain tests**

Cover invalid organisation/user IDs, duplicate capabilities, unsupported trust/status values, invalid expiry, runner/provider credential separation, and task envelopes whose project/task/connection scope is incomplete.

- [ ] **Step 2: Run the focused domain test and capture genuine RED**

Run: `npm run test:unit --workspace @engineering-os/domain -- ai-runner.test.ts` or the repository-equivalent Vitest command used by the package.
Expected: FAIL because runner types/factories do not exist.

- [ ] **Step 3: Implement minimal validated contracts**

Use explicit string unions for status/trust, immutable safe metadata, and no field capable of carrying provider password/cookie/session material. `RunnerTaskEnvelope` must contain stable task/project IDs, requested route/harness, allowed operations/workspace scope, issued/expiry timestamps and a nonce/id suitable for replay protection.

- [ ] **Step 4: Run domain tests and domain/package typecheck**

Expected: focused tests PASS; no existing domain regression.

- [ ] **Step 5: Commit**

`git commit -m "feat: define agent bridge runner contracts"`

### Task 2: Persist Runners and Scoped Platform Credentials

**Files:**
- Create: `platform/packages/database/migrations/007_ai_runners.sql`
- Create: `platform/packages/database/src/ai-runner-repository.ts`
- Modify: `platform/packages/database/src/index.ts`
- Modify: `platform/packages/database/src/unit-of-work.ts`
- Test: `platform/packages/database/test/ai-runner-repository.integration.test.ts`
**Interfaces:**
- Produces: durable runner CRUD/read models, active runner-connection bindings, credential-hash lookup, heartbeat timestamp/status updates, and transaction-scoped repository access.
- Consumes: Task 1 runner domain records and existing `Queryable`/`DatabaseUnitOfWork` conventions.

- [ ] **Step 1: Write migration/repository RED tests**

Prove organisation isolation, owner/scope constraints, one active binding per runner/connection, revocation history, hashed runner credential lookup, heartbeat persistence, and restart durability.

- [ ] **Step 2: Run repository integration tests against fresh PostgreSQL and capture RED**

Expected: migration/repository missing.

- [ ] **Step 3: Add forward-only migration 007**

Persist only platform-safe fields: runner identity, organisation/owner scope, harness ID, trust/status, persistent support, capability JSON/array representation, last-seen/heartbeat expiry, created/updated/revoked timestamps, credential hash metadata, and connection bindings. Store only runner credential hashes; never plaintext tokens.

- [ ] **Step 4: Implement repository + unit-of-work wiring**

Heartbeat updates may be operational writes outside material audit transactions; registration/trust/revoke repository methods must be usable inside the existing unit of work.

- [ ] **Step 5: Run migration/repository tests plus all database integration tests**

Expected: PASS with migrations 001-006 unchanged.

- [ ] **Step 6: Commit**

`git commit -m "feat: persist agent bridge runners"`

### Task 3: Runner Administration, Authentication and Heartbeat Service

**Files:**
- Create: `platform/apps/api/src/ai-runner-service.ts`
- Test: `platform/apps/api/test/ai-runner-service.integration.test.ts`
**Interfaces:**
- Produces: `AIRunnerService.registerRunner()`, `listRunners()`, `rotateRunnerCredential()`, `recordHeartbeat()`, `setRunnerTrust()`, `disableRunner()` and `revokeRunner()`.
- Consumes: auth actor/project/org membership checks, runner repository, audit repository and unit-of-work.

- [ ] **Step 1: Write service RED tests**

Cover organisation owner/admin vs member permissions, personal-owner binding rules, plaintext credential returned only once at registration/rotation, hash-only persistence, immediate revocation, trust downgrade, disabled runner heartbeat rejection, and audit rollback on material mutation failure.

- [ ] **Step 2: Run focused service integration tests and capture RED**

Expected: FAIL because runner service is missing.

- [ ] **Step 3: Implement minimal service**

Generate high-entropy opaque runner credentials, persist only hashes, return plaintext exactly once, require current organisation membership for administration, and keep provider-auth material outside every service input/output contract.

- [ ] **Step 4: Verify audit atomicity and credential redaction**

Run focused tests plus existing auth/AI-connection service suites.

- [ ] **Step 5: Commit**

`git commit -m "feat: govern agent bridge runners"`

### Task 4: Runner HTTP Surface and Runtime Composition

**Files:**
- Modify: `platform/apps/api/src/app.ts`
- Modify: `platform/apps/api/src/server.ts`
- Test: `platform/apps/api/test/ai-runners-http.integration.test.ts`

**Interfaces:**
- Produces authenticated admin endpoints for register/list/rotate/trust/disable/revoke and runner-authenticated heartbeat/status endpoints.
- Consumes Task 3 service; runner bearer credentials are separate from user auth sessions.

- [ ] **Step 1: Write HTTP RED tests**

Cover user-authenticated admin routes, separate runner bearer authentication, registration/rotation one-time credential return, heartbeat rejection after disable/revoke, tenant isolation and secret redaction.

- [ ] **Step 2: Run focused HTTP integration tests and capture RED**

Expected: FAIL because runner routes/runtime composition are missing.

- [ ] **Step 3: Add minimal routes and runtime composition**

Keep runner credential parsing isolated from user session parsing. Never accept provider credentials, cookies, refresh tokens or arbitrary actor identity in runner payloads.

- [ ] **Step 4: Run focused HTTP tests plus auth/server regression suites**

Expected: PASS with restart durability and redaction proven.

- [ ] **Step 5: Commit**

`git commit -m "feat: expose agent bridge runner API"`

### Task 5: Runner-Aware Project Execution Pool

**Files:**
- Modify: `platform/apps/api/src/ai-connection-service.ts`
- Test: `platform/apps/api/test/ai-connection-service.integration.test.ts`

**Interfaces:**
- Consumes: active runner bindings/health from Tasks 2-4.
- Produces: execution-pool entries whose existing `runner_unavailable` result is replaced by real runner eligibility when a suitable runner is reachable.
- [ ] **Step 1: Extend pool tests first**

Prove `online_only` requires both owner platform presence and a healthy bound runner; `persistent` ignores owner web presence but still requires a healthy persistent-capable runner; revoked/disabled/stale/untrusted runners are ineligible.

- [ ] **Step 2: Capture RED against current fail-closed behavior**

Expected: runner-required entries remain `runner_unavailable` because no runner resolver exists yet.

- [ ] **Step 3: Add a narrow runner-availability dependency**

Do not move runner persistence into `AIConnectionService`. Inject a read-only resolver/repository boundary and preserve requester -> project_pool -> organisation ordering plus all existing policy/window checks.

- [ ] **Step 4: Run pool, runner and connection service suites**

Expected: all runner modes and existing non-runner routes behave correctly.

- [ ] **Step 5: Commit**

`git commit -m "feat: make connection pools runner aware"`

### Task 6: Harness-Neutral Execution Contract

**Files:**
- Create: `platform/packages/model-gateway/src/harness.ts`
- Modify: `platform/packages/model-gateway/src/index.ts`
- Test: `platform/packages/model-gateway/test/harness.test.ts`

**Interfaces:**
- Produces: `HarnessExecutionAdapter`, safe `HarnessExecutionRequest`, `HarnessExecutionResult`, checkpoint/status events and capability matching.
- Consumes: `RunnerTaskEnvelope`, existing model route/capability types and stable harness IDs.
- [ ] **Step 1: Write contract RED tests**

Prove adapter selection is harness/capability driven, task envelopes reject expired or over-broad scopes, and result/checkpoint metadata cannot carry provider credential material.

- [ ] **Step 2: Capture RED**

Expected: FAIL because the harness-neutral adapter boundary does not yet exist.

- [ ] **Step 3: Implement only canonical interfaces/helpers**

No Claude Code, Codex, Antigravity or OpenRouter subprocess/API adapter belongs in this task. The contract must be sufficient for those later adapters without coupling core routing to any one harness.

- [ ] **Step 4: Run model-gateway tests and platform typecheck**

Expected: PASS with all existing API adapters unchanged.

- [ ] **Step 5: Commit**

`git commit -m "feat: define harness execution boundary"`

### Task 7: Foundation Verification and Independent Review

**Files:**
- Modify: `docs/AI-ENGINEERING-OS-HANDOVER.md` only after every gate is green.
- Test: no new production feature in this task.

- [ ] Run fresh-volume Docker PostgreSQL static/unit/integration tests and platform/web typecheck.
- [ ] Run Next.js production build, dependency audit and root ECC/security compatibility gates.
- [ ] Run independent task/whole-branch review with zero Critical/Important findings required.
- [ ] Verify migrations 001-006 are byte-identical to `main`; only migration 007 is new.
- [ ] Verify no provider secret/session material appears in API responses, logs, audit metadata or runner records.
- [ ] Update the living handover with exact commits, verification evidence and next slice.
- [ ] Commit bounded verification/docs changes.

## Explicit Next Slice Boundary

After this foundation is accepted, create a separate reviewed plan for concrete execution adapters: Claude Code, Codex and Antigravity subscription-backed harnesses plus an early OpenRouter API route for Qwen/GLM/Grok review calibration. Those adapters must consume the runner/harness contracts from this plan; they must not introduce a parallel provider-specific state model.