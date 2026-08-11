# Routing Foundation + Review-First Product Knowledge Extraction Implementation Plan

> **Execution workflow:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Every production change follows RED → GREEN → REFACTOR.

**Goal:** Remove the current three-provider ceiling without breaking Product Studio, then implement automatic review-first Product Knowledge extraction through capability-qualified structured-output routes.

**Architecture:** Retain the existing `ModelGateway`, durable Product Studio state, PostgreSQL `DatabaseUnitOfWork`, RBAC and append-only audit model. Generalise provider/route identifiers through a forward-only migration, add `structuredOutput` to concrete route capabilities, and keep the existing OpenAI/Anthropic/Google API adapters as the first configured routes. Extraction uses a non-canonical candidate store with separate conversation and extraction persistence transitions. Product Owner acceptance is the only path from a candidate to canonical Product Knowledge.

**Out of scope:** personal AI connection administration, Do Not Share/Online Only/Persistent sharing, Agent Bridge, Codex/Claude Code/Antigravity subscription adapters, and ECC Engineering Studio execution. Those are separate later plans.

**References:**
- `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md` v1.3
- `docs/architecture/AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md` v1.3
- `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`
- `docs/superpowers/specs/2026-08-09-review-first-product-knowledge-extraction-design.md`

---

## Task 1 — Generalise provider identifiers in domain and gateway contracts

**Modify:**
- `platform/packages/domain/src/project.ts`
- `platform/packages/domain/src/product-studio.ts`
- `platform/packages/domain/test/project.test.ts`
- `platform/packages/domain/test/product-studio.test.ts`
- `platform/packages/model-gateway/src/types.ts`
- `platform/packages/model-gateway/src/gateway.ts`
- `platform/packages/model-gateway/test/gateway.test.ts`

### 1.1 RED — extensible Product Partner/provider attribution

Add domain tests proving:
- project preference `future-provider` is accepted;
- `future-provider.v2` can replace the current Product Partner;
- conversation message attribution `future-provider` is accepted;
- `auto` remains valid as the Product Partner routing sentinel;
- blank, uppercase, unsafe and >64-character provider IDs are rejected.

Use one runtime provider-ID grammar:

```text
^[a-z0-9][a-z0-9._-]{0,63}$
```

Run:

```bash
cd platform
npx vitest run packages/domain/test/project.test.ts packages/domain/test/product-studio.test.ts
```

Expected RED: current closed arrays reject future providers.

### 1.2 GREEN — replace closed domain validity with stable-ID validation

In `project.ts`:
- keep `auto` as the routing sentinel;
- validate any other preference with the provider-ID grammar;
- export `INITIAL_PRODUCT_PARTNERS = ['openai', 'anthropic', 'google'] as const` only as an initial catalogue/UI convenience, not domain validity.

In `product-studio.ts`:
- replace `MESSAGE_PROVIDERS` closed validation with the same stable-ID rule;
- keep provider attribution optional.

Re-run Task 1.1 command. Expected GREEN.

### 1.3 RED — arbitrary provider + multiple routes/models

In `gateway.test.ts`, add tests proving:
- `provider: 'future-provider'` can register and execute;
- two models for one provider coexist under different route IDs;
- duplicate route IDs still fail;
- invalid route ID/provider ID/blank model fail registration.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
```

### 1.4 GREEN — generalise gateway provider identity

In `types.ts`:
- replace the closed `ModelProvider` union with an extensible string provider identifier while retaining the exported name for compatibility;
- leave `ExecutionMode` and `CostType` unchanged.

In `gateway.ts`:
- validate route ID and provider ID with the stable-ID grammar;
- require nonblank model name;
- preserve current eligibility/ranking semantics.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
npm run typecheck
```

Commit:

```bash
git add packages/domain packages/model-gateway
git commit -m "refactor: generalise provider and route identifiers"
```

---

## Task 2 — Forward-only migration 004 for extensible provider IDs

**Create:**
- `platform/packages/database/migrations/004_extensible_execution_routes.sql`
- `platform/packages/database/test/extensible-execution-routes.integration.test.ts`

**Do not modify:**
- `platform/packages/database/migrations/002_product_studio.sql`

### 2.1 RED — prove old checks are closed and migration 004 is required

The integration test must build/apply migrations 001–003, then prove:
- `preferred_product_partner = 'future-provider'` fails before 004;
- `conversation_messages.provider = 'future-provider'` fails before 004.

After invoking the normal migration runner with 004 present, assert:
- future provider IDs succeed;
- `auto` remains valid for project preference;
- null message provider remains valid;
- blank/unsafe IDs fail;
- `schema_migrations` records 004 exactly once;
- repeated `runMigrations()` is idempotent.

Run Docker PostgreSQL:

```powershell
cd platform
docker compose up -d postgres
$env:DATABASE_URL='postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test'
npx vitest run packages/database/test/extensible-execution-routes.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected RED before migration implementation.

### 2.2 GREEN — implement migration 004

`004_extensible_execution_routes.sql`:
- `DROP CONSTRAINT IF EXISTS projects_preferred_product_partner_check`;
- add a check allowing `auto` or the stable provider-ID regex;
- `DROP CONSTRAINT IF EXISTS conversation_messages_provider_check`;
- add a check allowing null or the stable provider-ID regex;
- preserve data, defaults, indexes and foreign keys;
- create no provider/connection tables.

Never edit applied migration 002.

Run:

```powershell
cd platform
npx vitest run packages/database/test/extensible-execution-routes.integration.test.ts --maxWorkers=1 --no-file-parallelism
npm run test:integration
```

Commit:

```bash
git add packages/database/migrations/004_extensible_execution_routes.sql packages/database/test/extensible-execution-routes.integration.test.ts
git commit -m "refactor: remove closed provider database checks"
```

---

## Task 3 — Add explicit structured-output route capability and generic schema contract

**Modify:**
- `platform/packages/model-gateway/src/types.ts`
- `platform/packages/model-gateway/src/gateway.ts`
- `platform/packages/model-gateway/test/gateway.test.ts`
- `platform/packages/model-gateway/src/openai-adapter.ts`
- `platform/packages/model-gateway/src/anthropic-adapter.ts`
- `platform/packages/model-gateway/src/gemini-adapter.ts`
- `platform/packages/model-gateway/test/provider-adapters.test.ts`

### 3.1 RED — capability routing

Add `structuredOutput` expectations to route fixtures and tests proving:
- normal chat can use `structuredOutput: false`;
- `requiredCapabilities: ['chat', 'structuredOutput']` excludes that route;
- a route with structured output wins when required even if another route has better priority.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
```

### 3.2 GREEN — capability field

Add:

```ts
structuredOutput: boolean;
```

to `ProviderCapabilities`. Update every current adapter and test fixture explicitly. Do not provide an implicit default.

### 3.3 RED — generic structured response contract

Add tests for a request contract shaped as:

```ts
export interface JsonSchemaResponseContract {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}
```

and optional:

```ts
responseContract?: JsonSchemaResponseContract;
```

on `ModelRequest`.

Prove the gateway passes the contract unchanged to the selected adapter. Capability remains caller-requested; merely attaching a schema must not silently bypass route eligibility.

### 3.4 GREEN — contract implementation

Keep `AdapterExecutionResult.content` as the provider-neutral response body. Structured adapters return schema-constrained JSON text in `content`; Product Studio parses the product-specific envelope.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
npm run typecheck
```

Commit:

```bash
git add packages/model-gateway
git commit -m "feat: add structured output route capability"
```

---

## Task 4 — Translate structured-output requests in current API adapters

**Modify:**
- `platform/packages/model-gateway/src/openai-adapter.ts`
- `platform/packages/model-gateway/src/anthropic-adapter.ts`
- `platform/packages/model-gateway/src/gemini-adapter.ts`
- `platform/packages/model-gateway/test/provider-adapters.test.ts`

### 4.1 RED — provider translation tests

Using existing injected fake clients, assert the same generic test JSON schema is mapped to:
- OpenAI Responses API JSON Schema response format;
- Anthropic Messages `output_config.format` JSON Schema format;
- Google Gemini Interactions `response_format` JSON Schema format.

Also prove ordinary chat requests without `responseContract` remain compatible.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/provider-adapters.test.ts
```

### 4.2 GREEN — minimal adapter translation

Modify only provider request construction. Do not add Product Knowledge parsing to adapters.

Each adapter must:
- advertise `structuredOutput: true` only after its translation test passes;
- return schema-constrained text through `content`;
- preserve usage normalisation;
- return safe `ProviderExecutionError` for unusable output;
- never log credentials.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/provider-adapters.test.ts packages/model-gateway/test/gateway.test.ts
npm run typecheck
```

Commit:

```bash
git add packages/model-gateway
git commit -m "feat: support structured output across API adapters"
```

---

## Task 5 — Candidate domain model + Product Partner envelope

**Create:**
- `platform/packages/domain/src/knowledge-candidate.ts`
- `platform/packages/domain/test/knowledge-candidate.test.ts`

**Modify:**
- `platform/packages/domain/src/index.ts`
- `platform/apps/api/src/product-partner-context.ts`
- `platform/apps/api/test/product-partner-context.test.ts`

### 5.1 RED — candidate invariants and fingerprint

Define/test:

```ts
type KnowledgeCandidateBasis = 'user_stated' | 'assistant_inferred' | 'assistant_recommended';
type KnowledgeCandidateStatus = 'pending' | 'accepted' | 'rejected';
type KnowledgeExtractionRunStatus = 'received' | 'succeeded' | 'failed';
```

Create one canonical extraction category list using current Product Studio identifiers plus non-duplicate SRS categories. Do not create aliases such as both `security` and `security_requirements`.

Test:
- category/basis/title/content validation;
- initial candidate status always `pending`;
- stable SHA-256 fingerprint across case/whitespace-only variation;
- changed content changes fingerprint;
- AI input cannot manufacture an accepted/rejected candidate.

Fingerprint source:

```text
lower(category) + U+001F + collapseWhitespace(lower(title)) + U+001F + collapseWhitespace(lower(content))
```

Run:

```bash
cd platform
npx vitest run packages/domain/test/knowledge-candidate.test.ts
```

### 5.2 GREEN — domain constructors/parsers

Implement:
- extraction-run constructor;
- pending-candidate constructor;
- review transition validation;
- fingerprinting;
- structured envelope parser that validates a nonblank top-level `answer` separately from candidate validation.

This separation is required so usable answer + bad candidates can keep the answer and fail only extraction.

### 5.3 RED — Product Partner structured request

Update `product-partner-context.test.ts` to require:

```ts
requiredCapabilities: ['chat', 'structuredOutput']
```

and a versioned response contract named `product_partner_knowledge_v1` with required `answer` + `candidates` and enumerated category/basis values.

Run:

```bash
cd platform
npx vitest run apps/api/test/product-partner-context.test.ts packages/domain/test/knowledge-candidate.test.ts
```

### 5.4 GREEN — request builder

In `product-partner-context.ts`:
- add the JSON Schema contract;
- update system instruction for `answer`, candidate semantics and basis labels;
- require `chat + structuredOutput`;
- preserve current bounded canonical Product Knowledge + durable conversation context.

Run targeted tests + typecheck.

Commit:

```bash
git add packages/domain apps/api/src/product-partner-context.ts apps/api/test/product-partner-context.test.ts
git commit -m "feat: define Product Knowledge extraction contract"
```

---

## Task 6 — Migration 005 + candidate/run repository

**Create:**
- `platform/packages/database/migrations/005_product_knowledge_candidates.sql`
- `platform/packages/database/src/knowledge-candidate-repository.ts`
- `platform/packages/database/test/knowledge-candidates.integration.test.ts`

**Modify:**
- `platform/packages/database/src/index.ts`
- `platform/packages/database/src/unit-of-work.ts`

### 6.1 RED — persistence invariants

Test:
- tenant/project/conversation/message foreign-key scope;
- run state `received → succeeded|failed` only;
- immutable candidate source fields after insert;
- `pending → accepted|rejected` once only;
- pending fingerprint uniqueness scoped by organisation/project/category;
- project/status listing isolation;
- `SELECT ... FOR UPDATE` review path resolves concurrent decisions once;
- project deletion cascades candidate/run rows safely.

Run:

```powershell
cd platform
npx vitest run packages/database/test/knowledge-candidates.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

### 6.2 GREEN — migration 005

Create `knowledge_extraction_runs` with:
- UUID PK;
- organisation/project/conversation/source message IDs;
- provider/model/route ID;
- contract version;
- status `received|succeeded|failed`;
- safe failure code/message;
- created/completed timestamps.

Create `knowledge_candidates` with:
- UUID PK;
- organisation/project/run IDs;
- category/title/original content/basis;
- status `pending|accepted|rejected`;
- fingerprint;
- reviewer/time;
- accepted canonical knowledge ID;
- rejection reason;
- created timestamp.

Add:
- project/status indexes;
- partial unique index for pending fingerprint;
- DB trigger preventing updates to source fields while allowing review-state fields.

### 6.3 GREEN — repository API

Implement `KnowledgeCandidateRepository` methods:
- `createRun`;
- `getRunById`;
- `markRunSucceeded`;
- `markRunFailed`;
- `insertCandidate`;
- `listByProject`;
- `getCandidateForUpdate`;
- `acceptCandidateDecision`;
- `rejectCandidateDecision`.

Every query takes explicit organisation/project scope.

Add the repository to `TransactionRepositories` in `unit-of-work.ts` and export it from `index.ts`.

Run:

```powershell
cd platform
npx vitest run packages/database/test/knowledge-candidates.integration.test.ts --maxWorkers=1 --no-file-parallelism
npm run test:integration
npm run typecheck
```

Commit:

```bash
git add packages/database
git commit -m "feat: persist Product Knowledge extraction candidates"
```

---

## Task 7 — Failure-isolated live Product Partner extraction

**Create:**
- `platform/apps/api/src/product-partner-turn-service.ts`

**Modify:**
- `platform/apps/api/src/app.ts`
- `platform/apps/api/test/live-product-partner.integration.test.ts`

### 7.1 RED — normal one-operation extraction

Update test fake adapters to advertise structured output and return valid JSON envelope.

Assert one live turn:
- invokes model once on normal path;
- stores user message once;
- stores assistant `answer` only, never raw envelope JSON;
- creates `received` then `succeeded` extraction run;
- creates pending candidates;
- creates **zero** canonical Product Knowledge from AI output;
- returns execution metadata + extraction `{runId,status,candidateCount}`.

### 7.2 GREEN — focused turn service and Transaction A/B

Move orchestration out of the large route into `product-partner-turn-service.ts`.

Normal flow:
1. build structured request;
2. execute eligible route;
3. parse usable answer + raw candidates;
4. build user/assistant messages + extraction run;
5. **Transaction A:** messages + mandatory audits + `received` run marker;
6. validate/deduplicate candidate set;
7. **Transaction B:** candidate rows + candidate audit events + run `succeeded` atomically;
8. return answer/execution/extraction summary.

HTTP identity/RBAC stays in `app.ts`.

### 7.3 RED/GREEN — usable answer + invalid candidates

Test invalid candidate with valid answer. Expected:
- HTTP turn succeeds;
- conversation persists;
- extraction run becomes failed with safe code;
- no invalid candidate persists;
- no canonical mutation.

Implement failure transition after Transaction A.

### 7.4 RED/GREEN — candidate insert fault

Inject failure during candidate insertion. Prove Transaction B rolls back all candidate rows but Transaction A remains committed. Mark run failed separately.

### 7.5 RED/GREEN — structured call fails before usable answer

Test at most one recovery call with plain `chat` request:
- original user message persisted once;
- recovered assistant answer persisted once;
- extraction run failed/retryable;
- no duplicate conversation message.

Implement exceptional one-call recovery path only when no usable answer exists.

Run:

```powershell
cd platform
npx vitest run apps/api/test/live-product-partner.integration.test.ts --maxWorkers=1 --no-file-parallelism
npm run typecheck
```

Commit:

```bash
git add apps/api/src apps/api/test/live-product-partner.integration.test.ts
git commit -m "feat: extract Product Knowledge candidates from live turns"
```

---

## Task 8 — Deterministic duplicate suppression

**Modify:**
- `platform/apps/api/src/product-partner-turn-service.ts`
- `platform/apps/api/test/live-product-partner.integration.test.ts`
- `platform/packages/domain/src/knowledge-candidate.ts`
- `platform/packages/domain/test/knowledge-candidate.test.ts`
- `platform/packages/database/src/knowledge-candidate-repository.ts`
- `platform/packages/database/test/knowledge-candidates.integration.test.ts`

### 8.1 RED

Test:
- duplicate candidates in one envelope → one pending row;
- duplicate of current pending candidate → no new row;
- duplicate of current canonical Product Knowledge → no new row;
- same content in a different category remains distinct;
- rejected historical candidate does not by itself block re-proposal.

### 8.2 GREEN

Before insert:
- deduplicate response candidates by category/fingerprint;
- compare with pending fingerprints;
- compute equivalent fingerprints for latest canonical Product Knowledge;
- retain DB partial unique index as race backstop.

No vectors, embeddings or second model call.

Run:

```powershell
cd platform
npx vitest run packages/domain/test/knowledge-candidate.test.ts apps/api/test/live-product-partner.integration.test.ts packages/database/test/knowledge-candidates.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

Commit:

```bash
git add packages/domain packages/database apps/api
git commit -m "feat: suppress duplicate knowledge candidates"
```

---

## Task 9 — Review/accept/reject/retry API with RBAC and atomic audit

**Create:**
- `platform/apps/api/src/knowledge-candidate-service.ts`
- `platform/apps/api/test/knowledge-candidates.integration.test.ts`

**Modify:**
- `platform/apps/api/src/app.ts`
- `platform/apps/api/test/auth-http.integration.test.ts`
- `platform/packages/database/src/knowledge-candidate-repository.ts`

### 9.1 RED — list and RBAC

For:

```text
GET /projects/:id/knowledge-candidates?status=pending
```

prove all project readers can see scoped candidates while non-members/cross-tenant users cannot.

For accept/reject/retry prove only `product_owner` succeeds; Contributor/Engineer/Reviewer/Viewer get 403.

### 9.2 RED — acceptance atomicity

For:

```text
POST /projects/:id/knowledge-candidates/:candidateId/accept
```

with optional edited category/title/content, assert one UoW transaction:
- locks pending candidate;
- creates canonical Product Knowledge revision 1 as `confirmed`;
- records explicit extraction-candidate provenance;
- marks candidate accepted + canonical ID + reviewer/time;
- appends acceptance + canonical-creation audit.

Fault-inject audit failure and assert all changes roll back. Original AI candidate source fields stay immutable.

### 9.3 GREEN — acceptance service

Implement in `knowledge-candidate-service.ts`; return 409 if candidate already decided.

### 9.4 RED/GREEN — rejection

For:

```text
POST /projects/:id/knowledge-candidates/:candidateId/reject
```

assert terminal rejection + reviewer/time/optional reason + audit, with zero canonical mutation. Implement row-lock transaction and 409 on repeat decision.

### 9.5 RED/GREEN — extraction-only retry

For:

```text
POST /projects/:id/extraction-runs/:runId/retry
```

assert:
- failed run only;
- persisted source user/assistant turn used;
- current canonical context used;
- candidate-only structured request performed;
- no user/assistant conversation message appended;
- new retry attempt/provenance recorded;
- duplicate suppression applied;
- retry requested/completed/failed audited.

Implement a dedicated candidate-only schema request; do not regenerate conversation answer.

Run:

```powershell
cd platform
npx vitest run apps/api/test/knowledge-candidates.integration.test.ts apps/api/test/auth-http.integration.test.ts apps/api/test/live-product-partner.integration.test.ts --maxWorkers=1 --no-file-parallelism
npm run typecheck
```

Commit:

```bash
git add apps/api packages/database
git commit -m "feat: add Product Knowledge candidate review API"
```

---

## Task 10 — Generalise Product Studio web contracts and route eligibility

**Create:**
- `platform/test/web-provider-contract.test.mjs`

**Modify:**
- `platform/apps/web/lib/api.ts`
- `platform/apps/web/app/projects/[id]/page.tsx`

### 10.1 RED — static contract

Test source/API contracts no longer declare provider fields as the closed `'openai'|'anthropic'|'google'` union, while initial selector options remain Auto/OpenAI/Claude/Gemini.

Assert `ModelRouteSummary` exposes capabilities including `chat` and `structuredOutput`.

Run:

```bash
cd platform
node --test test/web-provider-contract.test.mjs
```

### 10.2 GREEN — web types and provider labels

In `lib/api.ts`:
- use string provider IDs;
- expose route capabilities;
- add extraction summary to live-turn result.

In Product Studio page:
- use a fixed initial option array for Auto/OpenAI/Claude/Gemini;
- use fallback provider-label formatting for future provider message attribution;
- consider a Product Partner live only if a matching available route has both `chat` and `structuredOutput`.

Run:

```bash
cd platform
node --test test/web-provider-contract.test.mjs
npm run typecheck
```

Commit:

```bash
git add apps/web test/web-provider-contract.test.mjs
git commit -m "refactor: make Product Studio route-capability aware"
```

---

## Task 11 — Product Studio Review Queue UI

**Create:**
- `platform/test/product-knowledge-review-ui.test.mjs`

**Modify:**
- `platform/apps/web/lib/api.ts`
- `platform/apps/web/app/actions.ts`
- `platform/apps/web/app/projects/[id]/page.tsx`
- `platform/apps/web/app/globals.css`

### 11.1 RED — UI contract

Static source/contract test must find:
- Review Queue surface;
- pending candidate list API usage;
- Accept action;
- Edit & Accept fields/action;
- Reject action;
- retry failed extraction action.

Use the existing Node test layer; do not introduce a new browser framework solely for this slice.

### 11.2 GREEN — web API + actions

Add candidate/run types and client functions:
- list candidates;
- accept candidate;
- reject candidate;
- retry extraction.

Add server actions:
- `acceptKnowledgeCandidateAction`;
- `rejectKnowledgeCandidateAction`;
- `retryKnowledgeExtractionAction`.

Reviewer identity comes from API authentication, never form input.

### 11.3 GREEN — Review Queue rendering

Load candidate/recent extraction state with studio/model routes.

Cards show:
- category/title/content;
- basis;
- provider/model/route provenance;
- source turn;
- review status.

Product Owners receive Accept, Edit & Accept, Reject and retry controls. Other roles see read-only queue. Obtain effective role from authorised API state; never trust a browser-supplied role.

Successful assistant answer remains visible even if extraction failed. Show compact states such as:
- `3 candidates ready for review`;
- `No new candidates`;
- `Knowledge extraction failed — retry available`.

Style only the Review Queue additions in `globals.css`; preserve current three-region Product Studio layout.

Run:

```bash
cd platform
node --test test/product-knowledge-review-ui.test.mjs
npm run typecheck
npm run build --workspace @engineering-os/web
```

Commit:

```bash
git add apps/web test/product-knowledge-review-ui.test.mjs
git commit -m "feat: add Product Knowledge review queue UI"
```

---

## Task 12 — Clean-volume regression and exact CI-equivalent verification

### 12.1 Fresh Docker PostgreSQL

```powershell
cd platform
docker compose down -v
docker compose up -d postgres
$env:DATABASE_URL='postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test'
```

Confirm the container is healthy before tests.

### 12.2 Platform gates

```powershell
cd platform
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build --workspace @engineering-os/web
npm audit signatures
npm audit --omit=dev --audit-level=high
```

Expected: all green; no new high-severity runtime vulnerability from this slice.

### 12.3 ECC compatibility gates — exact CI commands

From repository root:

```powershell
npm ci --ignore-scripts
node scripts/ci/validate-agents.js
node scripts/ci/validate-hooks.js
node scripts/ci/validate-commands.js
node scripts/ci/validate-skills.js
node scripts/ci/validate-install-manifests.js
node scripts/ci/validate-rules.js
node scripts/ci/validate-workflow-security.js
node scripts/ci/validate-derivative-ecc-catalog.js --text
npm run command-registry:check
node scripts/ci/check-unicode-safety.js
node scripts/ci/validate-no-personal-paths.js
npm run security:ioc-scan
```

Expected: all green.

### 12.4 Local product smoke

Run API + web against Docker PostgreSQL and verify:
1. Product Owner logs in and opens/creates project;
2. live structured Product Partner turn stores human-readable answer;
3. pending candidates appear separately;
4. refresh/restart preserves conversation + queue;
5. accept candidate → canonical `confirmed` Product Knowledge;
6. reject candidate → no canonical mutation;
7. switch Product Partner → state persists;
8. Viewer reads queue but cannot accept/reject;
9. extraction failure keeps answer visible and exposes retry;
10. retry does not duplicate conversation messages.

Automated CI must use fake/deterministic adapters, not paid live-provider calls.

### 12.5 Neon validation rule

If an already-authorised Neon test/staging connection exists, run migrations and non-destructive integration smoke there. If no connection is configured, record Neon as **not executed**; never claim it passed.

### 12.6 Diff/security gate

From repo root:

```powershell
git diff --check
git status --short
git diff main...HEAD -- platform docs/product docs/architecture docs/superpowers
```

Confirm:
- migrations 001–003 unchanged;
- only forward migrations 004/005 added;
- no accidental ECC core edits;
- no credentials/secrets;
- no Agent Bridge/personal-entitlement implementation leaked into this branch;
- no API/model path can create canonical knowledge without Product Owner acceptance.

### 12.7 Remote SHA gate

Push the implementation branch and verify **the exact pushed SHA** in `Engineering OS CI`. Old badge/history is insufficient.

Only then is the slice merge-ready.

---

## Merge acceptance checklist

- [ ] Future stable provider IDs pass domain/gateway/DB validation.
- [ ] OpenAI/Anthropic/Google existing API routes remain compatible.
- [ ] Multiple route IDs/models coexist per provider.
- [ ] Migration 002 untouched; migration 004 removes closed checks forward-only.
- [ ] `structuredOutput` is explicit per route.
- [ ] Product Partner normal path requires `chat + structuredOutput`.
- [ ] One normal structured model operation yields answer + zero/more candidates.
- [ ] Conversation remains durable if extraction persistence fails.
- [ ] Migration 005 stores extraction runs + non-canonical candidates.
- [ ] Invalid/failed extraction cannot create canonical Product Knowledge.
- [ ] Duplicate suppression checks pending + canonical state without another model call.
- [ ] Only Product Owner can accept/reject/retry.
- [ ] Acceptance atomically creates `confirmed` canonical knowledge + decision + audit.
- [ ] Rejection never mutates canonical knowledge.
- [ ] Concurrent review resolves once.
- [ ] Retry is extraction-only and adds no duplicate conversation messages.
- [ ] Product Studio still presents Auto/OpenAI/Claude/Gemini initially.
- [ ] Web/API provider types no longer impose a three-provider ceiling.
- [ ] Review Queue shows provenance and extraction failure state.
- [ ] Docker clean-volume tests pass.
- [ ] Typecheck + production Next.js build pass.
- [ ] Authentication/collaboration regressions pass.
- [ ] ECC compatibility/security gates pass.
- [ ] No provider credential, subscription secret or hidden reasoning appears in API/UI/audit contracts.

## Follow-on plans — deliberately separate

After this slice is green, create and execute separate plans for:

1. **AI connection + project delegation administration** — `ai_connections`, shares, Do Not Share/Online Only/Persistent, usage limits, RBAC, audit.
2. **Agent Bridge + subscription harness adapters** — scoped runner auth/health and officially supported Codex/Claude Code/Antigravity routes.
3. **ECC-backed Engineering Studio execution** — approved ECC agent/skill enumeration, harness/session adapters, worktrees, checkpoints and independent review.

Do not fold those subsystems into this extraction branch.
