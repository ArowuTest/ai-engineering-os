# Studio Requirements Assurance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable, governed assurance infrastructure whose first profile independently reviews Product Studio requirements and produces durable readiness evidence before engineering planning.

**Architecture:** Add a domain-neutral Assurance run/finding/readiness contract and persistence layer. Product Requirements Assurance supplies a versioned profile and uses an independently eligible `requirements_reviewer` agent/model route against an exact digest of governed Studio state. Findings inform the Lead but never mutate canonical Product Knowledge.

**Tech Stack:** TypeScript, Node.js, Fastify, PostgreSQL 17, Vitest, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-08-20-studio-requirements-assurance-design.md`

## Global Constraints

- Continue inside `feature/subscription-execution-reconciled`; do not create another worktree.
- TDD is mandatory: RED before production changes.
- Requirements Reviewer is an agent capability; model route is independently governed.
- No assurance result may silently mutate canonical Product Knowledge.
- Reviewer unavailability produces insufficient evidence, never a pass.
- Keep Task 9 one uncommitted coherent WIP boundary until full gate/council acceptance.

### Task 1: Generic Assurance domain

**Files:**
- Create: `platform/packages/domain/src/assurance.ts`
- Modify: `platform/packages/domain/src/index.ts`
- Test: `platform/packages/domain/test/assurance.test.ts`

**Produces:** `AssuranceRun`, `AssuranceFinding`, `AssuranceReadiness`, constructors, exact-target invalidation/readiness evaluation.

- [x] Write RED tests for bounded enums/text/evidence, exact target digest, open material findings blocking readiness, research-required blocking, insufficient evidence, and changed-target invalidation.
- [x] Run focused domain test and verify intended RED.
- [x] Implement minimal generic domain contract.
- [x] Run focused domain + existing Review Council/Collaborative Memory tests GREEN.

### Task 2: Durable Assurance persistence

**Files:**
- Create: `platform/packages/database/migrations/015_assurance.sql`
- Create: `platform/packages/database/src/assurance-repository.ts`
- Modify: database exports/UoW
- Test: `platform/packages/database/test/assurance-repository.integration.test.ts`

**Produces:** tenant/project-scoped durable runs/findings with current-run lookup and exact target digest.

- [x] RED repository/UoW tests including cross-project isolation and duplicate finding identity.
- [x] Implement migration/repository/UoW wiring.
- [x] Run database tests GREEN on PostgreSQL 17.

### Task 3: Product Requirements Assurance profile + reviewer execution

**Files:**
- Create: `platform/apps/api/src/requirements-assurance-profile.ts`
- Create: `platform/apps/api/src/requirements-assurance-service.ts`
- Modify: `platform/packages/model-gateway/src/types.ts`
- Test: `platform/apps/api/test/requirements-assurance-service.integration.test.ts`

**Consumes:** Capability Estate, ModelGateway, Project/Conversation/Knowledge repositories, AssuranceRepository.
**Produces:** exact governed snapshot/digest, structured reviewer request, durable findings/readiness.

- [x] RED: reviewer agent must be eligible/released; reviewer model route resolves independently from Product Partner; output is structured; source snapshot includes governed history/knowledge; timeout/malformed output cannot pass; findings never mutate Product Knowledge.
- [x] Add `requirements_reviewer` model role and `product_requirements_v1` profile/output schema.
- [x] Implement minimal service using exact route constraint returned by capability governance.
- [x] GREEN focused service + ModelGateway regressions.

### Task 4: HTTP lifecycle and Lead feedback loop

**Files:**
- Modify: `platform/apps/api/src/app.ts`, `server.ts`, `product-partner-context.ts`
- Test: new/adjacent Studio integration tests.

- [x] RED: create assurance review endpoint; read latest readiness/findings; changed target invalidates stale readiness; unresolved material findings are supplied to Product Partner as review questions/context, not canonical knowledge.
- [x] Implement minimal routes and context integration.
- [x] GREEN HTTP + mature Product Partner transaction/recovery tests.

### Task 5: Studio readiness surface

**Files:**
- Modify: `platform/apps/web/lib/api.ts`, `app/actions.ts`, `app/projects/[id]/page.tsx`
- Test: `platform/test/studio-requirements-assurance-ui.test.mjs` plus focused executable helpers where useful.

- [x] RED: Studio exposes latest Requirements Readiness, material unresolved findings/questions and a governed review trigger; no finding is presented as an approved requirement.
- [x] Implement minimal UI/API client wiring.
- [x] GREEN UI contract, web typecheck and Next build.

### Task 6: Documentation + substantial Task-9 gate

**Files:**
- Modify SRS v1.7, technical architecture v1.7, Task-9 plan, handover.

- [x] Record reusable Assurance substrate and Product Requirements profile; PS-007 becomes automatic independent assurance at meaningful checkpoints rather than only user-requested cross-model challenge.
- [ ] Re-run artifact normalization/upload, Studio selectors, capability estate, Product Partner, Review Council and Assurance focused suites.
- [ ] Run root/web typecheck, production build, dependency audit and `git diff --check`.
- [ ] Include Requirements Assurance in Task-9 A/B/C requirement-to-code reconciliation and eventual exact-source blind council packet.
- [ ] Do not promote Task 9 to `main` until the entire accepted boundary passes its required council/adjudication cycle. Verified coherent checkpoints may be committed on the feature branch to keep WIP bounded.
