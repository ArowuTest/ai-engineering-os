# AI Engineering OS V1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first private, provider-neutral platform foundation around ECC with durable project/product state and PostgreSQL persistence.

**Architecture:** Keep ECC root unchanged and create an independent `platform/` TypeScript workspace. Domain rules are pure modules; persistence is PostgreSQL; the API composes modules; provider integrations depend on a model-gateway contract rather than provider SDKs.

**Tech Stack:** Node 22, TypeScript, npm workspaces, Vitest, Fastify, PostgreSQL, `pg`, Docker Compose.

## Global Constraints

- Work only on `platform-v1-foundation`, never `main`.
- New proprietary code lives under `platform/`, `extensions/` or `bridge/`.
- No live LLM credentials are required in this slice.
- All production behaviour follows test-first RED → GREEN → REFACTOR.
- Historical approved/revision records are append-only.
- Organisation/project boundaries are present on tenant-owned data.
- Provider and execution-route identity are separate concepts.
- GitHub receives tested batch checkpoints rather than file-by-file commits.

---## Planned File Structure

```text
platform/
├── package.json
├── tsconfig.base.json
├── vitest.config.ts
├── docker-compose.yml
├── .env.example
├── apps/api/
│   ├── src/server.ts
│   └── test/server.test.ts
├── packages/domain/
│   ├── src/project.ts
│   ├── src/product-knowledge.ts
│   ├── src/audit.ts
│   └── test/*.test.ts
├── packages/database/
│   ├── migrations/001_initial.sql
│   ├── src/client.ts
│   ├── src/project-repository.ts
│   ├── src/knowledge-repository.ts
│   └── test/*.integration.test.ts
├── packages/model-gateway/
│   ├── src/types.ts
│   ├── src/gateway.ts
│   └── test/gateway.test.ts
└── packages/ecc-adapter/
    ├── src/upstream.ts
    └── test/upstream.test.ts
```
### Task 1: Platform Workspace and Baseline Test Harness

**Files:**
- Create: `platform/package.json`
- Create: `platform/tsconfig.base.json`
- Create: `platform/vitest.config.ts`
- Create: `platform/.env.example`
- Create: `platform/docker-compose.yml`
- Test: `platform/test/workspace.test.ts`

**Interfaces:**
- Produces npm workspace scripts `test`, `test:unit`, `test:integration`, `typecheck`.
- Produces PostgreSQL dev service at `localhost:55432` with database `engineering_os_test`.

- [x] **Step 1: Write failing workspace contract test**

Test reads the platform manifests and asserts required workspace names/scripts and Docker database settings.

- [x] **Step 2: Run RED**

Run: `cd platform && npm test -- test/workspace.test.ts`
Expected: FAIL because the platform workspace/manifest does not yet exist.

- [x] **Step 3: Create minimal workspace configuration**

Use npm workspaces for `apps/*` and `packages/*`; install TypeScript, Vitest, Fastify and `pg` only when required by later tasks.

- [x] **Step 4: Run GREEN and typecheck**

Run: `npm test -- test/workspace.test.ts` and `npm run typecheck`.

- [x] **Step 5: Keep changes local for the batch**

Do not push yet.### Task 2: Core Domain Contracts

**Files:**
- Create: `platform/packages/domain/package.json`
- Create: `platform/packages/domain/src/project.ts`
- Create: `platform/packages/domain/src/product-knowledge.ts`
- Create: `platform/packages/domain/src/audit.ts`
- Create: `platform/packages/domain/src/index.ts`
- Test: `platform/packages/domain/test/project.test.ts`
- Test: `platform/packages/domain/test/product-knowledge.test.ts`

**Interfaces:**
- Produces `Project`, `ProductKnowledge`, `KnowledgeStatus`, `AuditEvent` types.
- Produces `createProject()` and `createKnowledgeRecord()` invariant-checking factories.

- [x] **Step 1: Write failing domain tests**

Tests must prove: projects require organisation/name; knowledge requires project/category/content; invalid lifecycle status is rejected; `inferred` does not become `approved` implicitly.

- [x] **Step 2: Run RED**

Run: `npm test -- packages/domain/test`.
Expected: FAIL because factories/types do not exist.

- [x] **Step 3: Implement minimal pure domain code**

No database, provider SDK or Fastify imports are permitted in the domain package.

- [x] **Step 4: Run GREEN**

Run: `npm test -- packages/domain/test` and `npm run typecheck`.

- [x] **Step 5: Refactor only while green**

Remove duplication and keep public exports explicit.### Task 3: PostgreSQL Schema and Repositories

**Files:**
- Create: `platform/packages/database/package.json`
- Create: `platform/packages/database/migrations/001_initial.sql`
- Create: `platform/packages/database/src/client.ts`
- Create: `platform/packages/database/src/project-repository.ts`
- Create: `platform/packages/database/src/knowledge-repository.ts`
- Test: `platform/packages/database/test/project-repository.integration.test.ts`
- Test: `platform/packages/database/test/knowledge-repository.integration.test.ts`

**Interfaces:**
- Consumes domain `Project` and `ProductKnowledge` contracts.
- Produces repository methods `create`, `getById`, `listByProject`, and append-only `addRevision`.

- [x] **Step 1: Start isolated PostgreSQL test service**

Run: `docker compose up -d postgres` from `platform/`.

- [x] **Step 2: Write failing integration tests**

Prove tenant/project scoping, project persistence, knowledge persistence, ordered revisions and historical revision immutability.

- [x] **Step 3: Run RED**

Run: `npm run test:integration -- packages/database/test`.
Expected: FAIL because schema/repositories are absent.

- [x] **Step 4: Create migration and minimal `pg` repositories**

Use explicit SQL migrations and parameterised queries. Do not introduce an ORM in this slice.

- [x] **Step 5: Run migration and GREEN tests**

Run migration command, integration tests and typecheck.

- [x] **Step 6: Verify a clean database can be recreated**

Destroy/recreate the Docker volume and rerun migration/tests.### Task 4: Provider-Neutral Model Gateway

**Files:**
- Create: `platform/packages/model-gateway/package.json`
- Create: `platform/packages/model-gateway/src/types.ts`
- Create: `platform/packages/model-gateway/src/gateway.ts`
- Create: `platform/packages/model-gateway/src/index.ts`
- Test: `platform/packages/model-gateway/test/gateway.test.ts`

**Interfaces:**
- Produces `ModelProvider`, `ExecutionRoute`, `ProviderCapabilities`, `ModelRequest`, `ModelResponse`, and `ModelGateway`.
- Keeps provider identity separate from subscription/API execution route.

- [x] **Step 1: Write failing contract tests**

Prove that the gateway can register multiple routes for one provider, select only routes satisfying required capabilities, and preserve route/cost metadata in responses.

- [x] **Step 2: Run RED**

Run: `npm test -- packages/model-gateway/test`.
Expected: FAIL because the contract is absent.

- [x] **Step 3: Implement interfaces plus deterministic in-memory route registry**

No OpenAI/Anthropic/Google SDK is installed in this task.

- [x] **Step 4: Run GREEN and typecheck**

Run the package tests and full platform typecheck.

- [x] **Step 5: Document adapter contract**

Add concise README/API comments describing how future subscription and API adapters implement the gateway.### Task 5: ECC Adapter Provenance and Trusted Baseline Metadata

**Files:**
- Create: `platform/packages/ecc-adapter/package.json`
- Create: `platform/packages/ecc-adapter/src/upstream.ts`
- Create: `platform/packages/ecc-adapter/src/index.ts`
- Test: `platform/packages/ecc-adapter/test/upstream.test.ts`

**Interfaces:**
- Reads `UPSTREAM.md`/baseline metadata without exposing arbitrary ECC internals.
- Produces `getAcceptedEccBaseline()` and a typed `EccBaseline` record.

- [x] **Step 1: Write failing provenance tests**

Prove the accepted commit is a 40-character SHA and upstream source is exactly the official ECC repository.

- [x] **Step 2: Run RED**

Run: `npm test -- packages/ecc-adapter/test`.

- [x] **Step 3: Implement the minimal baseline reader**

The adapter must fail closed if provenance is missing or malformed.

- [x] **Step 4: Run GREEN**

Run adapter tests and typecheck.

### Task 6: Platform API Composition and First Vertical Slice

**Files:**
- Create: `platform/apps/api/package.json`
- Create: `platform/apps/api/src/server.ts`
- Create: `platform/apps/api/src/app.ts`
- Test: `platform/apps/api/test/server.test.ts`

**Interfaces:**
- Consumes domain/database/model-gateway modules.
- Produces HTTP routes: `GET /health`, `POST /projects`, `GET /projects/:id`, `POST /projects/:id/knowledge`, `GET /projects/:id/knowledge`.
- [x] **Step 1: Write failing API tests**

Use Fastify injection to prove health, project creation/retrieval and knowledge creation/listing. Include tenant/project mismatch rejection.

- [x] **Step 2: Run RED**

Run: `npm test -- apps/api/test`.
Expected: FAIL because the API app is absent.

- [x] **Step 3: Implement the minimal Fastify composition root**

Route handlers call repository/domain interfaces; they do not embed SQL or provider-specific logic.

- [x] **Step 4: Run GREEN**

Run API tests, integration tests and typecheck.

### Task 7: Audit Events and Batch Verification

**Files:**
- Modify: `platform/packages/database/migrations/001_initial.sql`
- Create: `platform/packages/database/src/audit-repository.ts`
- Test: `platform/packages/database/test/audit-repository.integration.test.ts`
- Modify: `platform/apps/api/src/app.ts`

**Interfaces:**
- Produces append-only audit events for project and Product Knowledge creation.

- [x] **Step 1: Write failing audit integration test**

Prove project and knowledge creation produce immutable ordered audit events.

- [x] **Step 2: Run RED**

Run the audit integration test and confirm failure for the missing behaviour.

- [x] **Step 3: Implement minimal audit persistence and API hooks**

Do not implement a generic event bus yet.

- [x] **Step 4: Run full platform verification**

Run: `npm test`, `npm run typecheck`, recreate PostgreSQL, rerun integration tests.

- [x] **Step 5: Run ECC regression baseline**

From repository root run the appropriate ECC test suite after dependencies are installed.

- [x] **Step 6: Review diff against SRS/design**

Confirm no live provider credentials, no ECC core changes and no unresolved placeholders.

- [x] **Step 7: Create one meaningful batch commit and push**

Commit the approved docs plus V1 foundation implementation only after all required verification passes.