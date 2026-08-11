# Routing Foundation + Review-First Product Knowledge Extraction Implementation Plan

> **For execution:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Follow TDD: RED → GREEN → REFACTOR for every production change.

**Goal:** Remove the current three-provider ceiling without disrupting the existing Product Studio, then implement automatic review-first Product Knowledge extraction through capability-qualified structured-output routes.

**Architecture:** Preserve the existing provider-neutral `ModelGateway`, durable Product Studio state, PostgreSQL `DatabaseUnitOfWork`, RBAC and audit model. Generalise provider/route identifiers through a forward-only migration, add `structuredOutput` to concrete route capabilities, and keep the current OpenAI/Anthropic/Google API adapters as the first configured routes. Build extraction as a separate non-canonical candidate store with two persistence transitions: conversation + extraction-run marker first, then candidate persistence/run completion. Product Owner acceptance is the only operation that creates canonical Product Knowledge from a candidate.

**Scope boundary:** This plan does **not** implement personal AI connections, Do Not Share/Online Only/Persistent administration, Agent Bridge, Codex/Claude Code/Antigravity subscription adapters, or ECC Engineering Studio execution. Those are separate later plans built on the execution-route contracts established here.

**Primary references:**
- `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md` v1.3
- `docs/architecture/AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md` v1.3
- `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`
- `docs/superpowers/specs/2026-08-09-review-first-product-knowledge-extraction-design.md`

---

## Task 1 — Generalise provider identifiers in domain and gateway contracts

**Files:**
- Modify: `platform/packages/domain/src/project.ts`
- Modify: `platform/packages/domain/src/product-studio.ts`
- Modify: `platform/packages/domain/test/project.test.ts`
- Modify: `platform/packages/domain/test/product-studio.test.ts`
- Modify: `platform/packages/model-gateway/src/types.ts`
- Modify: `platform/packages/model-gateway/src/gateway.ts`
- Modify: `platform/packages/model-gateway/test/gateway.test.ts`

### Step 1.1 — Write failing domain tests for extensible provider IDs

Add tests proving:
- `createProject(... preferredProductPartner: 'mistral')` succeeds;
- `changeProjectProductPartner(project, 'future-provider.v2')` succeeds;
- blank, whitespace, uppercase/unsafe and overlong provider identifiers fail runtime validation;
- `auto` remains valid only as the Product Partner routing sentinel;
- `createConversationMessage(... provider: 'future-provider')` succeeds;
- invalid provider message attribution fails.

Use one stable provider-ID grammar in both project preference and message attribution:

```text
^[a-z0-9][a-z0-9._-]{0,63}$
```

Run:

```bash
cd platform
npx vitest run packages/domain/test/project.test.ts packages/domain/test/product-studio.test.ts
```

Expected RED: current closed `PRODUCT_PARTNERS` / `MESSAGE_PROVIDERS` reject the new provider IDs.

### Step 1.2 — Implement minimal extensible domain validation

In `project.ts`:
- retain `auto` as the Product Partner sentinel;
- replace the closed provider enum validation with the provider-ID grammar above;
- export initial UI/provider choices separately from the domain validity rule, e.g. `INITIAL_PRODUCT_PARTNERS = ['openai', 'anthropic', 'google'] as const`;
- keep `ProductPartner` API-compatible as a string-like preference so existing project persistence remains unchanged.

In `product-studio.ts`:
- remove the closed `MESSAGE_PROVIDERS` validity rule;
- validate optional provider attribution using the same stable provider-ID grammar;
- do not make conversation messages depend on an external provider catalogue being online.

Run the same test command.

Expected GREEN: existing OpenAI/Anthropic/Google tests and new future-provider tests pass.

### Step 1.3 — Write failing gateway tests for arbitrary providers and multiple route IDs

Add tests proving:
- a route with `provider: 'future-provider'` registers and executes;
- multiple models for one provider can coexist under distinct route IDs;
- duplicate route IDs still fail even when model/provider differ;
- invalid/blank route IDs, provider IDs or model names are rejected at registration.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
```

Expected RED: `ModelProvider` is still the closed OpenAI/Anthropic/Google union and registration has no stable-ID validation.

### Step 1.4 — Generalise gateway types and registration validation

In `types.ts`:
- change provider identity from a closed union to an extensible stable identifier (`ModelProvider` may remain as a compatibility alias for string provider IDs);
- retain `ExecutionMode` and `CostType` unchanged;
- do **not** add connection/runner fields yet.

In `gateway.ts`:
- validate route ID/provider/model at `register()`;
- keep route ID uniqueness as the gateway identity key;
- preserve eligibility, subscription-first, metered-API and priority behaviour.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
```

Expected GREEN.

### Step 1.5 — Typecheck and commit

Run:

```bash
cd platform
npm run typecheck
```

Commit:

```bash
git add platform/packages/domain platform/packages/model-gateway
git commit -m "refactor: generalise provider and route identifiers"
```

---

## Task 2 — Add forward-only database migration for extensible provider IDs

**Files:**
- Create: `platform/packages/database/migrations/004_extensible_execution_routes.sql`
- Create: `platform/packages/database/test/extensible-execution-routes.integration.test.ts`
- Do not modify: `platform/packages/database/migrations/002_product_studio.sql`

### Step 2.1 — Write failing PostgreSQL migration tests

Test against a database that has migrations 001–003 applied. Prove that before migration 004:
- project `preferred_product_partner = 'future-provider'` is rejected;
- assistant `conversation_messages.provider = 'future-provider'` is rejected.

Then run normal migration execution and assert:
- `004_extensible_execution_routes.sql` is recorded once in `schema_migrations`;
- the same future provider values are accepted afterward;
- `auto` remains accepted for `projects.preferred_product_partner`;
- blank/unsafe provider IDs remain rejected;
- a second `runMigrations()` is idempotent and does not reapply 004.

Run with Docker PostgreSQL:

```bash
cd platform
docker compose up -d postgres
$env:DATABASE_URL='postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test' # PowerShell
npm run test:integration -- packages/database/test/extensible-execution-routes.integration.test.ts
```

On POSIX shells use:

```bash
DATABASE_URL=postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test npm run test:integration -- packages/database/test/extensible-execution-routes.integration.test.ts
```

Expected RED: migration 004 does not exist and the old checks remain closed.

### Step 2.2 — Implement migration 004

`004_extensible_execution_routes.sql` must:
- drop the auto-generated closed checks from `projects.preferred_product_partner` and `conversation_messages.provider` using their current constraint names with `IF EXISTS`;
- add new checks using the agreed lower-case stable provider-ID grammar;
- allow `projects.preferred_product_partner = 'auto'`;
- allow `conversation_messages.provider IS NULL`;
- preserve all existing data and indexes;
- make no provider-registry tables yet.

Never rewrite migration 002; deployed migration history is immutable.

### Step 2.3 — Re-run database test and full integration migrations

Run the targeted test, then:

```bash
cd platform
npm run test:integration
```

Expected GREEN.

### Step 2.4 — Commit

```bash
git add platform/packages/database/migrations/004_extensible_execution_routes.sql \
        platform/packages/database/test/extensible-execution-routes.integration.test.ts
git commit -m "refactor: remove closed provider database checks"
```

---

## Task 3 — Make route capability explicit for structured output

**Files:**
- Modify: `platform/packages/model-gateway/src/types.ts`
- Modify: `platform/packages/model-gateway/src/gateway.ts`
- Modify: `platform/packages/model-gateway/test/gateway.test.ts`
- Modify: `platform/packages/model-gateway/src/openai-adapter.ts`
- Modify: `platform/packages/model-gateway/src/anthropic-adapter.ts`
- Modify: `platform/packages/model-gateway/src/gemini-adapter.ts`
- Modify: `platform/packages/model-gateway/test/provider-adapters.test.ts`

### Step 3.1 — Write failing route-capability tests

Extend `ProviderCapabilities` tests to require:

```ts
structuredOutput: boolean
```

Add gateway tests proving:
- ordinary `chat` can use a route with `structuredOutput: false`;
- a request requiring `['chat', 'structuredOutput']` rejects that route;
- an otherwise lower-priority route with `structuredOutput: true` is selected when structured output is required.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/gateway.test.ts
```

Expected RED: capability does not exist.

### Step 3.2 — Add `structuredOutput` capability to route contracts

Add the boolean to `ProviderCapabilities`. Update all existing route fixtures/adapters explicitly; no implicit default should hide unsupported capability.

For the three current official API adapters, set `structuredOutput: true` only because Task 4 will implement and verify the provider-specific schema contract before the batch is considered complete.

Run gateway tests.

Expected GREEN.

### Step 3.3 — Add a generic structured response request contract

In `types.ts`, add:

```ts
export interface JsonSchemaResponseContract {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}
```

Add optional `responseContract?: JsonSchemaResponseContract` to `ModelRequest`.

Keep `AdapterExecutionResult.content` as the provider-neutral response body. For a structured request, adapters return the provider's schema-constrained JSON text in `content`; Product Studio owns the product-specific envelope parser. This avoids teaching the gateway about Product Knowledge.

Add a gateway test proving the request passes unchanged to the selected adapter and that `structuredOutput` is required by the caller, not inferred from `responseContract` silently.

Run targeted gateway tests.

### Step 3.4 — Commit

```bash
git add platform/packages/model-gateway
git commit -m "feat: add structured output route capability"
```

---

## Task 4 — Implement structured-output translation in the three current API adapters

**Files:**
- Modify: `platform/packages/model-gateway/src/openai-adapter.ts`
- Modify: `platform/packages/model-gateway/src/anthropic-adapter.ts`
- Modify: `platform/packages/model-gateway/src/gemini-adapter.ts`
- Modify: `platform/packages/model-gateway/test/provider-adapters.test.ts`

### Step 4.1 — Write failing adapter contract tests

For each adapter, inject the existing fake client and execute a `ModelRequest` with a small test JSON schema. Assert the provider call receives the provider-native schema option and the returned `content` contains the schema-constrained JSON text.

The expected provider translations are:
- OpenAI Responses API: JSON Schema structured response format for the request;
- Anthropic Messages API: `output_config.format` using JSON Schema;
- Google Gemini Interactions: `response_format` using JSON Schema.

Also test ordinary chat requests without `responseContract` remain byte-for-byte compatible with current behaviour.

Run:

```bash
cd platform
npx vitest run packages/model-gateway/test/provider-adapters.test.ts
```

Expected RED: adapters ignore the response contract.

### Step 4.2 — Implement provider translations minimally

Modify only adapter request construction. Do not add Product Knowledge-specific prompts or parsing to provider adapters.

Each adapter must:
- map the generic schema contract to its provider SDK request;
- return safe `ProviderExecutionError` on unusable/blank output;
- continue normal usage normalisation;
- avoid logging schema payloads or credentials.

### Step 4.3 — Re-run adapter + gateway tests

```bash
cd platform
npx vitest run packages/model-gateway/test/provider-adapters.test.ts packages/model-gateway/test/gateway.test.ts
```

Expected GREEN.

### Step 4.4 — Commit

```bash
git add platform/packages/model-gateway
git commit -m "feat: support structured output across API adapters"
```

---

## Task 5 — Add extraction candidate domain model and response-envelope validation

**Files:**
- Create: `platform/packages/domain/src/knowledge-candidate.ts`
- Create: `platform/packages/domain/test/knowledge-candidate.test.ts`
- Modify: `platform/packages/domain/src/index.ts`
- Modify: `platform/apps/api/src/product-partner-context.ts`
- Modify: `platform/apps/api/test/product-partner-context.test.ts`

### Step 5.1 — Write failing candidate-domain tests

Define and test:

```ts
KnowledgeCandidateBasis =
  | 'user_stated'
  | 'assistant_inferred'
  | 'assistant_recommended';

KnowledgeCandidateStatus = 'pending' | 'accepted' | 'rejected';
KnowledgeExtractionRunStatus = 'received' | 'succeeded' | 'failed';
```

Add a canonical machine category list for extraction based on the SRS while retaining current Product Studio identifiers (`vision`, `objectives`, `users`, `business_model`, `functional_requirements`, `non_functional_requirements`, `user_journeys`, `business_rules`, `integrations`, `security`, `data`, `risks`) and the additional approved SRS categories without introducing semantic aliases.

Tests must prove:
- valid candidate input is trimmed/normalised;
- invalid basis/category/blank title/content is rejected;
- deterministic fingerprint is stable for whitespace/case-only textual variation;
- materially different content changes the fingerprint;
- candidate initial status is always `pending`;
- AI input cannot create a candidate already marked accepted/rejected.

Fingerprint algorithm for V1:

```text
sha256(lower(category) + U+001F + collapseWhitespace(lower(title)) + U+001F + collapseWhitespace(lower(content)))
```

The project boundary is enforced by DB query/index scope rather than encoded into the fingerprint itself.

Run:

```bash
cd platform
npx vitest run packages/domain/test/knowledge-candidate.test.ts
```

Expected RED.

### Step 5.2 — Implement candidate domain objects

Create constructors/validators for:
- extraction runs;
- pending candidates;
- review transition inputs;
- fingerprinting;
- Product Partner structured envelope parsing.

Separate top-level answer parsing from candidate validation so a valid nonblank `answer` can survive invalid `candidates` data as required by the failure-isolation design.

Expose the new domain module from `src/index.ts`.

### Step 5.3 — Write failing Product Partner request tests

Update `product-partner-context.test.ts` to assert normal live Product Partner requests now include:

```ts
requiredCapabilities: ['chat', 'structuredOutput']
```

and the Product Partner response contract uses a versioned JSON schema, e.g. `product_partner_knowledge_v1`, whose top level requires `answer` and `candidates` and whose candidate `basis`/`category` values are enumerated.

Keep routing preference semantics unchanged for now: API routes remain allowed and Product Studio does not yet depend on personal connections.

Run:

```bash
cd platform
npx vitest run apps/api/test/product-partner-context.test.ts packages/domain/test/knowledge-candidate.test.ts
```

Expected RED before modifying the request builder.

### Step 5.4 — Implement the structured Product Partner request

In `product-partner-context.ts`:
- add the versioned JSON schema contract;
- update the system instruction so the schema fields mean what the domain validator expects;
- require `chat` + `structuredOutput`;
- preserve canonical Product Knowledge and durable history context construction.

### Step 5.5 — Commit

```bash
git add platform/packages/domain platform/apps/api/src/product-partner-context.ts \
        platform/apps/api/test/product-partner-context.test.ts
git commit -m "feat: define Product Knowledge extraction contract"
```

---

## Task 6 — Add candidate/run PostgreSQL persistence as migration 005

**Files:**
- Create: `platform/packages/database/migrations/005_product_knowledge_candidates.sql`
- Create: `platform/packages/database/src/knowledge-candidate-repository.ts`
- Modify: `platform/packages/database/src/index.ts`
- Modify: `platform/packages/database/src/unit-of-work.ts`
- Create: `platform/packages/database/test/knowledge-candidates.integration.test.ts`

### Step 6.1 — Write failing migration/repository integration tests

Test:
- migration 005 creates `knowledge_extraction_runs` and `knowledge_candidates`;
- both tables require organisation/project scope and valid foreign-key relationships;
- cross-organisation/project reads return nothing;
- a run starts `received` and can transition only to `succeeded` or `failed`;
- candidate original category/title/content/basis/fingerprint/run provenance cannot be rewritten after insertion;
- review fields can transition pending → accepted/rejected exactly once;
- a project-scoped partial unique index prevents duplicate **pending** fingerprints;
- concurrent review attempts allow only one terminal decision;
- deleting a project cascades its runs/candidates but candidate acceptance links safely to canonical knowledge.

Run against Docker PostgreSQL.

Expected RED: migration/repository do not exist.

### Step 6.2 — Implement migration 005

Create:

`knowledge_extraction_runs`
- UUID primary key;
- organisation/project/conversation IDs;
- source user/assistant message IDs;
- provider/model/route strings validated nonblank;
- `response_contract_version`;
- status `received | succeeded | failed`;
- safe failure code/message;
- created/completed timestamps;
- tenant/project/conversation/message foreign keys.

`knowledge_candidates`
- UUID primary key;
- organisation/project/run IDs;
- category/title/original_content/basis;
- status `pending | accepted | rejected`;
- normalized fingerprint;
- reviewed_by/reviewed_at;
- accepted_knowledge_id;
- rejection_reason;
- created_at;
- project/run foreign keys.

Add:
- project/status listing indexes;
- partial unique pending-fingerprint index scoped by organisation/project/category/fingerprint;
- DB trigger/function preventing updates to immutable candidate source fields while allowing review-state columns.

### Step 6.3 — Implement `KnowledgeCandidateRepository`

Required methods:
- `createRun(run)`;
- `getRunById(orgId, projectId, runId)`;
- `markRunSucceeded(...)`;
- `markRunFailed(...)`;
- `insertCandidate(candidate)`;
- `listByProject(orgId, projectId, status?)`;
- `getCandidateForUpdate(orgId, projectId, candidateId)` using `SELECT ... FOR UPDATE` in a transaction;
- `acceptCandidateDecision(...)`;
- `rejectCandidateDecision(...)`.

Repository methods must take explicit tenant/project keys and must not accept provider credentials or opaque SDK objects.

### Step 6.4 — Add repository to `DatabaseUnitOfWork`

Expose the same transaction-scoped repository instance in `TransactionRepositories` so run/candidate decisions can commit atomically with Product Knowledge and audit.

### Step 6.5 — Run integration suite and commit

```bash
cd platform
npm run test:integration
npm run typecheck
```

Commit:

```bash
git add platform/packages/database
git commit -m "feat: persist Product Knowledge extraction candidates"
```

---

## Task 7 — Refactor Product Partner turn orchestration for failure-isolated extraction

**Files:**
- Create: `platform/apps/api/src/product-partner-turn-service.ts`
- Modify: `platform/apps/api/src/app.ts`
- Modify: `platform/apps/api/test/live-product-partner.integration.test.ts`
- Add/modify test helpers in the same test module as needed

### Step 7.1 — Write failing happy-path integration test

Update fake model adapters to advertise `structuredOutput: true` and return a valid JSON envelope containing an answer plus candidates.

Assert one POST to `/projects/:id/product-partner-turn`:
- performs one model execution in the normal path;
- persists user and assistant conversation messages;
- assistant message contains only the human-readable envelope `answer`, not raw JSON;
- creates one succeeded extraction run;
- creates pending candidates;
- does **not** create canonical Product Knowledge from those candidates;
- returns execution metadata plus extraction summary (`runId`, status, candidateCount/pendingCount).

Expected RED.

### Step 7.2 — Extract turn orchestration into a focused service

Move the multi-step live Product Partner workflow out of the large Fastify route into `product-partner-turn-service.ts` with explicit dependencies:
- projects/conversations/knowledge/candidate repositories or service access;
- `DatabaseUnitOfWork`;
- `ModelGateway`;
- audit event creation.

Keep HTTP identity/RBAC and response mapping in `app.ts`.

Normal flow:
1. build structured request;
2. execute one eligible route;
3. parse usable `answer` and raw candidates;
4. create user message, assistant message and `received` extraction-run marker;
5. **Transaction A:** persist both messages + their audit events + extraction run atomically;
6. validate candidate set and suppress duplicates;
7. **Transaction B:** persist all remaining candidates + candidate audit events + mark run succeeded atomically;
8. return answer/execution/extraction summary.

### Step 7.3 — Write failing invalid-candidate isolation test

Return a valid envelope with a usable nonblank `answer` but an invalid candidate category/basis/content.

Assert:
- HTTP turn succeeds with the assistant answer;
- user and assistant messages persist;
- extraction run is `failed` with a safe code/message;
- no invalid candidate persists;
- no canonical Product Knowledge changes.

### Step 7.4 — Implement candidate-validation failure isolation

After Transaction A, catch domain validation/persistence errors for extraction, mark the run failed in a separate audited transaction, and return the successful answer with `extraction.status = 'failed'`.

Never return hidden model reasoning or raw provider errors as failure messages.

### Step 7.5 — Write failing candidate-persistence fault test

Inject a failure during candidate insertion and prove:
- conversation Transaction A remains committed;
- candidate Transaction B rolls back all candidate inserts for that run;
- run ends failed;
- canonical knowledge remains untouched.

### Step 7.6 — Implement atomic candidate transaction

Insert candidate set and mark run succeeded inside one UoW transaction. If any insert fails, rollback the set and update the run to failed in the separate failure transition.

### Step 7.7 — Write failing structured-generation recovery test

Simulate a structured-output execution failure **before** a usable answer exists. Assert:
- service performs at most one plain-chat recovery request;
- recovered answer is persisted once;
- original user message is persisted once;
- extraction run is failed/retryable;
- no duplicate conversation message is appended.

### Step 7.8 — Implement one-call recovery path

Build a second request from the same canonical context with `requiredCapabilities: ['chat']` and no structured response contract. Use it only when the first operation produced no usable answer.

The recovery call must be visible in execution/audit metadata; do not make it the normal path.

### Step 7.9 — Run integration tests and commit

```bash
cd platform
npx vitest run apps/api/test/live-product-partner.integration.test.ts --maxWorkers=1 --no-file-parallelism
npm run typecheck
```

Commit:

```bash
git add platform/apps/api/src platform/apps/api/test/live-product-partner.integration.test.ts
git commit -m "feat: extract Product Knowledge candidates from live turns"
```

---

## Task 8 — Implement duplicate suppression against pending and canonical knowledge

**Files:**
- Modify: `platform/apps/api/src/product-partner-turn-service.ts`
- Modify: `platform/apps/api/test/live-product-partner.integration.test.ts`
- Modify if needed: `platform/packages/domain/src/knowledge-candidate.ts`
- Modify if needed: `platform/packages/database/src/knowledge-candidate-repository.ts`

### Step 8.1 — Write failing duplicate tests

Cover:
- duplicate candidate twice in one provider envelope → one pending row;
- same normalized candidate already pending → no second pending row;
- same normalized statement already represented by current canonical Product Knowledge → no pending row;
- same text in a materially different category remains distinct;
- rejected historical candidate does not by itself block a newly re-proposed candidate unless canonical/pending duplicate exists.

Expected RED.

### Step 8.2 — Implement deterministic suppression

Before candidate insertion:
- deduplicate the response set by category/fingerprint;
- compare against pending candidate fingerprints for the project;
- calculate comparable fingerprints for latest canonical Product Knowledge;
- let the DB partial unique index remain the race-condition backstop.

Do not add embeddings, vectors or another model call.

### Step 8.3 — Run tests and commit

```bash
cd platform
npx vitest run apps/api/test/live-product-partner.integration.test.ts packages/domain/test/knowledge-candidate.test.ts --maxWorkers=1 --no-file-parallelism
```

Commit:

```bash
git add platform/apps/api platform/packages/domain platform/packages/database
git commit -m "feat: suppress duplicate knowledge candidates"
```

---

## Task 9 — Add candidate review, promotion, rejection and retry API

**Files:**
- Modify: `platform/apps/api/src/app.ts`
- Create: `platform/apps/api/src/knowledge-candidate-service.ts`
- Create: `platform/apps/api/test/knowledge-candidates.integration.test.ts`
- Modify: `platform/apps/api/test/auth-http.integration.test.ts`
- Modify: `platform/packages/database/src/knowledge-candidate-repository.ts`

### Step 9.1 — Write failing candidate-list/RBAC tests

For `GET /projects/:id/knowledge-candidates?status=pending` prove:
- Product Owner, Contributor, Engineer, Reviewer and Viewer with project access can read;
- users outside the project cannot read;
- tenant/project isolation is enforced;
- query status is validated.

For accept/reject prove:
- only `product_owner` can mutate candidate review state;
- Contributor/Engineer/Reviewer/Viewer receive 403;
- unauthenticated/invalid session behaviour remains consistent with existing auth.

### Step 9.2 — Write failing acceptance atomicity test

POST `/projects/:id/knowledge-candidates/:candidateId/accept` with optional edited `category`, `title`, `content`.

Assert one transaction:
- locks pending candidate;
- creates canonical Product Knowledge revision 1 with status `confirmed` and explicit extraction-candidate provenance source;
- marks candidate accepted;
- links accepted canonical knowledge ID;
- stores reviewer/time;
- appends candidate acceptance + canonical creation audit evidence;
- leaves original AI candidate source fields unchanged.

Fault-inject audit failure and assert **all** of acceptance rolls back.

### Step 9.3 — Implement candidate acceptance service

`knowledge-candidate-service.ts` owns review use cases rather than bloating `app.ts`.

Use `DatabaseUnitOfWork`; do not accept/reject through independent repository calls outside the transaction.

If the candidate is not pending, return a deterministic conflict (409) rather than silently repeating the decision.

### Step 9.4 — Write failing rejection test

POST `/projects/:id/knowledge-candidates/:candidateId/reject` with optional reason.

Assert:
- candidate becomes rejected exactly once;
- reviewer/time/reason are stored;
- audit is atomic;
- canonical Product Knowledge is unchanged.

### Step 9.5 — Implement rejection

Use row lock/equivalent transaction and return 409 for an already decided candidate.

### Step 9.6 — Write failing retry tests

POST `/projects/:id/extraction-runs/:runId/retry`:
- Product Owner only;
- only failed runs retry;
- loads persisted source user/assistant turn and current canonical project context;
- performs extraction-only structured request;
- does not append a new user or assistant conversation message;
- creates a new extraction attempt linked/provenanced to the same source turn or safely reuses run lineage according to repository contract;
- persists candidates with duplicate suppression;
- audits retry requested/completed/failure.

### Step 9.7 — Implement extraction-only retry

Add a dedicated request builder/service path using a candidate-only schema. Do not ask the model to regenerate the conversational answer merely to retry extraction.

### Step 9.8 — Run API + auth integration tests and commit

```bash
cd platform
npx vitest run apps/api/test/knowledge-candidates.integration.test.ts \
                apps/api/test/auth-http.integration.test.ts \
                apps/api/test/live-product-partner.integration.test.ts \
                --maxWorkers=1 --no-file-parallelism
npm run typecheck
```

Commit:

```bash
git add platform/apps/api platform/packages/database
git commit -m "feat: add Product Knowledge candidate review API"
```

---

## Task 10 — Generalise Product Studio web types and route status without widening the initial UI

**Files:**
- Modify: `platform/apps/web/lib/api.ts`
- Modify: `platform/apps/web/app/projects/[id]/page.tsx`
- Modify: `platform/apps/web/app/actions.ts`
- Modify if needed: `platform/apps/web/app/globals.css`
- Create: `platform/test/web-provider-contract.test.mjs`

### Step 10.1 — Write failing static web contract test

Create a fast Node contract test proving web source no longer declares provider fields as the closed union `'openai' | 'anthropic' | 'google'`, while the visible Product Partner choices still include the three initial providers plus Auto.

Also assert `ModelRouteSummary` exposes route capabilities including `structuredOutput`.

Run:

```bash
cd platform
node --test test/web-provider-contract.test.mjs
```

Expected RED.

### Step 10.2 — Generalise web API contracts

In `lib/api.ts`:
- make provider attribution/route provider a stable string identifier;
- keep Product Partner preference as string with `auto` convention;
- add route capabilities to `ModelRouteSummary`;
- add extraction summary to `ProductPartnerTurnResult`;
- add candidate/run/review API types and client functions needed by Task 11.

In `page.tsx`:
- replace exhaustive `Record<ProductPartner, string>` assumptions with an initial option list plus fallback label function;
- keep visible selector choices OpenAI/Claude/Gemini/Auto for this release;
- compute `liveAvailable` using an available matching route that has both `chat` and `structuredOutput` for Product Partner turns;
- render unknown/future provider attribution safely instead of indexing a closed label map.

### Step 10.3 — Re-run contract + typecheck

```bash
cd platform
node --test test/web-provider-contract.test.mjs
npm run typecheck
```

Expected GREEN.

### Step 10.4 — Commit

```bash
git add platform/apps/web platform/test/web-provider-contract.test.mjs
git commit -m "refactor: make Product Studio route-capability aware"
```

---

## Task 11 — Add Product Studio Review Queue UI

**Files:**
- Modify: `platform/apps/web/lib/api.ts`
- Modify: `platform/apps/web/app/actions.ts`
- Modify: `platform/apps/web/app/projects/[id]/page.tsx`
- Modify: `platform/apps/web/app/globals.css`
- Create: `platform/test/product-knowledge-review-ui.test.mjs`

### Step 11.1 — Write failing UI source/contract tests

The test should assert the Product Studio source contains a Review Queue surface and actions wired to:
- list pending candidates;
- Accept;
- Edit & Accept;
- Reject;
- retry failed extraction.

Keep this a deterministic source/contract test unless a browser harness is already configured for the web workspace; do not add a new browser-test framework only for this slice.

### Step 11.2 — Add server actions

In `actions.ts` add:
- `acceptKnowledgeCandidateAction`;
- `rejectKnowledgeCandidateAction`;
- `retryKnowledgeExtractionAction`.

All actions revalidate the current Product Studio route. Do not allow client-submitted reviewer identity; API identity supplies it.

### Step 11.3 — Render Review Queue in Product Knowledge panel

Load candidate queue alongside studio/model routes.

Each candidate card shows:
- category/title/content;
- basis label;
- provider/model/route provenance;
- source-turn reference;
- pending/review state.

For Product Owners show:
- Accept;
- editable fields + Edit & Accept;
- Reject with optional reason;
- Retry for failed extraction runs.

For all other project roles render read-only state. Obtain effective project role from an authorised API response rather than trusting browser-supplied role values.

### Step 11.4 — Show extraction result without replacing answer

After a successful turn, the page should naturally re-fetch and display pending count. The conversation remains visible even when the latest extraction run failed; show compact state such as:
- `3 candidates ready for review`;
- `No new candidates`;
- `Knowledge extraction failed — retry available`.

Do not replace the assistant answer with extraction failure UI.

### Step 11.5 — Style within existing Product Studio layout

Add focused classes to `globals.css`; preserve the current three-region layout and responsive behaviour. Do not redesign unrelated screens.

### Step 11.6 — Build/typecheck and commit

```bash
cd platform
node --test test/product-knowledge-review-ui.test.mjs
npm run typecheck
npm run build --workspace @engineering-os/web
```

Commit:

```bash
git add platform/apps/web platform/test/product-knowledge-review-ui.test.mjs
git commit -m "feat: add Product Knowledge review queue UI"
```

---

## Task 12 — Full regression, Docker PostgreSQL verification and merge gate

**Files:**
- Modify only if verification reveals a real defect: files directly implicated by failing tests
- No speculative cleanup

### Step 12.1 — Start from a clean Docker PostgreSQL volume

From `platform/`:

```bash
docker compose down -v
docker compose up -d postgres
```

Wait until PostgreSQL reports healthy. Use the repository test URL:

```text
postgresql://engineering_os:engineering_os@localhost:55432/engineering_os_test
```

### Step 12.2 — Run platform tests in required order

```bash
cd platform
npm test
npm run typecheck
npm run build --workspace @engineering-os/web
npm audit --omit=dev
```

Expected:
- unit tests green;
- serial PostgreSQL integration tests green including migrations 004/005;
- typecheck green;
- Next.js production build green;
- no new runtime vulnerability introduced by this slice.

### Step 12.3 — Run repository/ECC compatibility gates

From repository root run the existing repository verification commands used by CI, including the ECC structural/static compatibility tests. Use the commands from `.github/workflows/ci.yml` rather than inventing a parallel local gate.

Expected: all product/ECC gates that apply to `main`/`feature/**`/`chore/**` pass.

### Step 12.4 — Manual smoke against real API/web + Docker PostgreSQL

Run API and web against Docker PostgreSQL and verify:
1. create/login as Product Owner;
2. create/open a project;
3. send a live Product Partner turn through a configured **test/staging** route or deterministic adapter environment;
4. assistant answer persists;
5. pending candidates appear separately;
6. refresh/restart preserves answer and queue;
7. accept one candidate → canonical `confirmed` Product Knowledge appears;
8. reject another → no canonical mutation;
9. switch Product Partner → canonical knowledge and queue remain;
10. Viewer can see queue but cannot accept/reject;
11. extraction failure leaves conversation visible and retryable.

Do not make live paid-provider calls in CI. Any optional manual real-provider smoke must use explicitly configured credentials and remain outside automated CI.

### Step 12.5 — Optional Neon shared/staging validation

Only if an already-authorised Neon test/staging connection is available, run migrations and the non-destructive integration/smoke subset there. Do not claim Neon validation if no connection is configured.

### Step 12.6 — Diff/security review

Run:

```bash
git diff --check
git status --short
git diff main...HEAD -- platform docs/product docs/architecture docs/superpowers
```

Confirm:
- migrations 001–003 untouched;
- no accidental ECC-core changes outside approved adapter/docs scope;
- no secrets/provider credentials committed;
- no personal connection/Agent Bridge scope accidentally implemented;
- review-first candidate state cannot bypass Product Owner acceptance.

### Step 12.7 — Final verification commit if needed

Only if verification required legitimate fixes, commit those fixes separately with a focused message. Do not create an empty “verification” commit.

### Step 12.8 — Push and remote CI gate

Push the implementation branch, then verify the exact pushed SHA in GitHub Actions. Do not infer green CI from an old badge or prior SHA.

The slice is merge-ready only when local verification and the exact remote SHA are green.

---

## Acceptance checklist

Before merge, prove all of the following:

- [ ] Core provider contracts accept future stable provider IDs.
- [ ] Existing OpenAI/Anthropic/Google API routes still work.
- [ ] Multiple route IDs/models can coexist for one provider.
- [ ] Applied migration 002 is unchanged; migration 004 generalises provider checks forward-only.
- [ ] `structuredOutput` is an explicit per-route capability.
- [ ] Product Partner extraction requires `chat + structuredOutput`.
- [ ] Normal successful turn uses one structured model operation.
- [ ] Conversation persists independently of candidate persistence success.
- [ ] Migration 005 persists extraction runs and non-canonical candidates.
- [ ] Invalid/failed extraction never creates canonical Product Knowledge.
- [ ] Pending/canonical duplicate suppression works without another model call.
- [ ] Only Product Owner can accept/reject candidates.
- [ ] Acceptance atomically creates `confirmed` canonical knowledge + candidate decision + audit.
- [ ] Rejection never mutates canonical Product Knowledge.
- [ ] Concurrent candidate review resolves once.
- [ ] Retry is extraction-only and does not duplicate conversation messages.
- [ ] Product Studio remains usable with the initial OpenAI/Claude/Gemini/Auto selector.
- [ ] Web/API types no longer impose the three-provider ceiling.
- [ ] Review Queue renders candidate provenance and failure state.
- [ ] Docker PostgreSQL clean-volume regression passes.
- [ ] TypeScript and Next.js production build pass.
- [ ] Existing authentication/collaboration regressions pass.
- [ ] ECC/platform verification gates pass.
- [ ] No provider credentials, user subscription secrets or hidden reasoning appear in source/log/audit contracts.

## Follow-on plans after this slice

Create separate plans, in this order, after this slice is green:

1. `AI connection + project delegation administration` — `ai_connections`, project shares, Do Not Share/Online Only/Persistent, owner limits, RBAC, audit.
2. `Agent Bridge + subscription harness adapters` — scoped runner auth/health and provider-supported Codex/Claude Code/Antigravity routes.
3. `ECC-backed Engineering Studio execution` — approved ECC agent/skill registry integration, harness/session adapters, worktrees, checkpoints and independent review.

Do not fold those three larger subsystems into this extraction implementation branch.
