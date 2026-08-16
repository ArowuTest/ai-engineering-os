# Collaborative Memory & Parallel Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productise ECC Unified Memory and team-agent handoffs into a tenant-aware Collaborative Memory and Engineering Session subsystem that supports parallel agents/users, cross-harness continuation, Review Council isolation, and Local/OpenSandbox execution without making provider sessions canonical.

**Architecture:** PostgreSQL owns collaborative-memory authority, session identity, visibility, trust/promotion, handoffs and audit. ECC `ecc.memory.v1`, Memory Vault, CLI/MCP, cross-harness targeting and team-agent orchestration are reused through a thin `@engineering-os/ecc-adapter` interoperability boundary. Product Knowledge remains canonical product truth; Collaborative Memory is scoped execution/context state; Review Council consumes the same visibility/provenance layer instead of creating an independent memory silo.

**Tech Stack:** TypeScript, Node.js 22, Vitest 3, PostgreSQL 17, existing `@engineering-os/domain`, `@engineering-os/database`, `@engineering-os/ecc-adapter`, Fastify API composition, ECC Markdown memory/CLI/MCP contracts.

## Global Constraints

- Reuse before rebuild; preserve before replace; generalise before discard.
- Platform memory identity, tenancy, visibility and promotion authority live in PostgreSQL; local ECC vaults are interoperable representations/materialisations, not the SaaS source of authority.
- Product Knowledge, Collaborative Memory and Review Council state are distinct but linked domains.
- Provider/model/harness/runner/environment identifiers are references, never memory identity.
- Every production behavior follows RED -> verify RED -> minimal GREEN -> focused GREEN.
- No provider credential, private key, auth-store body, browser cookie or secret-like content may enter collaborative memory.
- User-private and reviewer-private memory fail closed; project membership or AI-connection sharing never broadens visibility implicitly.
- Review Council first-pass blindness must be enforced by the same memory/context visibility policy.
- OpenSandbox receives only explicitly materialised task-authorised context; no wholesale user vault or provider auth store is mounted.
- Expensive whole-platform verification/council runs happen after coherent batches, not after every few files.

---### Task 1: Collaborative Memory domain contracts

**Files:**
- Create: `platform/packages/domain/src/collaborative-memory.ts`
- Create: `platform/packages/domain/test/collaborative-memory.test.ts`
- Modify: `platform/packages/domain/src/index.ts`

**Interfaces:**
- Produces: `CollaborativeMemoryRecord`, `EngineeringSession`, `AgentHandoff`, `MemoryVisibility`, `MemoryTrustState`, `MemoryScope`, `MemoryLink`, validation/creation functions, and visibility predicates used by persistence/context assembly.
- Consumes: existing `DomainValidationError`, stable identifier and non-blank validators.

- [ ] **Step 1: Write RED tests** for tenant/project identity, memory scope/visibility/trust enums, stable content digest, secret-like content rejection, immutable provenance, session identity independent of harness/model, target-agent/session lists, handoff validation, and visibility decisions for user/session/workstream/project/reviewer/adjudicator contexts.
- [ ] **Step 2: Run** `npx vitest run platform/packages/domain/test/collaborative-memory.test.ts` and verify failures are caused only by missing domain exports/behavior.
- [ ] **Step 3: Implement minimal domain contracts** in `collaborative-memory.ts`; do not add persistence or retrieval logic here.
- [ ] **Step 4: Re-run the focused domain suite** and the existing Review Council domain suite; both must be green.
- [ ] **Step 5: Commit** `feat: define collaborative memory domain`.

### Task 2: Durable memory/session persistence and transactional authority

**Files:**
- Create: `platform/packages/database/migrations/009_collaborative_memory.sql`
- Create: `platform/packages/database/src/collaborative-memory-repository.ts`
- Create: `platform/packages/database/test/collaborative-memory.integration.test.ts`
- Modify: `platform/packages/database/src/index.ts`
- Modify: `platform/packages/database/src/unit-of-work.ts`

**Interfaces:**
- Produces: `CollaborativeMemoryRepository` with create/get/search/link/supersede operations; `EngineeringSessionRepository` operations may live in the same focused file initially if the file remains reviewable.
- Consumes: Task 1 domain validators and existing `DatabaseQueryable` / `DatabaseUnitOfWork` transaction pattern.

- [ ] **Step 1: Write RED PostgreSQL tests** for migration 009 schema, organisation/project scoping, create-only memory identity, session lifecycle, visibility columns, link/supersession integrity, handoffs, immediate membership/revocation filtering, and absence of credential fields.
- [ ] **Step 2: Add transaction RED proof** showing memory + handoff/audit mutation rolls back completely when the second material write fails.
- [ ] **Step 3: Run the focused integration file** against the isolated PostgreSQL 17 test database and confirm expected missing migration/repository failures.
- [ ] **Step 4: Implement migration/repository/unit-of-work wiring minimally**; prefer append/supersede history over in-place content mutation.
- [ ] **Step 5: Re-run focused persistence tests and migration-runner regression**; commit `feat: persist collaborative memory and sessions`.### Task 3: Context policy and parallel-session visibility

**Files:**
- Create: `platform/apps/api/src/collaborative-memory-policy.ts`
- Create: `platform/apps/api/test/collaborative-memory-policy.test.ts`
- Create: `platform/apps/api/src/engineering-session-service.ts`
- Create: `platform/apps/api/test/engineering-session-service.integration.test.ts`

**Interfaces:**
- Produces: `resolveMemoryVisibility(context, record)`, bounded context-selection helpers, and `EngineeringSessionService` create/checkpoint/handoff/continue operations.
- Consumes: Task 1 domain contracts, Task 2 repositories, current project membership/RBAC and runner/route references.

- [ ] **Step 1: Write RED policy tests** proving session-private isolation, workstream/project sharing, user-private exclusion, reviewer-private isolation, adjudication visibility only after blind collection, and stale/revoked membership denial.
- [ ] **Step 2: Write RED service integration tests** for two parallel sessions with different agents/harnesses, shared handoff, runner loss, and continuation through a replacement harness while preserving platform session/task identity.
- [ ] **Step 3: Verify RED**, then implement the minimal policy/service without model-specific branching.
- [ ] **Step 4: Prove context selection is bounded and explainable**: returned items include safe inclusion reasons/IDs, never raw hidden peer-review context or credentials.
- [ ] **Step 5: Run focused API/domain/database tests and commit** `feat: govern parallel engineering session context`.

### Task 4: ECC Memory Vault interoperability

**Files:**
- Create: `platform/packages/ecc-adapter/src/memory.ts`
- Create: `platform/packages/ecc-adapter/test/memory.test.ts`
- Modify: `platform/packages/ecc-adapter/src/index.ts`
- Modify: `platform/packages/ecc-adapter/package.json` only if the adapter needs the domain package explicitly.

**Interfaces:**
- Produces: ECC memory parse/normalise/materialise/import functions using `ecc.memory.v1` semantics and platform memory IDs/digests.
- Consumes: Task 1 memory contracts plus inherited `schemas/memory.schema.json`, `scripts/lib/memory-vault-format.js`, Memory Vault safety rules and target-harness semantics.

- [ ] **Step 1: Write RED adapter tests** from real ECC-compatible Markdown fixtures covering project/team kinds, source/target harnesses, links, create-only identity, stable digest/provenance, malformed frontmatter, secret rejection and conflict detection.
- [ ] **Step 2: Verify RED**, then implement a thin normaliser/materialiser rather than copying the ECC vault runtime into `platform/`.
- [ ] **Step 3: Prove platform-to-ECC materialisation cannot escape an approved task root** and cannot export reviewer-private/user-private records without explicit policy approval from the caller.
- [ ] **Step 4: Prove ECC import never overwrites platform authority**: same ID/same digest is idempotent; same ID/different digest returns typed conflict/supersession input.
- [ ] **Step 5: Run ECC unified-memory/cross-harness regressions plus adapter tests; commit** `feat: bridge ECC collaborative memory`.### Task 5: Review Council integration on shared memory/session substrate

**Files:**
- Retain/complete: `platform/packages/domain/src/review-council.ts`
- Retain/complete: `platform/packages/domain/test/review-council.test.ts`
- Create: `platform/packages/database/migrations/010_review_council.sql`
- Create: `platform/packages/database/src/review-council-repository.ts`
- Complete: `platform/packages/database/test/review-council.integration.test.ts`
- Create: `platform/apps/api/src/review-council-service.ts`
- Create: `platform/apps/api/test/review-council-service.integration.test.ts`
- Modify: database exports/unit-of-work as required.

**Interfaces:**
- Produces: durable blind review runs/assignments/findings/adjudications/rechallenges/calibration with context references governed by Tasks 1-3.
- Consumes: `EngineeringSession`, Collaborative Memory visibility/provenance, existing Review Council domain semantics, governed model routes and project membership.

- [ ] **Step 1: Preserve the already-green Review Council domain behavior** (current focused evidence: 12/12) and add RED integration tests only for the new shared-memory/session boundaries.
- [ ] **Step 2: Write/finish RED persistence tests** proving reviewer assignment packet digest identity, append-oriented findings/adjudications/rechallenges, calibration, rollback, and source invalidation.
- [ ] **Step 3: Implement migration 010/repository to GREEN** without duplicating memory content; reviewer-private context is represented through shared visibility/provenance references.
- [ ] **Step 4: Write RED service tests** proving all blind reviewers receive the same canonical packet, no peer findings leak, timeout/empty/malformed output is availability failure, private rechallenge reaches only the originating reviewer, and material source change creates fresh acceptance context.
- [ ] **Step 5: Implement service/orchestration minimally** and prove one confirmed/partially-valid Important/Critical finding blocks acceptance independent of vote count.
- [ ] **Step 6: Commit coherent Review Council persistence/service increments**; do not run the expensive full council until Task 6 freeze.

### Task 6: Coherent-batch verification and handover

**Files:**
- Modify: `docs/AI-ENGINEERING-OS-HANDOVER.md`
- Modify: this plan and the reconciliation plan with exact accepted evidence.

**Interfaces:**
- Produces: frozen source/evidence packet for Collaborative Memory + Review Council batch.
- Consumes: Tasks 1-5.

- [ ] **Step 1: Run focused Collaborative Memory, Engineering Session, ECC adapter and Review Council tests** and confirm no unresolved RED proofs.
- [ ] **Step 2: Run platform static/unit/type checks**, ECC `harness:adapters`, `harness:audit`, unified-memory/cross-harness tests and `git diff --check`.
- [ ] **Step 3: Run the full isolated PostgreSQL 17 integration suite** serialized against a fresh schema and record exact counts.
- [ ] **Step 4: Freeze exact source SHA and construct one bounded canonical acceptance packet** covering source, migration state, test evidence, threat/authority notes and known fail-closed limitations.
- [ ] **Step 5: Run one fresh blind multi-model Review Council** against that exact packet. Timeout/empty output is availability failure; independently confirmed Important/Critical blocks acceptance.
- [ ] **Step 6: For each confirmed/partially-valid defect, create a RED proof, remediate, GREEN, invalidate the old packet and repeat the fresh-source council only after source is frozen again.**
- [ ] **Step 7: Update handover with exact SHA/test/council evidence and commit documentation closeout before moving to model+harness catalogue release/UI work.**

## Plan self-review

- Spec coverage: Tasks 1-5 cover all first-slice requirements: domain, durable authority, parallel sessions, visibility, context assembly, handoffs, ECC interoperability, Review Council isolation and OpenSandbox-safe materialisation boundary.
- Deferred deliberately: semantic/vector reranking, automatic organisation-wide promotion, CRDT vault sync, unrestricted transcript ingestion and rich UI are not required for this slice.
- Type consistency: `EngineeringSession` and `CollaborativeMemoryRecord` originate in Task 1 and are consumed by persistence, policy, ECC adapter and Review Council; provider/harness/runner/environment remain references.
- Authority consistency: Product Knowledge remains canonical product truth; Collaborative Memory does not self-promote; Review Council does not create a second memory store.
- Review cadence: focused RED/GREEN throughout; broad verification and blind council once after the coherent batch is frozen.