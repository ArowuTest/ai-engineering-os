# Provider-Neutral AI Connections & Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing AI Connection + ModelGateway foundation so approved platform/organisation/user connections can discover/reconcile connection-scoped model routes without making OpenRouter or any named provider the architecture.

**Architecture:** Keep AI Connections as credential/ownership authority, ModelGateway as execution authority, and Capability Estate as governance/release/eligibility authority. Add a provider-neutral adapter seam between connections and model-route candidates; provider/model/connection identity remains explicit and discovery never grants execution.

**Tech Stack:** TypeScript, PostgreSQL, Vitest, Fastify, Next.js, existing `@engineering-os/domain`, `database`, `model-gateway`, Capability Estate and AI Connection services.

**Spec:** `docs/superpowers/specs/2026-08-20-extensibility-commercialisation-foundation-design.md`

## Global Constraints

- Preserve existing AI Connection/secret-reference authority; never store or expose raw provider credentials in route/catalogue records.
- OpenRouter is a provider family/reference only; the core seam must support native, aggregator, OpenAI-compatible and private/enterprise providers.
- The same logical model through two different connections/providers is two distinct routes.
- Discovered routes start non-executable until Capability Estate governance/release/eligibility and technical checks pass.
- Explicit provider/model/connection selection is exact-or-fail-closed unless fallback is explicitly authorised.
- Ordinary-user Studio defaults remain conversation-first/`Auto`; connection/provider detail is progressively disclosed.
- Do not build bespoke adapters for every provider, full FinOps, provider marketplace or enterprise procurement administration in Task 9.

---
### Task 1: Provider-neutral connection adapter contract

**Files:**
- Create: `platform/apps/api/src/ai-connection-provider-adapter.ts`
- Modify: `platform/apps/api/src/ai-connection-policy.ts`
- Test: `platform/apps/api/test/ai-connection-provider-adapter.test.ts`

**Interfaces:**
- Consumes: existing `AIConnectionRecord`, trusted connection-family policy and secret-reference semantics.
- Produces: adapter registry + safe connection validation/discovery result contracts with no raw credential output.

- [x] Write RED tests proving multiple provider families can register behind one adapter interface, duplicate adapter IDs fail, and safe discovery output cannot expose secret material.
- [x] Run the focused test and confirm failure at the missing adapter boundary.
- [x] Implement the minimal provider-adapter/registry contract and extend trusted family policy with adapter/protocol identity without changing credential authority.
- [x] Re-run focused tests GREEN and adjacent AI Connection policy/domain tests.

### Task 2: Connection-scoped model-route identity

**Files:**
- Modify: `platform/packages/model-gateway/src/types.ts`
- Modify: `platform/packages/model-gateway/src/gateway.ts`
- Test: `platform/packages/model-gateway/test/gateway.test.ts`

**Interfaces:**
- Consumes: `ModelRoute` and explicit `preferredRouteId` routing.
- Produces: route provenance that can distinguish provider/model/connection owner/reference while preserving existing static platform routes.
- [x] Write RED tests proving the same `model` through two connection-backed routes remains distinct and explicit route selection never silently substitutes another connection.
- [x] Add optional connection provenance to route/response evidence with backward compatibility for platform-managed static routes.
- [x] Re-run ModelGateway focused tests including the established 19-test regression set.

### Task 3: Durable discovery/reconciliation into Capability Estate

**Files:**
- Modify: `platform/apps/api/src/ai-connection-service.ts`
- Modify: `platform/apps/api/src/capability-estate-service.ts`
- Modify/Create database repository/migration only if live reconciliation proves persistence cannot use existing capability metadata safely.
- Test: `platform/apps/api/test/ai-connection-service.integration.test.ts`
- Test: `platform/apps/api/test/capability-estate-governance.integration.test.ts`

**Interfaces:**
- Consumes: validated connection + provider-adapter model catalogue.
- Produces: deterministic connection-scoped candidate route records/capabilities that begin discovered/unverified and are not auto-released.

- [x] Write RED tests for discovery → candidate reconciliation, stable repeat discovery, removed/unavailable model handling and no auto-release/eligibility.
- [x] Implement the smallest durable reconciliation path, reusing Capability Estate instead of creating a parallel model catalogue where possible.
- [x] Prove tenant/connection isolation and that user-owned connection routes cannot expose credential refs/secrets to collaborators.
- [x] Re-run AI Connection + Capability Estate integration suites serially on an isolated PostgreSQL database.

### Task 4: Reference adapter and OpenAI-compatible extension seam

**Files:**
- Create one reference provider adapter behind Task-1 contract using an already-supported provider path.
- Create: `platform/apps/api/src/openai-compatible-connection-provider.ts` only if the contract cannot express the reference path without provider-specific leakage.
- Test: focused injected-client adapter tests; no live network dependency.
- [x] RED: prove a compatible provider can return model catalogue entries that become candidate routes without granting unsupported capabilities by protocol assumption.
- [x] GREEN: implement one reference discovery adapter plus generic base-URL/protocol seam where safe.
- [x] Prove provider failures are bounded/safe and do not mutate existing eligible routes into executable state without successful reconciliation.

### Task 5: Studio connection/model selection productisation

**Files:**
- Modify: `platform/apps/web/lib/api.ts`
- Modify: `platform/apps/web/app/projects/[id]/page.tsx`
- Modify: `platform/apps/web/app/actions.ts`
- Test: existing Studio static/UI tests plus new connection-route UX tests.

**Interfaces:**
- Consumes: governed eligible connection-scoped routes.
- Produces: ordinary-user `Auto` default plus advanced exact provider/connection/model selection with provenance labels.

- [x] RED: prove ordinary users can use the composer without selecting Provider/Connection/Harness/Environment and advanced users can expand exact connection-backed model choices.
- [x] GREEN: group/search eligible model choices by managed/user/organisation connection without exposing route IDs/secrets as primary UX.
- [x] Keep Agents, Skills, MCPs and Connectors discoverable in project capability surfaces rather than permanent composer clutter.
- [ ] Run web typecheck, static UX tests, accessibility assertions and production Next build. Typecheck/static UX/production build are GREEN; live accessibility/responsive browser verification remains pending.

### Task 6: Task-9 reconciliation and acceptance evidence

- [ ] Update the mandatory A/B/C matrix with `EXT-FR-017..020` and exact code/test evidence.
- [x] Classify bespoke provider integrations, provider marketplace, FinOps and full commercial BYOC administration as C unless new evidence changes the decision.
- [ ] Run focused provider/connection/model tests, full deterministic platform gate, dependency audit and `git diff --check`.
- [ ] Freeze/fingerprint exact source; include provider-neutral connection/routing and ordinary-user UX in the blind council packet.
- [ ] Adjudicate findings, reproduce genuine defects RED, batch remediate, re-gate and fresh-review changed source before Task-9 acceptance.
