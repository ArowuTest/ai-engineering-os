# Subscription Execution Reconciliation & Native Review Council Design

**Date:** 15 August 2026
**Status:** Approved design for reconciliation from current canonical `main`
**Branch:** `feature/subscription-execution-reconciled`
**Parent design:** `2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`
**Historical source spec (reference only):** `feature/agent-bridge-subscription-execution@95face70:docs/superpowers/specs/2026-08-12-agent-bridge-subscription-execution-design.md`

## 1. Purpose

This design reconciles the already-built subscription-execution work with the now-reviewed Agent Bridge foundation on canonical `main`.

It does not rebuild runner identity, trust, heartbeat, connection-pool eligibility, or the harness-neutral execution contract. Those are authoritative on `main` and must remain intact.

The slice selectively salvages the valuable execution work from `feature/agent-bridge-subscription-execution`: OpenRouter multi-model routing, signed dispatch/envelope protocol, durable dispatch/evidence, and runner pull APIs. It then completes real local harness execution for Codex, Antigravity, and Claude Code, and productises the Review Council feedback loop.

Core rule: **Agents do work; the platform owns state.** Provider, model, execution route, harness, agent role, skill, tool/MCP, connection, runner, and orchestrator remain separate abstractions.

## 2. Locked architecture

Canonical execution chain remains:

`Provider -> Model -> Execution Route -> Harness -> Agent/Role -> Runner -> Orchestrator`

No implementation may collapse model identity into reviewer role, harness identity into provider, or user connection into model route.
## 3. Reconciliation approach

Three approaches were considered:

1. **Wholesale merge/rebase of the old execution branch.** Rejected because it contains older duplicate runner domain, repository, migration, service, and HTTP code that conflicts with the hardened foundation.
2. **Start again from scratch.** Rejected because it discards already-implemented and reviewed OpenRouter/dispatch work.
3. **Selective transplant onto fresh current-main branch. Selected.** Preserve the accepted foundation; port only execution-specific concepts/code/tests after adapting them to current contracts.

The old `feature/agent-bridge-subscription-execution` worktree remains read-only reference evidence. It is not a merge candidate.

The new branch starts from canonical `main` at or after `525bca0b`. New persistence uses forward migrations only. The existing canonical migration `007_ai_runners.sql` is never replaced by the divergent branch's older migration.

## 4. Model catalogue and selection governance

Models are swappable resources, never architectural constants. Qwen, GLM, Grok, Gemini, GPT, Claude, and future models may all enter or leave any role without changing core code.

The platform maintains a governed model catalogue with states such as `approved`, `trial_calibration`, and `disabled`. Platform administrators decide which discovered/configured provider models become available to the product.

Users see only routes that are both platform-approved and eligible for that user/organisation/project. `Auto` is the normal default; advanced users may select an eligible approved route explicitly.

Selection policy may consider capability, role suitability, availability, cost/risk limits, connection ownership/sharing, runner state, and calibration evidence. Initial model names or rankings live in configuration/policy, not hard-coded domain enums.
## 5. OpenRouter integration

OpenRouter is an ordinary API provider inside the existing `ModelGateway`; it is not an Agent Bridge and does not create a parallel router.

The reconciled implementation shall preserve the already-built multi-model behavior: one `OPENROUTER_API_KEY`, a configured list of approved model slugs, deterministic stable route IDs, normal `ModelResponse` output, provider-error normalization, and no credential exposure.

OpenRouter model discovery may feed the administrator catalogue, but raw upstream catalogue entries are not automatically user-visible. An administrator must approve or trial a model before normal product use.

OpenRouter routes and direct OpenAI/Anthropic/Google routes participate in the same route-selection layer. Council roles may use any approved eligible route, including future providers, without code changes to the council role definition.

## 6. Canonical runner foundation that must be reused

The following current-main components are authoritative and are not to be replayed from the divergent branch:

- `AIRunner` domain contracts and `RunnerTaskEnvelope` foundation;
- canonical migration `007_ai_runners.sql`;
- `AIRunnerRepository` and hash-only runner credentials;
- runner registration, trust, disable, revoke, rotation, heartbeat, and authentication service;
- relational runner-to-connection bindings;
- runner-aware project execution pool and Online Only/Persistent eligibility semantics;
- harness-neutral execution request/result/event validation and secret-safe metadata boundary.

Any old-branch code that duplicates these areas is treated as historical reference only. Execution-specific code must consume these canonical contracts rather than redefine authority.
## 7. Dispatch, signing, and evidence

Selective salvage shall add only the missing dispatch authority beneath the canonical runner foundation.

Durable dispatch lifecycle remains `queued -> claimed -> running -> succeeded|failed|cancelled|expired`. Claim must be atomic, tenant/runner scoped, and idempotent/recoverable according to the previously reviewed replay contract.

The platform signs the create-time canonical task envelope with an application signing key. The assigned runner verifies signature, runner assignment, organisation/project/task/connection/harness IDs, workspace scope, operations, expiry, attempt/idempotency identity, and task/context digest before execution.

The signing private key remains runtime secret configuration. Provider credentials, subscription cookies, refresh tokens, local credential-store contents, runner bearer plaintext, and secret-reference values never enter dispatch rows, envelopes, audit metadata, artefacts, or browser payloads.

New persistence starts with a forward `008_*` migration for dispatch/evidence only, adjusted if another migration number exists by implementation time. No second runner migration is permitted.

Execution evidence is bounded, append-oriented, and common across providers/harnesses. It records safe execution identity, timestamps, outcome, route/model when known, runner/harness, worktree/commit/checkpoint references, usage/quota metadata where available, and allowed artefact references.
## 8. Execution environment boundary

Execution environment is orthogonal to harness. A task selects both **how** it runs (`harnessId`) and **where** it runs (`executionEnvironment`); neither dimension may be inferred from the other.

The platform owns an `ExecutionEnvironmentProvider` boundary with at least `local` and managed-provider implementations. Harness adapters consume this boundary rather than directly owning machine/container lifecycle. Harness-native sandboxing and permission controls remain enabled where supported as defence in depth; they do not replace platform execution-environment isolation.

The initial local provider preserves the existing trusted-runner/worktree model. OpenSandbox is the first managed sandbox candidate behind the same boundary and begins in `trial` status. The platform integrates it through a pinned SDK/API adapter and does not vendor or expose OpenSandbox internals as AI Engineering OS domain contracts.

OpenSandbox POC is a separately gated dependent slice. The minimum managed-provider contract is: prepare an isolated workspace from approved source/context, execute structured argv with `shell:false`, stream bounded output/events, perform scoped file/artifact operations, cancel execution, collect safe evidence, and destroy the environment. Pools, snapshots, Kubernetes multi-tenancy, Kata/gVisor selection, Credential Vault, and advanced networking remain provider capabilities enabled only after independent proof.

Managed sandbox tenancy never replaces AI Engineering OS tenancy/RBAC/audit authority. Provider credentials and personal subscription auth stores must not be copied into sandbox files, environment variables, snapshots, logs, or evidence merely to enable a managed execution path.

## 9. Outbound local runner

The runner uses outbound connectivity only: authenticate -> heartbeat -> claim -> verify signed envelope -> mark running -> execute -> checkpoint -> complete/fail.

It never exposes a general inbound remote-shell port. Workspace access is constrained beneath configured approved roots and task-specific worktrees. Traversal, absolute-path escape, and symlink escape are rejected.

Harness processes are invoked using structured command/argument arrays with `shell:false`. Untrusted task text never becomes shell syntax. Cancellation targets only the spawned task process tree.
## 10. Concrete harness adapters

The generic harness boundary on `main` is retained. Concrete adapters are thin runner-side implementations, not new platform architectures.

The initial siblings are:

- **Codex**: invokes the supported local Codex CLI/client using the user's existing local Codex authentication; reuses ECC Codex worktree/session evidence through a narrow adapter boundary.
- **Antigravity**: invokes the official `agy` terminal interface using existing local Google authentication; preserves the same signed-envelope, worktree, and `shell:false` controls.
- **Claude Code**: invokes the supported local Claude Code terminal interface using existing local Claude authentication; follows the same runner/harness contract and evidence restrictions.

Provider credential stores remain runner-local. The platform receives only safe capability, status, route/model metadata where available, and normalized execution evidence.

ECC already knows multiple harnesses including Codex, Claude Code, Cursor, Antigravity, Gemini CLI, and OpenCode. This slice reuses those catalogue/install/session assets where appropriate; it does not claim all inherited harnesses are already end-to-end remotely dispatchable.

**ECC reuse/productisation rule:** remaining execution, harness, agent, skill, MCP, memory, learning, eval, verification, security, browser-QA, autonomous-loop, context-optimisation, and cost/evidence items must be classified first as inherited capability to reuse/adapt/productise versus genuinely new platform infrastructure. A plan checkbox marked unfinished does not imply the underlying ECC capability is absent. Do not create a parallel replacement merely because the SaaS-facing adapter, governance, durable state, or UI surface is not yet implemented.

Production connection families remain `delegatable=false` until the corresponding real terminal vertical slice passes independently. `persistentSupported=true` is likewise enabled only when independently proven safe for that harness/runner behavior.

## 11. Native Review Council

The current manual review process becomes a first-class platform subsystem rather than an external convention.

**Supersession rule:** the AI Engineering OS Review Council protocol below supersedes the simpler inherited ECC single/fresh-review orchestration as the product acceptance council. Reuse suitable ECC review, eval, verification, TDD, security, and evidence primitives underneath it, but do not downgrade the product workflow to the legacy orchestration. The stronger blind multi-model, adjudication-before-remediation, rechallenge, fresh-source invalidation, and calibration semantics are authoritative.

Canonical flow:

`blind review -> normalize/deduplicate -> independent adjudication -> evidence classification -> RED/GREEN remediation -> private reviewer rechallenge for rejected/partial findings -> fresh blind review after source change -> calibration -> controlled context improvement`.
The council must support at least these native concepts: `ReviewRun`, `ReviewFinding`, `FindingAdjudication`, `ReviewerRechallenge`, `CalibrationSnapshot`, and `ArchitectureInvariant`.

Each material finding is adjudicated as `CONFIRMED`, `PARTIALLY_VALID`, `REJECTED`, or `INSUFFICIENT_EVIDENCE` with exact source/test evidence. Builder/model summaries carry no acceptance weight by themselves.

A confirmed Critical or Important finding blocks acceptance regardless of majority opinion. Majority voting cannot overturn independently verified evidence.

Blind means genuinely blind: comparative reviewers receive the same canonical source/evidence packet and no other reviewer's findings, scores, adjudications, or opinions. Rechallenge is private to the original reviewer and does not contaminate subsequent fresh blind runs.

Any material source change invalidates the prior comparative review for acceptance and requires fresh-source blind review. Timeout, empty, or malformed reviewer output is an availability failure, never a pass.

Calibration may improve future model selection by role/task/domain, but it records evidence such as observed correctness, false-positive rate, useful defect discovery, latency, cost, and availability against a model route/version. It must not encode `model X = permanent role Y`.

## 12. Council model selection

Council seats are roles/capability requirements, not model names. Example roles include general correctness, security, database/concurrency, architecture, and specialist domain review.

A council template may use `Auto` for every role, explicit approved models for controlled calibration, or candidate pools with ordered/fallback policy. The orchestrator resolves each seat to an eligible approved route at run creation and records the exact route/model/version used as evidence.

Independence policy may prevent multiple seats from resolving to the same provider/model family where meaningful diversity is required. This is policy, not a hard-coded list of today's vendors.

## 13. Administration and user experience

Platform administrators manage the approved/trial/disabled model catalogue, role candidate pools, cost/risk constraints, and council templates.

Users normally see `Auto` plus approved routes they are eligible to use through organisation APIs, OpenRouter, or their own authorised subscription harness connections. The UI must distinguish route/source, for example organisation API versus personal subscription, without exposing credentials.
## 14. Failure handling

The system fails closed at every authority boundary:

- unavailable/disabled/unapproved model route -> select another eligible route under policy or return a typed no-route result;
- offline/revoked/untrusted runner -> subscription connection becomes ineligible without deleting share history;
- expired/cancelled/tampered dispatch -> never execute;
- lost provider login -> report re-authentication required without uploading auth material;
- malformed harness result -> safe execution failure, not guessed success;
- reviewer timeout/empty/malformed output -> reviewer availability failure;
- confirmed material review defect -> gate remains blocked until evidence-backed remediation/re-adjudication;
- audit/persistence failure on material authority mutation -> transaction rollback.

Canonical project state remains readable and durable across execution/reviewer failures.

## 15. Testing and review strategy

All production behavior follows strict TDD: first deterministic RED proof, minimal implementation, focused GREEN, then broader regression.

Required gates include:

- OpenRouter multi-model adapter/runtime tests, route-id collision tests, and key-leakage tests;
- dispatch migration/repository integration tests against PostgreSQL 17, including atomic claim and terminal evidence durability;
- signing/tamper/expiry/replay/idempotency tests;
- runner workspace/path/symlink/process-isolation tests;
- fake-process adapter tests for Codex, Antigravity, and Claude Code before controlled live smokes;
- connection-pool tests proving each enabled subscription family requires its real compatible runner;
- council domain/persistence/orchestration tests for blind packets, adjudication, rechallenge isolation, source-change invalidation, calibration, and blocking semantics;
- web/API tests proving admin catalogue governance and user-visible eligible-model filtering;
- full platform tests, typecheck, production build, dependency audit, ECC compatibility/security gates, and fresh independent whole-slice review.

Review follows the product's own locked method. Material source changes trigger fresh blind review; no majority vote can waive an independently confirmed Critical/Important defect.
## 16. Delivery order

Implementation proceeds in bounded stages so accepted foundation code stays reviewable:

1. Port and adapt OpenRouter multi-model routing to current `ModelGateway`, including admin-governed catalogue integration points.
2. Port dispatch/signing/evidence only, using canonical runner contracts and a forward migration.
3. Add the execution-environment seam and complete the outbound runner loop/common workspace/process security boundary using the local provider.
4. Add Codex adapter and prove its terminal vertical slice; enable only its policy gate if green.
5. Add Antigravity adapter and prove its terminal vertical slice; enable only its policy gate if green.
6. Add Claude Code adapter and prove its terminal vertical slice; enable only its policy gate if green.
7. Implement native Review Council persistence/orchestration/calibration using swappable approved routes.
8. Add/administer model catalogue and council policy UI/API needed for production operation.
9. Run whole-slice security/regression/council gate, merge to local main, re-verify merged main, push, and verify exact remote CI.
10. Run the separately planned OpenSandbox trial POC behind the execution-environment provider; production enablement is a distinct gate.

Each stage ends with source/test evidence and independent review before the next material authority boundary is enabled.

## 17. Out of scope

- copying or pooling users' provider credentials;
- scraping consumer chat sessions;
- arbitrary remote shell access;
- hard-coding today's reviewer vendors/models as permanent council roles;
- auto-enabling every model returned by OpenRouter discovery;
- replacing canonical ECC session/worktree infrastructure with a competing schema;
- enabling deployment/destructive authority merely because a coding harness is connected;
- claiming persistent execution for a harness that has not independently proven it.

## 18. Acceptance criteria

This reconciliation slice is complete only when all of the following are true:
1. Canonical `main` runner identity/trust/heartbeat/pool/harness foundation remains authoritative and regression-green.
2. OpenRouter is available as a normal multi-model API provider with no model hard-coded to a permanent product role.
3. Admins can govern which configured/discovered models are approved, trial/calibration, or disabled; users see only approved eligible routes plus `Auto`.
4. Durable signed dispatch/evidence is reconciled without replacing migration 007 or duplicating runner authority.
5. Only the assigned eligible runner can claim/execute a valid unexpired task envelope, and tamper/replay/cancellation/revocation rules fail closed.
6. Execution environment is an explicit orthogonal dimension: harness adapters use a common provider boundary, local execution remains supported, and OpenSandbox can be added without changing harness/domain contracts.
7. Codex, Antigravity, and Claude Code each have a real thin adapter using supported local authentication and isolated task worktrees without exposing provider credentials to the platform.
8. Each subscription family becomes delegatable only after its own controlled terminal execution path is independently green.
9. Review Council runs are durable and blind; findings are normalized, evidence-backed, adjudicated, and re-challenged according to the locked loop.
10. A confirmed Critical or Important finding blocks acceptance independent of vote count; timeout/empty/malformed reviewer output is not a pass.
11. Any material source change invalidates acceptance review and requires a fresh blind run against the new source packet.
12. Calibration records route/model/version performance and can influence future `Auto`/role selection without permanently binding a model to a role.
13. Existing requester -> project pool -> organisation -> API fallback semantics and personal sharing rules remain unchanged.
14. No provider credential, runner plaintext token, signing private key, secret reference value, or local auth-store content is exposed in persistence, audit, evidence, logs, repository artefacts, or browser responses.
15. Fresh PostgreSQL integration tests, full platform tests, typecheck, production build, dependency audit, ECC compatibility/security gates, and independent review are green with zero unresolved Critical/Important findings.
16. The exact merged `main` SHA is pushed and its configured GitHub CI jobs are verified green before the slice is declared complete.
## 19. Source-branch salvage rule

Commits/files from `feature/agent-bridge-subscription-execution` are evidence and implementation candidates, not accepted source by ancestry. Every transplanted behavior is re-evaluated against current contracts and receives fresh tests/review in the reconciliation branch.

Known high-value candidates include the OpenRouter adapter/runtime tests, signed envelope/protocol concepts, dispatch repository/lifecycle, and runner dispatch route semantics. Known duplicate runner domain/repository/migration/service code is not transplanted wholesale.

This rule prevents old branch history from bypassing the stronger security and concurrency fixes already accepted into current `main`.