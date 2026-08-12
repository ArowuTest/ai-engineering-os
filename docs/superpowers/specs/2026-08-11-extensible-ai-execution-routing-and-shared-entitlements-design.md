# Extensible AI Execution, Harness, and Shared Entitlements Design

**Document version:** 1.0
**Status:** Approved design baseline
**Date:** 11 August 2026
**Parent SRS:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md` v1.2
**Parent architecture:** `docs/architecture/AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md` v1.2
**Related design:** `docs/superpowers/specs/2026-08-09-review-first-product-knowledge-extraction-design.md`

## 1. Purpose

This design defines how AI Engineering OS separates and composes providers, models, execution routes, harnesses, agents, skills, tools, user-owned AI entitlements, organisation-owned AI capacity, and durable project state.

It records the decisions made before continuing the Product Knowledge extraction build so that V1 work does not hard-code a three-model architecture that later conflicts with subscription-backed execution, ECC agents, Hermes, Codex, Claude Code, Antigravity, or future providers and harnesses.

The central requirement is:

> **The platform owns project state and orchestration. Models, harnesses, agents, connections, and user sessions are replaceable execution resources.**

A collaborator signing out, disconnecting a provider, exhausting quota, changing model, or leaving a project must not erase or strand durable project knowledge or execution state.

## 2. Current Repository Baseline

The current private platform already contains several foundations required by this design:

- `ModelGateway` registers adapters by route ID in a map and can choose among multiple eligible routes.
- `ModelRoute` already separates `provider`, `model`, `executionMode`, `costType`, availability, priority, and capabilities.
- `ExecutionMode` already supports `subscription`, `api`, and `manual`.
- `CostType` already supports `included_subscription`, `provider_credit`, `metered_api`, and `manual`.
- Gateway tests already prove subscription-first selection, API fallback, capability filtering, and metered-API refusal.
- Live Product Partner execution already persists provider, model, route ID, execution mode, cost type, and usage metadata.
- Authentication already separates organisation membership from project membership and supports immediate session revocation.
- Conversations and canonical Product Knowledge are persisted independently of any provider conversation.
- The repository contains the ECC agent and skill substrate, including 67 agent definitions and cross-harness/session-adapter concepts.

The current runtime is nevertheless constrained:

- `ModelProvider` is a closed union of `openai | anthropic | google`.
- the runtime registers only one API-key-backed route per provider;
- adapter route IDs are fixed as `openai-api`, `anthropic-api`, and `google-api`;
- Product Partner UI/API types are hard-coded to the three provider families plus Auto;
- no database migration currently persists AI connections, project sharing, harness runners, or delegated entitlement policy;
- `platform/packages/ecc-adapter` currently implements provenance only, not agent/skill enumeration or worker execution.

## 3. Architectural Vocabulary

AI Engineering OS shall treat the following as separate concepts:

| Concept | Meaning | Examples |
|---|---|---|
| Provider | Commercial/model provider family | OpenAI, Anthropic, Google, future providers |
| Model | Specific intelligence/model offered by a provider | GPT/Codex family, Claude family, Gemini family |
| Execution route | How a model is reached and billed | personal subscription, organisation subscription, API, enterprise route, manual handoff |
| Harness | Runtime/operator surface in which an agent works | Codex, Claude Code, Antigravity, Hermes, OpenCode |
| Agent | Role/persona/instruction package | Product Partner, architect, planner, engineer, code reviewer, security reviewer |
| Skill | Reusable workflow/capability instructions | TDD, debugging, API design, security review |
| Tool | External action or data capability | GitHub, PostgreSQL, Playwright, Firecrawl, deployment tools |
| Connection | Authorised provider/account entitlement | FS Claude subscription, Sarah Codex connection, organisation Anthropic API |
| Runner | Reachable process/device capable of executing a connection | local Agent Bridge, managed enterprise runner |
| Orchestrator | Platform policy engine that selects and governs execution | AI Engineering OS |

No UI or internal contract should use these terms interchangeably.

In particular, Hermes, Codex, Claude Code, and Antigravity are not themselves provider identities. An ECC agent definition is not a model. A user's provider login is not canonical project state.

## 4. Target Registry Model

The platform shall evolve toward independent registries with stable identifiers:

1. **Provider Registry** — provider identity, policy metadata, supported connection types, and adapter families.
2. **Model Registry** — multiple models per provider with lifecycle and capability metadata.
3. **Harness Registry** — supported execution surfaces and their capabilities.
4. **Agent Registry** — ECC Core agents plus approved organisation-private and project-specific agents.
5. **Skill Registry** — ECC Core, curated external, organisation-private, project-specific, quarantine, and rejected skills.
6. **Tool Registry** — approved MCP/tool capabilities and permissions.
7. **Connection Registry** — personal and organisation-owned authenticated entitlements.
8. **Route Registry** — concrete executable combinations of provider, model, harness, connection, execution mode, and capability set.

The registries may use code-defined trusted manifests initially where persistence adds no immediate value, but user/organisation connections, project delegation, runner state, material route use, and policy changes require durable persistence and audit.

The architecture shall support N providers, N models per provider, N routes per model, N harnesses, and N agents. Shipping only three provider adapters in an early release must not imply a three-provider domain model.

## 5. Orchestration Principle

AI Engineering OS remains the master orchestrator for the initial product architecture.

Hermes and other harnesses may execute tasks, manage a bounded local runtime, expose capabilities, and return canonical worker/session state, but they do not independently redefine project scope, canonical requirements, permissions, reviewer independence, budget policy, or deployment authority.

A future bounded sub-orchestrator capability may be introduced explicitly, but it is out of scope for this design baseline.

## 6. Personal and Organisation AI Connections

A connection is an entitlement owned by either one user or the organisation.

### 6.1 Personal connections

A personal connection belongs to the individual who authenticated it. Examples include a user's eligible ChatGPT/Codex, Claude/Claude Code, Google/Antigravity, or future provider connection.

Personal credentials, refresh tokens, provider session material, and local authentication state shall never be transferred to collaborators or made project-owned.

Where officially supported, the preferred design is a provider-supported local or managed harness that authenticates directly with the provider. AI Engineering OS receives only the connection identity, capability/health metadata, authorised scope, and execution results needed to govern work.

### 6.2 Organisation connections

An organisation may separately configure shared enterprise, subscription, cloud, credit, or API-backed connections. Organisation connections are governed by organisation administrators and may be available to eligible projects according to policy.

### 6.3 Provider-policy gate

User permission to share capacity is necessary but not sufficient. A personal connection may be delegated only when the provider, account type, harness, and applicable terms technically and contractually permit that execution model.

The platform must never convert a consumer web session into an unofficial API by scraping, browser impersonation, cookie theft, credential forwarding, or similar techniques.

## 7. Project Sharing Modes

Every personal connection begins **Do Not Share**. Connecting a provider account must never automatically contribute personal capacity to a project or organisation.

For each project, the connection owner may choose:

- `private` — Do Not Share. Only owner-authorised personal work may use the connection.
- `online_only` — shared with the project only while the connection owner has an active AI Engineering OS presence and an authorised runner for that connection is online. This is the default when the user first opts into project sharing.
- `persistent` — shared with the project for continued eligible execution even while the owner is signed out of the AI Engineering OS web application, provided an authorised persistent runner remains reachable.

Changing from `online_only` to `persistent` requires an explicit user action. Organisation-wide sharing, if introduced, requires a separate explicit scope and must not be implied by project sharing.

Sharing is project-scoped. Sharing a connection with Project A does not make it available to Project B or the whole organisation.

## 8. Sign-Out, Offline, and Revocation Semantics

Web authentication state, connection authorisation, and runner availability are separate states.

- Signing out of AI Engineering OS terminates the user's web session but does not delete project state.
- In `online_only` mode, a shared route becomes ineligible when the connection owner no longer has an active AI Engineering OS presence or when the required personal runner is offline.
- In `persistent` mode, the route remains eligible after web sign-out while its persistent authorised runner is reachable.
- Turning off or disconnecting a runner changes route health/availability without deleting the connection record or project history.
- Selecting Do Not Share or revoking project delegation immediately prevents new project executions through that connection.
- Revocation must not delete historical outputs, source revisions, checkpoints, Product Knowledge, conversations, usage records, or audit evidence.

## 9. Collaboration and Automatic Use

Once an eligible connection is explicitly shared with a project, authorised collaborators may benefit from it automatically through the orchestrator. The connection owner does not separately approve every collaborator or every ordinary task unless a stricter optional usage policy is configured.

A collaborator never receives direct control of another user's provider credentials. They request or initiate a project task; AI Engineering OS decides whether a shared route may satisfy it.

Project RBAC remains authoritative. Sharing an AI connection does not grant a collaborator permission to perform actions their project role otherwise forbids.

A shared connection may therefore be used only when all of the following are true:

1. the requesting user is an active member of the project;
2. the user's project role authorises the requested task/action;
3. the connection owner has shared the connection with that project;
4. the share is active in `online_only` or `persistent` mode;
5. an eligible runner is reachable where required;
6. provider/account/harness policy permits delegated execution;
7. the route satisfies required capabilities;
8. connection, project, organisation, risk, and cost policies permit the execution.

## 10. Shared Project Execution Pool

When multiple collaborators contribute eligible connections, the orchestrator treats them as a project execution pool. It shall not always consume the project owner's entitlement first.

Selection should consider task capability, route health, provider/harness suitability, contributor policy, known allowance/quota state, cost classification, project preferences, independent-review rules, and deterministic tie-breaking.

Where exact provider quota is unavailable, the platform may use conservative task/turn counters, provider-reported availability, throttling signals, and owner-defined limits rather than inventing a percentage of remaining allowance.

## 11. Default Routing Policy

For a collaborator-initiated task, the default policy is:

```text
1. Requesting user's own eligible connection
        ↓ if unavailable/ineligible
2. Eligible connections contributed to the project pool
        ↓ if unavailable/ineligible
3. Eligible organisation-owned subscription/enterprise connection
        ↓ if unavailable/ineligible
4. Approved organisation/platform API route
        ↓ if unavailable/disallowed
5. Safe alternate provider/route or pause for user action
```

The ordering is policy, not a provider hard-code. A high-risk review rule may intentionally choose a different provider from the engineer even when the requester's own route is available.

`Auto` means policy-driven selection among eligible routes; it is not a provider or model.

The router shall be able to filter or score on provider, model, harness, connection owner/scope, execution mode, cost type, capability set, health, project sharing state, role, risk, and review independence.

## 12. Durable Project State and Handoff

Durable project state is independent of any connection or harness. At minimum this includes canonical Product Knowledge and revisions, Product Partner conversations, documents and requirements, Product Packages, tasks, checkpoints, repository revisions, test/build evidence, review findings, decisions, risks, usage metadata, and audit events.

A new worker must resume from platform-owned context and repository/task state rather than requiring access to the previous worker's private provider conversation.

A collaborator may therefore sign out, leave the project, revoke a personal connection, or become unavailable while other authorised collaborators continue the project using the same durable state.

If an execution route disappears during a task, the task must checkpoint or fail safely according to the harness contract. Another eligible worker may resume from the durable checkpoint without treating the lost session as canonical memory.

## 13. Harness and Agent Architecture

ECC remains the reusable agent/skill substrate. The private platform shall use a narrow ECC adapter to enumerate approved ECC agents and skills, translate platform tasks into bounded execution inputs, and normalise worker/session outputs.

The existing 67 ECC agent definitions are reusable capabilities, not 67 hard-coded model assignments. Platform roles such as `engineer`, `reviewer`, or `security_reviewer` may map to one or more agent definitions according to task type and policy.

Harnesses are replaceable execution surfaces. Initial/future examples include:

- Codex;
- Claude Code;
- Antigravity;
- Hermes;
- OpenCode;
- ECC tmux/worktree orchestration;
- future enterprise or remote runners.

Harness adapters should expose a canonical capability/health/session boundary. Where compatible, AI Engineering OS should build on ECC's `ecc.session.v1` concepts rather than reading harness-specific files directly.

Hermes is initially a harness/operator runtime beneath AI Engineering OS orchestration. It may provide chat, CLI, scheduling, handoff, MCP, memory-transfer, and long-lived operator capabilities, but it does not become the source of canonical project truth.

## 14. Capability Model

Capabilities belong to concrete routes/harnesses, not merely provider families. The existing capability model shall be extended as needed rather than assuming that every route for a provider behaves identically.

At minimum, route capability evaluation should cover:

- conversational chat;
- structured output / schema-constrained response;
- tools/function calls;
- MCP;
- files/context attachments;
- vision;
- local workspace access;
- shell/command execution;
- headless/non-interactive execution;
- session resume/checkpoint support;
- durable/persistent runner support;
- cancellation;
- usage/quota telemetry where available.

A Claude API route and a Claude Code subscription route may therefore advertise different capabilities even when they use related model families. The same principle applies to Codex API/subscription surfaces, Antigravity, enterprise routes, and future providers.

## 15. Product Knowledge Extraction Compatibility

The review-first Product Knowledge extraction design remains valid, but the next implementation must not equate provider identity with structured-output capability.

The normal extraction path still prefers one provider operation returning both conversational `answer` and schema-validated `candidates`. A route is eligible for that path only if its adapter explicitly advertises and implements the required structured-output contract.

If a selected subscription/harness route cannot satisfy the extraction contract, policy may use an approved compatible route for the Product Partner turn, use a documented extraction fallback where the design permits it, or mark extraction unavailable/retryable without silently promoting canonical knowledge.

## 16. Proposed Persistence Boundary

The initial persisted model should add only state that must survive process/device changes or requires governance. Provider/model/harness catalogues may remain trusted code/manifests initially; connection ownership, sharing, runner state, and execution evidence must be durable.

### 16.1 `ai_connections`

Represents one authenticated entitlement or managed credential source.

Required concepts include stable ID, organisation boundary, ownership type (`personal` or `organisation`), owner user when personal, provider ID, harness/connection family, account/entitlement classification, credential strategy, status, delegation eligibility, creation/update timestamps, and revocation state.

Secrets are referenced, never returned through normal API representations. Local subscription credentials should remain on the authorised runner where practical.

### 16.2 `ai_connection_project_shares`

Represents explicit project delegation of a personal connection.

Required concepts include connection ID, organisation/project IDs, mode (`online_only` or `persistent`), active/revoked state, optional usage policy, actor, timestamps, and revocation metadata.

Absence of an active share means Do Not Share.

### 16.3 `ai_runners`

Represents a reachable execution process/device associated with one or more authorised connections. It records stable runner identity, ownership/scope, harness kind, capabilities, online/health state, last-seen time, persistence support, and safe public connection metadata.

Authentication/attestation for runners must use revocable scoped credentials distinct from provider credentials.

### 16.4 Execution evidence

Every material model/agent execution shall persist enough metadata to explain which resource performed the work without exposing secrets. At minimum: project/task, requesting user, connection owner/scope where applicable, provider, model, harness, route, execution mode, cost class, agent definition/role, runner identity, timestamps, usage/quota metadata when available, and outcome/checkpoint references.

Existing conversation execution metadata should evolve toward this common execution-evidence shape rather than creating unrelated provider-specific logs.

## 17. Connection and Runner Status Model

The UI/API should distinguish connection configuration from current route availability. Example user-facing states include:

- Connected — Private;
- Connected — Shared, Online Only;
- Connected — Shared, Persistent;
- Connected — Shared but Runner Offline;
- Connected — Temporarily quota/rate limited;
- Provider re-authentication required;
- Project sharing revoked;
- Connection revoked/disabled.

A route is executable only when all required connection, runner, capability, policy, and provider conditions are satisfied.

## 18. Usage Contribution Controls

A connection owner may optionally constrain contributed capacity. Initial controls should prefer enforceable units such as tasks, executions, time windows, allowed project scopes, or provider-reported quota signals.

The product must not claim it can reserve or enforce a precise percentage of a provider subscription unless the provider exposes sufficient telemetry to do so reliably.

Project and organisation policies may further restrict use but cannot expand the connection owner's sharing scope.

## 19. Security and Credential Boundary

The platform shall enforce the following invariants:

- collaborators never receive another user's provider credentials or refresh tokens;
- provider credentials are never copied into Product Knowledge, conversations, audit metadata, logs, task prompts, or repository files;
- local subscription authentication remains local where the provider-supported harness permits it;
- persistent execution uses a dedicated authorised runner, not a retained browser session;
- runner credentials are scoped, revocable, and distinct from provider credentials;
- project sharing grants execution eligibility only for that project and does not grant account administration rights;
- a project member cannot widen another user's sharing scope;
- organisation administrators may restrict or prohibit personal connection use but cannot silently opt a personal connection into sharing;
- untrusted project/repository/web content cannot alter connection ownership, sharing policy, or credential scope through prompts.

## 20. Audit Requirements

Material events shall be auditable, including:

- AI connection registered/disconnected/revoked;
- provider re-authentication required/completed where safe to record;
- project share enabled, mode changed, or revoked;
- runner registered, disabled, or materially changes trust/capability state;
- organisation connection created/disabled;
- routing policy changed;
- execution route selected/fell back/failed;
- execution requested by collaborator using a contributed connection;
- usage limit reached or policy blocked execution;
- delegation denied because provider/account/harness policy does not permit it.

Audit records must contain identifiers and safe metadata, never authentication secrets.

## 21. Transactional Integrity

Material connection and sharing mutations must use the same transaction-plus-audit principle already established for Product Studio and authentication.

Examples that must commit atomically with their required audit event include enabling/revoking a project share, changing persistent/online-only mode, registering or disabling an organisation-owned connection, and changing a material execution policy.

If audit persistence fails, the corresponding material policy mutation must roll back rather than leaving unaudited access state.

Runner heartbeat/health telemetry is operational state and does not require an audit event for every heartbeat; material trust, ownership, authorisation, or capability changes do.

## 22. Route Selection Contract

The existing `ModelGateway` remains useful but should evolve from a provider-only preference model toward an execution-route policy contract.

A routing request should be able to express:

- logical role/agent requirement;
- required capabilities;
- preferred/forbidden providers or models where policy requires;
- preferred/forbidden harnesses;
- subscription-first or cost policy;
- whether metered API is permitted;
- independent-review constraints;
- connection scope preference (`requester`, `project_pool`, `organisation`);
- project/organisation risk and budget constraints;
- structured-output requirement where applicable.

The selected response/evidence must expose the concrete route that actually executed the task.

## 23. Reuse, Refactor, and New Build Assessment

This requirement is **not a restart**. The current platform has substantial reusable foundations, but describing the change as only a refactor would understate the new connection/delegation runtime work.

### 23.1 Reuse largely as-is

The following concepts/implementations should be retained and extended:

- `ModelGateway` adapter registration and eligibility-based selection;
- separation of provider, model, execution mode, cost type, priority, availability, and capabilities;
- subscription-first and metered-API policy mechanics already tested in the gateway;
- provider-neutral `ModelRequest` / `ModelResponse` boundary;
- official OpenAI, Anthropic, and Google API adapters as metered API routes;
- live Product Partner durable conversation flow and execution metadata;
- canonical Product Knowledge and platform-owned context reconstruction;
- organisation/project authentication and RBAC;
- immediate session/account/project revocation patterns;
- PostgreSQL `DatabaseUnitOfWork` and append-only audit controls;
- ECC agent/skill source assets;
- ECC session-adapter/cross-harness concepts;
- existing repository/worktree and verification substrate for later Engineering Studio use.

### 23.2 Refactor/generalise

The following existing areas need targeted generalisation:

- replace closed `ModelProvider = 'openai' | 'anthropic' | 'google'` assumptions with stable extensible provider identifiers/registry validation;
- remove fixed single-route IDs and allow multiple routes/models per provider;
- replace one-environment-variable-model-per-provider runtime registration with route/connection-driven configuration;
- extend route capabilities to include structured output and harness/runtime capabilities needed by extraction and engineering;
- move Product Partner selection away from hard-coded provider unions in domain/API/web types while preserving the simple OpenAI/Claude/Gemini/Auto initial UI;
- evolve routing from only `preferredProvider` toward connection scope, harness, capability, risk, cost, and review-independence policy;
- evolve execution metadata into a common auditable execution-evidence contract.

### 23.3 New implementation required

The following are genuinely new product/runtime capabilities:

- durable personal and organisation AI connection records;
- per-project Do Not Share / Online Only / Persistent delegation state;
- connection-owner usage contribution policies;
- Agent Bridge or equivalent authorised runner registration, heartbeat, trust, and revocation;
- provider-supported subscription harness adapters such as Codex/ChatGPT, Claude Code, Antigravity, and future equivalents;
- project execution-pool construction from requester, contributed, and organisation routes;
- connection-aware route health and quota/availability tracking;
- UI for connection ownership, project sharing, status, persistence, usage limits, and revocation;
- provider/account/harness delegation-eligibility rules;
- ECC adapter functionality for approved agent/skill enumeration and task/session normalisation;
- tests proving no credential leakage, project-scope isolation, safe revocation, correct pooling/routing, and durable handoff.

## 24. Delivery Sequencing Constraint

This design should change how the next Product Knowledge extraction work is shaped, but it should not require implementing the entire subscription/harness ecosystem before extraction can continue.

The recommended sequencing is:

1. **Foundation refactor now:** generalise provider/route identifiers enough to avoid the three-provider ceiling; add explicit structured-output capability; keep existing API adapters working.
2. **Complete review-first extraction:** route eligibility is capability-driven and remains provider-neutral.
3. **Add connection/delegation persistence and administration:** personal/organisation ownership, project share modes, usage policy, audit, and RBAC.
4. **Add Agent Bridge / subscription harness adapters incrementally:** Codex, Claude Code, Antigravity and other officially supported routes, each behind the same contracts.
5. **Wire ECC agent/harness execution into Engineering Studio:** reuse ECC agent/skill/session substrate and project execution pools.

This preserves V1 progress while preventing V1 contracts from becoming an obstacle to the later subscription-first product.

## 25. Current Provider Support Snapshot

Provider capabilities and terms are external dependencies and must be revalidated when each adapter ships. This section records the design evidence available on 11 August 2026; it is not permission to bypass provider rules.

- OpenAI documents Codex as included with eligible ChatGPT plans and supports signing Codex clients in with a ChatGPT account. OpenAI also documents programmatic Codex control through the Codex SDK. This supports a distinct ChatGPT/Codex subscription route in our architecture, subject to the exact supported client/authentication boundary at implementation time.
- Anthropic documents Claude Code authentication using a Claude App Pro or Max plan as an alternative to separately billed Anthropic Console access. This supports a distinct Claude Code subscription route.
- Google documents that consumer Gemini Code Assist/Gemini CLI access for individual/Google AI Pro/Ultra tiers stopped on 18 June 2026 and directs those users to Antigravity/Antigravity CLI. This demonstrates why harness identity and provider identity must remain separate and replaceable.

None of those facts by itself establishes that an individual consumer entitlement may be pooled across different human users. Project delegation therefore remains capability-and-policy gated and must use only an officially permitted execution pattern.

Official references:

- OpenAI: `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
- Anthropic: `https://docs.anthropic.com/en/docs/claude-code/getting-started`
- Google: `https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals`

## 26. Required Parent-Document Updates

After this written design is approved, the parent SRS and Technical Architecture shall be revised rather than leaving contradictory v1.2 wording in place.

The revision should at minimum update provider/model extensibility, subscription execution, Agent Bridge, collaboration/connection ownership, project sharing modes, route pooling, capability-driven extraction, ECC agent/harness integration, audit requirements, and phased V1/V2/V4 scope boundaries.

## 27. Acceptance Criteria for This Architecture

The architecture is correctly implemented when all of the following are true:

1. Core domain contracts no longer impose a three-provider ceiling.
2. Multiple models/routes can coexist for one provider without fixed route-ID collisions.
3. API routes remain usable and separately classified from subscription-backed routes.
4. Personal connections remain user-owned and default to Do Not Share.
5. Opting into project sharing defaults to Online Only.
6. Persistent project availability requires an explicit owner toggle and a suitable authorised runner.
7. Web sign-out does not delete or invalidate durable project state.
8. A shared eligible connection is automatically available to authorised collaborators through the orchestrator, not through credential sharing.
9. The requester's own eligible route is preferred before the project pool under ordinary policy.
10. Multiple contributed project routes are selected by capability/availability/policy rather than always preferring the project owner's connection.
11. Organisation connections and approved API fallbacks remain independent routing tiers.
12. Revoking project sharing blocks new use without deleting historical project evidence.
13. Provider/account/harness delegation eligibility is checked before a personal connection enters the executable project pool.
14. Route capabilities, including structured output, are evaluated per concrete route.
15. Review-first Product Knowledge extraction cannot bypass its structured-output and canonical-acceptance guarantees because of route changes.
16. ECC agent definitions can be selected independently of provider/model/harness assignments.
17. Harness failures or user departure do not become project-memory failures.
18. Every material connection/sharing/routing mutation is tenant/project scoped and auditable.
19. No collaborator can retrieve another user's provider credentials through the API, UI, logs, audit records, prompts, or task context.
20. Existing API-backed Product Partner behaviour remains covered by regression tests during the refactor.

## 28. Locked Design Decisions

The decisions in Sections 3–27 are the agreed baseline from the 11 August 2026 design discussion. Material changes require an explicit later design decision rather than being introduced implicitly during implementation.
