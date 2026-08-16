# Subscription Execution Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile OpenRouter, durable signed runner dispatch, environment-neutral harness execution, native Review Council, and governed model selection onto the accepted Agent Bridge foundation without duplicating runner authority.

**Architecture:** Preserve canonical runner/migration/harness contracts on current `main`; selectively port only execution-specific behavior from `feature/agent-bridge-subscription-execution`. Add `ExecutionEnvironmentProvider` as an orthogonal boundary so Codex, Antigravity, and Claude Code can run through a local provider now and managed providers later. Review Council seats resolve dynamically from admin-approved eligible model routes.

**Tech Stack:** TypeScript, Node.js 22, Vitest, PostgreSQL 17, Next.js 16, existing `@engineering-os/*` workspace packages, OpenAI SDK-compatible OpenRouter transport.

## Global Constraints

- `platform/packages/database/migrations/007_ai_runners.sql` remains authoritative and unchanged.
- New persistence starts at the next free forward migration number; expected `008_*` at plan creation.
- No provider credential, runner plaintext bearer, signing private key, secret-reference value, or local provider auth-store content enters persistence/audit/evidence/browser payloads.
- Qwen, GLM, Grok, Gemini, GPT, Claude, and future models are swappable routes, never permanent role enums.
- Users see only approved + eligible routes; `Auto` remains the normal default.
- Every production behavior follows RED -> verify RED -> minimal GREEN -> broader GREEN -> commit.
- The old divergent execution branch is read-only reference, never a wholesale merge source.
- Harness-native sandboxing remains enabled where supported; platform execution environment is a separate defence-in-depth boundary.
- Unfinished Tasks 5-9 do **not** imply greenfield rebuilds of inherited ECC capabilities. Before new implementation, classify relevant ECC code as reuse-as-is, adapt/generalise, supersede for a documented reason, or exclude for a documented security/product reason; prefer thin productisation/control-plane adapters.
- Task 8 implements the newer AI Engineering OS blind multi-model Review Council protocol and **supersedes** the simpler inherited ECC review orchestration for product acceptance, while reusing suitable ECC eval/review/verification primitives underneath.

---
### Task 1: Reconcile OpenRouter as a governed ModelGateway provider

**Files:**
- Create: `platform/packages/model-gateway/src/openrouter-adapter.ts`
- Create: `platform/packages/model-gateway/test/openrouter-adapter.test.ts`
- Modify: `platform/packages/model-gateway/src/index.ts`
- Modify: `platform/apps/api/src/model-runtime.ts`
- Modify: `platform/apps/api/test/model-runtime.test.ts`

**Interfaces:**
- Produces: `createOpenRouterAdapter(options): ModelAdapter`, `openRouterRouteId(model): string`.
- Consumes: existing `ModelAdapter`, `ModelRequest`, `ProviderExecutionError`, `normaliseUsage`.

- [ ] **Step 1: Write RED tests** proving deterministic unique route IDs, multi-model registration from `OPENROUTER_MODELS`, provider-error normalization, empty-output rejection, and no API-key exposure in routes/results.
- [ ] **Step 2: Verify RED** with `npm --prefix platform exec vitest run packages/model-gateway/test/openrouter-adapter.test.ts apps/api/test/model-runtime.test.ts` and confirm failures are missing OpenRouter behavior.
- [ ] **Step 3: Implement minimal adapter/runtime wiring** using the existing OpenAI-compatible SDK client with `baseURL: 'https://openrouter.ai/api/v1'`; model slugs come from configuration, not enums.
- [ ] **Step 4: Verify GREEN** with the focused command above plus `npm --prefix platform run typecheck`.
- [ ] **Step 5: Compare selectively** against `feature/agent-bridge-subscription-execution:platform/packages/model-gateway/src/openrouter-adapter.ts`; port behavior, not ancestry.
- [ ] **Step 6: Commit** `feat: reconcile OpenRouter model routes`.

### Task 2: Add signed dispatch protocol on top of canonical RunnerTaskEnvelope

**Files:**
- Create: `platform/packages/runner-protocol/package.json`
- Create: `platform/packages/runner-protocol/src/envelope.ts`
- Create: `platform/packages/runner-protocol/src/index.ts`
- Create: `platform/packages/runner-protocol/test/envelope.test.ts`
- Modify: `platform/package.json`

**Interfaces:**
- Consumes: canonical `RunnerTaskEnvelope` from `@engineering-os/domain`.
- Produces: `SignedRunnerTaskEnvelope`, `signRunnerTaskEnvelope`, `verifyRunnerTaskEnvelope`, `digestRunnerTaskPayload`.

- [ ] **Step 1: Write RED tests** for Ed25519 signature verification, payload tamper, runner mismatch, expiry, canonical ordering, replay identity fields, malformed arrays, and immutable input snapshots.
- [ ] **Step 2: Verify RED** with `npm --prefix platform exec vitest run packages/runner-protocol/test/envelope.test.ts`.
- [ ] **Step 3: Implement minimal signing layer** that wraps rather than redefines `RunnerTaskEnvelope`; signed material includes dispatch/attempt/idempotency identity and the canonical task payload digest.
- [ ] **Step 4: Verify GREEN** focused tests + platform typecheck.
- [ ] **Step 5: Re-run canonical domain/harness tests** to prove no duplicate task-envelope authority was introduced.
- [ ] **Step 6: Commit** `feat: sign canonical runner dispatch envelopes`.

### Task 3: Persist dispatch lifecycle and bounded execution evidence

**Files:**
- Create: `platform/packages/database/migrations/008_ai_dispatches.sql`
- Create: `platform/packages/database/src/ai-dispatch-repository.ts`
- Create: `platform/packages/database/test/ai-dispatches.integration.test.ts`
- Modify: `platform/packages/database/src/index.ts`

**Interfaces:**
- Produces: durable dispatch CRUD/claim/transition/evidence repository methods.
- Consumes: canonical runner IDs, organisation/project/task/connection identifiers, signed-envelope digest and bounded safe evidence.
- [ ] **Step 1: Write RED integration tests** against PostgreSQL 17 for queued creation, atomic single-runner claim under concurrency, legal transition graph, idempotent terminal replay, cancellation/expiry, tenant scoping, and evidence size/secret rejection.
- [ ] **Step 2: Verify RED** with `npm --prefix platform exec vitest run packages/database/test/ai-dispatches.integration.test.ts --maxWorkers=1 --no-file-parallelism`.
- [ ] **Step 3: Write forward migration + repository**; do not copy the divergent branch's runner tables or migration 007.
- [ ] **Step 4: Verify GREEN** focused integration tests, then `migration-runner.integration.test.ts` and existing runner repository tests.
- [ ] **Step 5: Inspect generated diff** to prove only dispatch/evidence persistence was added.
- [ ] **Step 6: Commit** `feat: persist governed runner dispatches`.

### Task 4: Expose runner pull/claim/complete API without weakening runner auth

**Files:**
- Create: `platform/apps/api/src/ai-dispatch-service.ts`
- Create: `platform/apps/api/src/ai-dispatch-routes.ts`
- Create: `platform/apps/api/test/ai-dispatch-service.integration.test.ts`
- Create: `platform/apps/api/test/ai-dispatch-http.integration.test.ts`
- Modify: API runtime composition file(s) that currently mount AI runner routes.

**Interfaces:**
- Consumes: authenticated canonical runner identity, dispatch repository, signing/verification package.
- Produces: runner-authenticated `claim`, `start`, `checkpoint`, `complete`, `fail`, `cancel-observed` operations.

- [x] **Step 1: Write RED tests** proving user bearer cannot call runner endpoints, runner A cannot claim runner B work, revoked/untrusted/stale runners fail closed, and complete/fail cannot cross organisation/project assignment.
- [x] **Step 2: Verify RED** with focused Vitest API integration commands.
- [x] **Step 3: Implement minimal service/routes** using the existing separate runner bearer authentication path; never accept provider credentials in request bodies.
- [x] **Step 4: Verify GREEN** focused API tests + all existing `ai-runner-service-*` and `ai-runners-http` tests.
- [x] **Step 5: Commit** `feat: expose trusted runner dispatch protocol`.

### Task 5: Introduce ExecutionEnvironmentProvider and local implementation

**Files:**
- Create: `platform/packages/execution-environment/package.json`
- Create: `platform/packages/execution-environment/src/types.ts`
- Create: `platform/packages/execution-environment/src/local-provider.ts`
- Create: `platform/packages/execution-environment/src/index.ts`
- Create: `platform/packages/execution-environment/test/local-provider.test.ts`
- Modify: `platform/package.json`

**Interfaces:**
- Produces: `ExecutionEnvironmentProvider`, `PreparedExecutionEnvironment`, `StructuredExecutionCommand`, `ExecutionEvent`, `ExecutionResult`.
- Required methods: `prepare`, `execute`, `cancel`, scoped file/artifact access, `destroy`.

- [ ] **Step 1: Write RED tests** proving `shell:false` argv execution, cwd containment, traversal rejection, symlink escape rejection, environment allowlisting, bounded stdout/stderr/event capture, cancellation scoped to the spawned process tree, and deterministic cleanup.
- [ ] **Step 2: Verify RED** with `npm --prefix platform exec vitest run packages/execution-environment/test/local-provider.test.ts`.
- [ ] **Step 3: Implement minimal local provider** using injected process/filesystem primitives so tests do not execute arbitrary shell syntax.
- [ ] **Step 4: Verify GREEN** focused tests and typecheck.
- [ ] **Step 5: Add a contract test helper** reusable by future managed providers; do not mention OpenSandbox types in the generic package.
- [ ] **Step 6: Commit** `feat: define execution environment boundary`.

### Task 6: Build outbound runner loop on the environment boundary

**Files:**
- Create: `platform/apps/runner/package.json`
- Create: `platform/apps/runner/src/runner-loop.ts`
- Create: `platform/apps/runner/src/workspace-policy.ts`
- Create: `platform/apps/runner/test/runner-loop.test.ts`
- Create: `platform/apps/runner/test/workspace-policy.test.ts`

**Interfaces:**
- Consumes: runner dispatch HTTP client, signed-envelope verifier, `ExecutionEnvironmentProvider`.
- Produces: claim -> verify -> prepare -> running -> execute -> checkpoint -> terminal workflow.
- [ ] **Step 1: Write RED tests** for outbound-only polling, invalid/tampered/expired dispatch refusal, cancellation, heartbeat/claim ordering, workspace-root enforcement, and terminal evidence after provider failure.
- [ ] **Step 2: Verify RED** with focused runner tests.
- [ ] **Step 3: Implement minimal loop** with injected clock/client/provider and no inbound listener or generic remote shell.
- [ ] **Step 4: Verify GREEN** runner tests + runner-protocol tests + canonical AI runner hardening tests.
- [ ] **Step 5: Commit** `feat: execute governed dispatches through local runner`.

### Task 7: Add thin Codex, Antigravity, and Claude Code harness adapters

**Files:**
- Create: `platform/apps/runner/src/harnesses/codex.ts`
- Create: `platform/apps/runner/src/harnesses/antigravity.ts`
- Create: `platform/apps/runner/src/harnesses/claude-code.ts`
- Create: `platform/apps/runner/src/harnesses/registry.ts`
- Create: `platform/apps/runner/test/harnesses/codex.test.ts`
- Create: `platform/apps/runner/test/harnesses/antigravity.test.ts`
- Create: `platform/apps/runner/test/harnesses/claude-code.test.ts`
- Modify: `platform/apps/api/src/ai-connection-policy.ts` only after each live proof.

**Interfaces:**
- Consumes: `HarnessExecutionRequest` and `ExecutionEnvironmentProvider`.
- Produces: three `HarnessExecutionAdapter` implementations with normalized evidence.

- [ ] **Step 1: Write RED fake-process tests** for exact argv/cwd/env behavior, no shell interpolation, cancellation, malformed harness output, local-auth non-export, and capability matching.
- [ ] **Step 2: Verify RED** before adapter production code exists.
- [ ] **Step 3: Implement Codex minimally**, GREEN fake-process tests, then perform controlled local-auth smoke; only after independent proof change `codex-subscription` delegation policy.
- [ ] **Step 4: Repeat RED/GREEN/live proof independently for Antigravity `agy`**, then its policy gate.
- [ ] **Step 5: Repeat RED/GREEN/live proof independently for Claude Code**, then its policy gate.
- [ ] **Step 6: Run existing ECC harness adapter/audit scripts** to prove no catalogue/session regression.
- [ ] **Step 7: Commit per harness**, never one three-harness mega-commit.

### Task 8: Productise the blind Review Council feedback loop

**Files:**
- Create: `platform/packages/domain/src/review-council.ts`
- Create: `platform/packages/database/migrations/009_review_council.sql` (or next free number)
- Create: `platform/packages/database/src/review-council-repository.ts`
- Create: `platform/apps/api/src/review-council-service.ts`
- Create: focused domain/database/API tests for each layer.

**Interfaces:**
- Produces: `ReviewRun`, `ReviewFinding`, `FindingAdjudication`, `ReviewerRechallenge`, `CalibrationSnapshot`, `ArchitectureInvariant`.
- Adjudication enum: `CONFIRMED | PARTIALLY_VALID | REJECTED | INSUFFICIENT_EVIDENCE`.

- [ ] **Step 1: Write RED domain tests** for blind packet identity, source/evidence digest, materiality/severity, adjudication states, fresh-source invalidation, and one-confirmed-Important/Critical blocking semantics.
- [ ] **Step 2: Verify RED**, then implement minimal domain constructors/validators.
- [ ] **Step 3: Write RED PostgreSQL tests** for durable runs/findings/adjudications/rechallenges/calibration and transaction rollback on incomplete authority mutations.
- [ ] **Step 4: Implement repository + GREEN**, then write API/service RED tests for private rechallenge and reviewer-output availability failures.
- [ ] **Step 5: Implement orchestration** so comparative reviewers receive the same canonical packet but never one another's findings; record exact route/model/version used.
- [ ] **Step 6: Add calibration aggregation** as evidence only; it may rank eligible routes but never create permanent model-role bindings.
- [ ] **Step 7: Commit in domain, persistence, orchestration increments**, with a fresh review after material source changes.

### Task 9: Add governed model catalogue and user eligibility surface

**Files:**
- Create/modify domain/database/API files for model catalogue records and policy.
- Modify: `platform/apps/api/src/model-runtime.ts`
- Modify: existing model-route/AI-connection HTTP surfaces.
- Modify: `platform/apps/web` model-selection/admin surfaces and tests.
**Interfaces:**
- Produces: admin-governed `approved | trial_calibration | disabled` catalogue state and user-visible eligible route list.
- Consumes: provider discovery/configured routes, organisation/user connection eligibility, runner availability, calibration evidence.

- [ ] **Step 1: Write RED API/domain tests** proving raw OpenRouter discovery is not automatically user-visible, disabled models cannot be selected, trial models require calibration/admin context, and `Auto` resolves only eligible approved candidates.
- [ ] **Step 2: Verify RED**, then implement the minimal catalogue/policy persistence and selection service.
- [ ] **Step 3: Write RED web tests** for admin catalogue controls and user dropdown showing `Auto` plus approved eligible routes with source labels such as organisation API/personal subscription/OpenRouter.
- [ ] **Step 4: Implement minimal UI** without exposing API keys, local auth state, or hidden disabled routes.
- [ ] **Step 5: Verify GREEN** API/web focused tests + typecheck + production web build.
- [ ] **Step 6: Commit** `feat: govern model catalogue and selection`.

### Task 10: Whole-slice verification, review, merge, and remote proof

**Files:**
- Modify: `docs/AI-ENGINEERING-OS-HANDOVER.md`
- Add: bounded review evidence under `docs/superpowers/reviews/` only after source is frozen for that review cycle.

- [ ] **Step 1: Run focused package/API/database suites** for every task and confirm zero unresolved RED proofs.
- [ ] **Step 2: Run fresh PostgreSQL 17 platform suite**: static tests, unit tests, integration tests with serialized DB workers.
- [ ] **Step 3: Run** `npm --prefix platform run typecheck`, production web build, dependency audit, `npm run harness:adapters`, `npm run harness:audit`, configured ECC compatibility/security checks, and `git diff --check`.
- [ ] **Step 4: Run the locked blind Review Council** on the exact source/evidence packet; adjudicate every material finding before remediation.
- [ ] **Step 5: For each confirmed/partially valid defect**, create RED proof, fix minimally, GREEN, then invalidate prior acceptance review and run fresh blind review of changed source.
- [ ] **Step 6: Update handover** with exact branch SHA, test counts, known non-gating auxiliary caveats, and pending OpenSandbox POC status.
- [ ] **Step 7: Merge to local `main` only after all gates pass**, verify tree/merged-main suite, push exact SHA, and verify configured GitHub CI green before declaring complete.

## Plan self-review checklist

- Spec coverage: Tasks 1-10 cover OpenRouter, signed dispatch/evidence, outbound runner, environment seam, three harnesses, Review Council, admin/user model governance, and full gates.
- Separation: OpenSandbox managed-provider implementation is intentionally excluded from this plan and defined in the dependent POC plan.
- Authority: no task recreates canonical runner identity, migration 007, runner auth, or connection-pool authority.
- Placeholder scan: clean; every implementation action is tied to a concrete task, file set, and verification command.
- Type consistency: harness adapters consume the environment boundary; runner dispatch consumes canonical domain + signed protocol; council consumes governed eligible model routes.
