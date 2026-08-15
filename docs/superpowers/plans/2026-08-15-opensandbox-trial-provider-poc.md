# OpenSandbox Trial Provider POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenSandbox as the first trial managed execution-environment provider without transferring AI Engineering OS state, tenancy, orchestration, harness, or credential authority to OpenSandbox.

**Architecture:** Implement a thin anti-corruption adapter behind the generic `ExecutionEnvironmentProvider` created by the reconciliation plan. Use the official TypeScript SDK/API with an exact tested version pin; local Docker is the first functional POC, while Kubernetes/Kata, pools, snapshots, multi-tenancy, Credential Vault, and advanced networking remain separately gated capabilities.

**Tech Stack:** TypeScript/Node.js 22, official `@alibaba-group/opensandbox` SDK, Docker Desktop staging, Vitest, existing AI Engineering OS runner/evidence contracts.

## Global Constraints

- OpenSandbox status begins `trial`, never `supported` or `production` by installation alone.
- Do not vendor the upstream OpenSandbox server/controller/execd/egress codebase into AI Engineering OS.
- Pin exact SDK/image versions or immutable digests used by the POC; never depend on `latest` for accepted evidence.
- AI Engineering OS remains tenancy/RBAC/audit/state authority.
- Personal Codex/Claude/Google subscription credential stores are not mounted or copied into managed sandboxes.
- Generic environment contracts contain no OpenSandbox-specific types.
- Structured argv + `shell:false` semantics remain the platform contract even if OpenSandbox exposes shell-string conveniences.
- Every production adapter behavior follows RED -> verify RED -> minimal GREEN -> broader GREEN -> commit.

---
### Task 1: Add pinned OpenSandbox adapter package

**Files:**
- Create: `platform/packages/execution-environment-opensandbox/package.json`
- Create: `platform/packages/execution-environment-opensandbox/src/opensandbox-provider.ts`
- Create: `platform/packages/execution-environment-opensandbox/src/index.ts`
- Create: `platform/packages/execution-environment-opensandbox/test/opensandbox-provider.test.ts`
- Modify: `platform/package.json`

**Interfaces:**
- Implements: generic `ExecutionEnvironmentProvider` only.
- Internal dependency: exact tested `@alibaba-group/opensandbox` version.

- [ ] **Step 1: Write RED contract tests** using an injected SDK client facade for create/prepare, structured execute, cancellation, scoped files/artifacts, bounded events, and destroy.
- [ ] **Step 2: Verify RED** with focused Vitest command and confirm the failure is absence of provider implementation.
- [ ] **Step 3: Install an exact SDK version** after verifying current upstream package/release compatibility; record the chosen version in package lock and POC evidence.
- [ ] **Step 4: Implement minimal adapter translation** without leaking upstream SDK models into generic domain types.
- [ ] **Step 5: Verify GREEN** contract tests + typecheck; compare behavior with the local provider contract helper.
- [ ] **Step 6: Commit** `feat: add OpenSandbox trial execution provider`.

### Task 2: Prove workspace materialisation, execution, streaming, and teardown on local Docker

**Files:**
- Create: `platform/packages/execution-environment-opensandbox/test/opensandbox-docker.integration.test.ts`
- Create: `infra/opensandbox/poc/` configuration with exact image/version pins.

**Interfaces:**
- Consumes: trial provider and staging OpenSandbox server.
- Produces: reproducible execution evidence including provider/version/image/environment identity.
- [ ] **Step 1: Write RED Docker integration tests** for repository/workspace copy, stdout/stderr streaming, non-zero exit normalization, file read/write, timeout/cancel, and guaranteed sandbox destruction.
- [ ] **Step 2: Verify RED** with OpenSandbox unavailable/adapter incomplete so the test demonstrates the missing vertical slice.
- [ ] **Step 3: Start only POC-specific OpenSandbox/Docker resources**; do not modify or delete unrelated project containers.
- [ ] **Step 4: Implement the minimum lifecycle bridge** needed for the tests; keep provider server address/API key as runtime configuration.
- [ ] **Step 5: Verify GREEN repeatedly**, including failure cleanup and a fresh sandbox per material test case.
- [ ] **Step 6: Commit** `test: prove OpenSandbox Docker execution lifecycle`.

### Task 3: Enforce AI Engineering OS policy and credential boundaries

**Files:**
- Create: `platform/packages/execution-environment-opensandbox/src/policy.ts`
- Create: `platform/packages/execution-environment-opensandbox/test/policy.test.ts`
- Modify: trial provider evidence mapping.

**Interfaces:**
- Produces: platform-owned environment profile validation and safe provider metadata.
- Rejects: personal auth-store mounts, raw secret env values, arbitrary host mounts, unbounded network/open ingress, and unsupported profile capabilities.

- [ ] **Step 1: Write RED tests** for forbidden `~/.codex`, Claude/Google auth paths, secret-like env fields, host-path escape, mutable image tags in accepted-evidence mode, and disallowed network policy.
- [ ] **Step 2: Verify RED**, then implement minimal fail-closed profile validation.
- [ ] **Step 3: Add safe evidence** for provider ID, OpenSandbox version, environment profile, image reference/digest when available, network profile, timestamps, outcome, and sandbox ID; never persist API keys/vault values.
- [ ] **Step 4: Verify GREEN** policy + provider contract tests.
- [ ] **Step 5: Commit** `fix: harden OpenSandbox execution policy`.

### Task 4: Prove representative engineering workloads

**Files:**
- Extend: `platform/packages/execution-environment-opensandbox/test/opensandbox-docker.integration.test.ts`
- Add: POC fixture projects under test fixtures only.
- [ ] **Step 1: Add RED cases** for Node/TypeScript build+test, Go build+test, PostgreSQL client/service access where the profile permits it, Redis where permitted, and Playwright/Chromium in the browser profile.
- [ ] **Step 2: Verify each RED independently** before adding profile/image capability.
- [ ] **Step 3: Add the minimum approved POC image/profile support** required to make each workload green; record exact versions.
- [ ] **Step 4: Verify GREEN** and demonstrate that denied-network profiles cannot silently gain package/internet access.
- [ ] **Step 5: Run failure-path repetitions** for cancel, provider outage, command failure, and teardown to check for orphaned sandboxes.
- [ ] **Step 6: Commit workload proofs** in bounded increments rather than one image/config mega-change.

### Task 5: Integrate trial provider with runner selection and gate promotion

**Files:**
- Modify: runner environment-provider registry/configuration.
- Modify: admin/provider status API/UI only if required for trial selection.
- Modify: `docs/AI-ENGINEERING-OS-HANDOVER.md`.
- Add: `docs/superpowers/reviews/` POC review evidence after source freeze.

**Interfaces:**
- Produces: selectable `local | opensandbox` environment policy with OpenSandbox marked `trial`.
- Does not change: harness identity, model route identity, runner trust authority, or user subscription credential handling.

- [ ] **Step 1: Write RED selection tests** proving a task may request/resolve `opensandbox` only when the provider is configured, healthy, permitted by policy, and the required environment capabilities are available.
- [ ] **Step 2: Implement minimal provider registry wiring** and keep fallback behavior explicit; never silently downgrade a task requiring managed isolation to local execution.
- [ ] **Step 3: Run an end-to-end governed dispatch** through OpenSandbox using a non-personal API-backed harness/model path and persist normalized evidence.
- [ ] **Step 4: Run fresh independent security/reliability review** of the exact adapter/policy/POC evidence; adjudicate findings through the native/manual locked loop as available.
- [ ] **Step 5: Keep status `trial` unless all promotion criteria are independently green**. Kubernetes/Kata production architecture is a later gate, not inferred from Docker success.
- [ ] **Step 6: Update handover** with exact versions, limits, upstream issues/caveats, and next production-hardening steps.
- [ ] **Step 7: Commit** `docs: record OpenSandbox trial evidence`.

## Plan self-review checklist

- The plan internalises OpenSandbox capability through an adapter, not a vendor fork.
- Local Docker proves functionality only; it does not claim hostile multi-tenant production isolation.
- Subscription auth remains local; API-backed managed execution is tested separately.
- Pools/snapshots/Kubernetes/Kata/Credential Vault are not enabled merely because upstream supports them.
- Promotion requires independent evidence and can remain `trial` indefinitely without blocking local execution.
