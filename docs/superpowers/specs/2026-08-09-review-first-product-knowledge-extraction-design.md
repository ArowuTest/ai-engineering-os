# Review-First Product Knowledge Extraction Design

**Status:** Approved design candidate
**Date:** 9 August 2026
**Parent requirements:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md` v1.2
**Parent architecture:** `docs/architecture/AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md` v1.2

## 1. Decision

Product Studio will automatically attempt Product Knowledge extraction after every successful live Product Partner turn.

The normal path uses one provider operation that returns both the conversational answer and schema-constrained candidate Product Knowledge. Extracted candidates are never canonical merely because a model produced them.

Every candidate enters a separate review queue. Only an authorised Product Owner can accept a candidate into canonical Product Knowledge.

## 2. Goals

- keep product discovery conversational and automatic;
- avoid a routine second paid model call;
- preserve provider neutrality across OpenAI, Anthropic and Google;
- retain source/provenance for every candidate;
- make AI inference visibly different from governed project truth;
- preserve a successful conversation when extraction processing fails;
- enforce Product Owner review before canonical promotion.

## 3. Non-goals

This slice does not:

- allow AI to write canonical Product Knowledge directly;
- auto-approve Product Knowledge;
- introduce semantic-vector deduplication;
- add a dedicated extraction provider by default;
- make document extraction or cross-model challenge part of this first implementation;
- change the existing durable-conversation ownership model.

## 4. Core governance rule

The platform owns two distinct stores:

```text
AI extraction output
      ↓
Candidate Review Queue          non-canonical
      ↓ Product Owner accepts
Canonical Product Knowledge     governed project state
```

Rejecting a candidate changes only review state. It must not create, modify or delete canonical Product Knowledge.

Accepting a candidate creates a canonical Product Knowledge record with a default status of `confirmed`. `approved` remains a separate, explicit baseline decision and is not implied by candidate acceptance.

## 5. Provider-neutral response envelope

The Model Gateway will support an optional structured response contract. Product Partner turns use an envelope equivalent to:

```json
{
  "answer": "Normal conversational response shown to the user.",
  "candidates": [
    {
      "category": "Business Rules",
      "title": "PPV entitlement rule",
      "content": "A paid stream pass grants access only to the purchased event.",
      "basis": "user_stated"
    }
  ]
}
```

The platform validates this envelope independently of provider SDK types. Candidate `category` must map to the canonical Product Knowledge taxonomy; unknown categories are rejected as invalid extraction data rather than creating ad-hoc knowledge types.

`basis` is one of:

- `user_stated` — materially stated by the user;
- `assistant_inferred` — inferred from context and requiring human validation;
- `assistant_recommended` — a model recommendation, not a user decision.

Open questions are not promoted as factual candidates. They remain conversation content unless a later requirement explicitly introduces an open-question review object.

## 6. Provider implementation strategy

The gateway owns the structured-output contract; adapters translate it to the provider-specific API.

- OpenAI: Responses API JSON Schema structured output.
- Anthropic: Messages API `output_config.format` JSON Schema output.
- Google: Gemini Interactions `response_format` JSON Schema output.

The normal Product Partner route requires `chat` plus a structured-output capability. The route registry must advertise structured-output support explicitly rather than infer it from provider name alone.

Configured models that are not verified for structured output remain eligible for ordinary chat but are not silently treated as extraction-capable.

Provider-specific response/session identifiers remain execution metadata only. They never become the canonical source of Product Knowledge or conversation continuity.

## 7. Normal turn data flow

```text
User sends Product Partner message
      ↓
Build context from project + canonical PK + durable conversation
      ↓
Model Gateway executes one structured Product Partner request
      ↓
Validate response envelope
      ├── answer
      └── zero or more candidate items
      ↓
Persist conversation turn
      ↓
Persist extraction run + candidate queue
      ↓
Render answer + pending-candidate count
```

## 8. Persistence model

Migration `004_product_knowledge_candidates.sql` will introduce two project-scoped entities.

### `knowledge_extraction_runs`

Stores one extraction attempt per Product Partner turn:

- stable UUID;
- organisation/project/conversation IDs;
- source user-message and assistant-message IDs;
- provider, model and route ID;
- response-contract version;
- status: `received`, `succeeded`, `failed`;
- safe failure code/message when applicable;
- created/completed timestamps.

### `knowledge_candidates`

Stores immutable model suggestions plus mutable review state:

- stable UUID and tenant/project boundaries;
- extraction-run ID;
- category, title and original content;
- basis classification;
- status: `pending`, `accepted`, `rejected`;
- deterministic normalized fingerprint;
- reviewer identity/timestamp;
- accepted canonical-knowledge ID when accepted;
- optional rejection reason;
- provider/model/source-message provenance inherited from the extraction run.

## 9. Transaction boundaries and failure isolation

Conversation success and extraction success are deliberately separate state transitions.

### Transaction A — conversation

After a usable model answer exists, persist the user message, assistant message, mandatory audit events and an extraction-run marker atomically.

A candidate-persistence failure must not roll back a valid conversational answer.

### Transaction B — extraction

Validate and persist all candidates for the run, then mark the extraction run `succeeded` atomically. If validation or persistence fails, mark the run `failed` without changing canonical Product Knowledge.

If the provider returns a usable `answer` but invalid candidate data, retain the answer and mark extraction failed.

If schema-constrained generation fails before a usable answer exists, the platform may perform one plain-chat recovery call to preserve the user's conversation. That fallback is exceptional, not the normal cost path; the extraction run is marked failed and can be retried separately.

A provider refusal, max-token truncation or unsupported structured-output response must never be interpreted as an empty successful extraction.

## 10. Duplicate handling

V1 uses deterministic normalized fingerprints to suppress exact/near-identical textual duplicates within the same project/category.

The platform checks both pending candidates and current canonical Product Knowledge before inserting a duplicate candidate. V1 does not spend another model call on semantic deduplication.

## 11. Review and promotion semantics

Project members who can read Product Studio may see the candidate queue. Only `product_owner` may accept or reject candidates in V1.

Accept flow:

```text
Pending candidate
      ↓ Product Owner reviews/edits target fields
Atomic transaction
      ├── create canonical Product Knowledge as `confirmed`
      ├── mark candidate `accepted`
      ├── link accepted canonical knowledge ID
      └── append mandatory audit evidence
```

The original model candidate remains immutable evidence. If the Product Owner edits category/title/content before acceptance, those reviewed values become the canonical record while the original candidate remains unchanged.

Reject flow marks the candidate `rejected`, records reviewer/time and optional reason, and appends audit evidence. It performs no canonical mutation.

An already accepted/rejected candidate cannot be reviewed again. Concurrent review attempts must resolve through row locking or equivalent database concurrency control so only one decision wins.

## 12. API surface

Initial routes:

- `GET /projects/:id/knowledge-candidates?status=pending`;
- `POST /projects/:id/knowledge-candidates/:candidateId/accept`;
- `POST /projects/:id/knowledge-candidates/:candidateId/reject`;
- `POST /projects/:id/extraction-runs/:runId/retry` for failed extraction attempts.

## 13. Product Studio UX

The existing right-hand Product Knowledge area gains a Review Queue section with a visible pending count.

Each candidate card shows:

- category and proposed title;
- proposed content;
- basis (`user stated`, `AI inferred`, or `AI recommended`);
- provider/model provenance;
- source-turn link/context;
- review status.

Product Owners receive `Accept`, `Edit & Accept`, and `Reject` controls. Other project roles see the queue read-only.

A successful Product Partner turn should render immediately with a compact extraction state such as `3 candidates ready for review`. Extraction failure must not replace the conversational answer with an error screen.

Failed extraction runs expose a retry action to Product Owners without requiring the original user message to be resent. Retry is extraction-only: it analyses the already-persisted source turn and must not append a duplicate user or assistant conversation message.

## 14. Audit requirements

Audit events include:

- extraction run received/succeeded/failed;
- candidate created;
- candidate accepted;
- candidate rejected;
- extraction retry requested/completed;
- canonical Product Knowledge created from an accepted candidate.

Audit metadata may include provider/model/route IDs, candidate/run IDs, canonical knowledge ID, basis and safe failure codes. It must not contain provider credentials or hidden model reasoning.

## 15. Cost and routing policy

The normal path performs one model operation per Product Partner turn. The structured envelope is part of that same operation.

The platform records the provider route and usage metadata already returned by the Model Gateway. Candidate count does not trigger an additional provider request.

A second provider request is allowed only for explicit retry or conversation-recovery after structured-output failure. Such calls remain visible in route/cost audit metadata.

No provider may be selected solely because it is convenient for extraction if that violates the project's selected Product Partner or routing policy.

## 16. Testing strategy

The implementation must include:

- domain tests for candidate validation, basis/status transitions and fingerprinting;
- gateway/adapter tests for the provider-neutral structured response contract;
- PostgreSQL tests for migration, tenant/project isolation, immutable candidate source data and concurrent review;
- integration tests proving a model response cannot directly create canonical Product Knowledge;
- failure-isolation tests proving candidate persistence/extraction failure does not remove a successful conversation turn;
- RBAC tests proving Viewer/Contributor cannot promote or reject candidates and Product Owner can;
- transaction tests proving acceptance creates canonical knowledge + candidate decision + audit atomically;
- duplicate-suppression tests;
- web contract tests for queue rendering and review actions;
- production Next.js build and existing platform/ECC verification gates.

## 17. Acceptance criteria

This slice is complete when a successful live Product Partner turn can automatically produce zero or more review candidates in one normal model operation; the conversation remains durable independently of extraction success; no candidate becomes canonical without Product Owner acceptance; accepted candidates create `confirmed` canonical Product Knowledge atomically with audit evidence; rejected candidates never mutate canonical knowledge; and all provider, tenant, project and role boundaries remain enforced.
