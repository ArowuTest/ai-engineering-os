# AI Product & Engineering Operating System
## Technical Architecture & Detailed Module Specification

**Document version:** 1.3
**Status:** Approved technical baseline for V1 planning
**Date:** 11 August 2026
**Parent:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md`
**Execution design:** `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`

## 0. Change Record

### Version 1.3

Version 1.3 incorporates the approved extensible AI execution, harness and shared-entitlement architecture while preserving the V1 Product Studio delivery sequence.

- Provider, model, execution route, harness, agent, skill, tool, connection and runner are separate architectural concepts.
- Core contracts must support N providers, N models per provider and N execution routes rather than imposing a three-provider ceiling.
- OpenAI, Anthropic and Google remain the initial implemented API provider families; they are not the domain-model limit.
- Route capabilities are evaluated per concrete route. Structured output is an explicit capability required by review-first Product Knowledge extraction.
- Personal AI connections remain user-owned. Organisation AI connections are separate resources.
- Personal connections default to Do Not Share; project sharing defaults to Online Only; Persistent project availability requires an explicit owner toggle and a suitable authorised runner.
- Shared eligible connections form a project execution pool governed by the AI Engineering OS orchestrator and project RBAC; credentials are never exposed to collaborators.
- The requester's own eligible connection is preferred before contributed project routes under ordinary policy; project-owner capacity is not automatically privileged over other contributed capacity.
- User sign-out, connection loss or harness failure never removes canonical project state.
- ECC agents and skills are reusable capabilities selected independently from provider/model/harness assignments.
- Subscription-harness and Agent Bridge implementation remains phased after the V1 routing foundation and review-first extraction work.

### Version 1.2

Version 1.2 retained the private-derivative baseline and added the approved V1 authentication/collaboration architecture.

- `ArowuTest/ai-engineering-os` is an independent private repository seeded from official ECC.
- `affaan-m/ECC` is a read-only upstream source of candidate updates.
- Upstream changes enter only through review, testing and an update PR.
- Private product code is isolated from ECC core wherever practical.
- Subscription-backed and API-backed model execution are separate routes behind one gateway.
- V1 is a modular monolith focused first on Product Studio and persistent project knowledge.

## 1. Purpose

This architecture defines the system that takes a software idea through product discovery, formal requirements, engineering, independent review, QA, preview and deployment using interchangeable AI execution resources.

It keeps provider/model intelligence, harness execution and agent definitions replaceable while the platform owns durable product, engineering, review and audit state.

## 2. Architectural North Star

```text
USER / COLLABORATORS
        │
        ▼
WEB APPLICATION
 ├── Product Studio
 ├── Engineering Studio
 ├── Review & QA Studio
 ├── Documents / Preview
 └── Administration / AI Connections
        │
        ▼
PLATFORM API + MASTER ORCHESTRATOR
 ├── Product Knowledge / Project State
 ├── Execution-Route Gateway
 ├── Provider + Model Registry
 ├── Harness + Runner Registry
 ├── Agent + Skill Registry
 ├── MCP / Tool Capability Layer
 ├── Connection / Entitlement Policy
 └── Cost / Risk / Review Router
        │
        ▼
EXECUTION ROUTES
 ├── OpenAI API / Codex-supported routes
 ├── Anthropic API / Claude Code-supported routes
 ├── Google API / Antigravity-supported routes
 ├── organisation-owned routes
 └── future providers / harnesses
        │
        ▼
ECC-backed agents + secure sandboxes/worktrees + GitHub + CI/CD
```

The platform owns durable workflow state. Models, harnesses, agents, connections and user sessions are replaceable execution resources.

## 3. Architecture Decisions

### ADR-001 — Separate Web Product
ECC is an engineering substrate, not the Product Owner interface. The user works in a dedicated web application.

### ADR-002 — Independent Private ECC Derivative
The project does not use GitHub's public-fork mechanism. The private repository contains the ECC baseline plus proprietary platform code.

### ADR-003 — Exact Upstream Provenance
The repository records the accepted ECC source commit, import date and later accepted update commits in `UPSTREAM.md`.

### ADR-004 — Controlled Upstream Updates
No upstream release is blindly merged into private `main`. Updates are diffed, classified, scanned, tested and reviewed on a dedicated branch.

### ADR-005 — Isolate Proprietary Extensions
New product code should live primarily under `platform/`, `extensions/` and `bridge/`. Direct changes to ECC core require explicit justification.

### ADR-006 — Modular Monolith First
Logical module boundaries are strict, but V1 avoids premature microservices.

### ADR-007 — Provider-Neutral Execution Gateway
Product and orchestration modules depend on internal execution-route contracts, not provider SDKs directly. A provider family may expose multiple models and multiple API/subscription/enterprise routes.

### ADR-008 — Platform-Owned Canonical State
Provider conversations, harness sessions and local runner state can assist execution but are never the sole project record.

### ADR-009 — Subscription-First Hybrid Routing
Use officially supported subscription-backed execution first where suitable; use API routes when required by capability, reliability, automation or policy.

### ADR-010 — Independent Review Policy
The orchestration layer decides whether independent review is satisfied; the Engineer cannot self-certify material work.

### ADR-011 — Separate Provider, Model, Route, Harness and Agent Identity
Provider, model, route, harness and agent are independent identifiers. Codex, Claude Code, Antigravity and Hermes are harness/runtime surfaces rather than provider identities, and ECC agent definitions are not tied permanently to one model.

### ADR-012 — User-Owned Entitlements and Explicit Delegation
Personal AI connections remain owned by the authenticating user. They begin private and may be delegated only to explicit project scopes and only where provider/account/harness policy permits. Organisation connections are separate resources.

### ADR-013 — AI Engineering OS Remains Master Orchestrator
Harnesses may execute bounded work and expose canonical session state, but they do not independently redefine project scope, permissions, budget, reviewer independence, canonical Product Knowledge or deployment authority.

### ADR-014 — Capability-Driven Structured Execution
Capabilities belong to concrete execution routes. Product Knowledge extraction and other schema-dependent work may require `structuredOutput` even when an ordinary chat route for the same provider remains usable.

## 4. Repository Layout

```text
ai-engineering-os/
├── agents/              # ECC baseline agent definitions
├── skills/              # ECC baseline skills
├── rules/               # ECC baseline
├── hooks/               # ECC baseline
├── commands/            # ECC baseline
├── mcp-configs/         # ECC baseline
├── scripts/             # ECC baseline / harness-session substrate
├── src/                 # ECC baseline
├── platform/
│   ├── apps/web/
│   ├── apps/api/
│   ├── modules/
│   ├── packages/
│   └── workers/
├── bridge/
│   ├── desktop-agent/        # future authorised Agent Bridge/runner
│   ├── provider-adapters/    # provider/API route adapters where isolated here
│   └── harness-adapters/     # Codex/Claude Code/Antigravity/Hermes style boundaries
├── extensions/
│   ├── agents/
│   ├── skills/
│   ├── workflows/
│   └── mcp/
├── docs/product/
├── docs/architecture/
├── docs/adr/
├── docs/superpowers/specs/
├── docs/superpowers/plans/
└── UPSTREAM.md
```

## 5. ECC Integration Boundary

ECC provides the engineering operating substrate. We reuse or adapt:

- agents and skills;
- TDD, planning, review and verification workflows;
- rules and hooks;
- AgentShield/security patterns;
- orchestration skills;
- session-adapter concepts;
- MCP inventory concepts;
- worktree lifecycle management.

A narrow `platform/packages/ecc-adapter` boundary prevents the private product from depending directly on arbitrary ECC internals.

The adapter shall be responsible for:

- enumerating approved ECC agents and skills;
- translating platform tasks into ECC-compatible execution inputs;
- normalising ECC worker/session outputs;
- mapping ECC verification output into platform quality gates;
- exposing accepted ECC baseline metadata.

The existing ECC agent definitions are reusable capabilities, not hard-coded provider/model assignments. Platform roles such as Product Partner, Engineer, Reviewer and Security Reviewer may map to one or more approved agent definitions according to task type and policy.

Where compatible, harness-session integration shall build on ECC's canonical session-adapter concepts such as `ecc.session.v1` rather than making the private platform read harness-specific files directly.

Provider code and hard-coded model catalogues from ECC are not adopted unchanged where they conflict with current provider-native APIs or the platform's provider-neutral contracts.

## 6. Upstream Update Architecture

The accepted upstream baseline is stored as repository metadata and in `UPSTREAM.md`.

```text
ECC update detected
      ↓
Fetch into review workspace
      ↓
Diff from accepted baseline
      ↓
Classify security / bug / skill / agent / MCP / orchestration changes
      ↓
Security + compatibility analysis
      ↓
Run ECC and private-platform regression tests
      ↓
Create dedicated update PR
      ↓
Independent review
      ↓
Merge only approved changes
      ↓
Advance accepted upstream baseline
```

A new skill, agent, harness feature or MCP appearing upstream never automatically receives access to private projects or credentials.

## 7. V1 Physical Topology

```text
Cloudflare or equivalent edge
            │
            ▼
      Next.js Web App
            │
            ▼
   Platform Backend/API
       ┌────┼─────┐
       ▼    ▼     ▼
 Postgres Worker Object Storage
            │
            ├── Model/execution-route adapters
            ├── GitHub adapter
            └── ECC adapter
```

V1 may run only API-backed provider routes while retaining contracts that can later register subscription/harness routes without changing Product Studio domain semantics.

## 8. Application Module Boundaries

V1 is a modular monolith with explicit internal contracts.

```text
platform/
├── apps/web/                 # Product Owner web interface
├── apps/api/                 # HTTP/API composition root
├── modules/
│   ├── projects/             # project lifecycle and ownership
│   ├── product-knowledge/    # canonical structured understanding + candidate review
│   ├── conversations/        # provider-neutral conversation records
│   ├── product-packages/     # package versioning and approval
│   ├── providers/            # provider/model/route catalogues and capabilities
│   ├── connections/          # later personal/org AI connection governance
│   ├── runners/              # later Agent Bridge/harness runner governance
│   ├── skills/               # trusted skill registry
│   ├── tools/                # MCP/tool registry and permissions
│   └── audit/                # append-only material events
├── packages/
│   ├── model-gateway/        # provider-neutral execution-route contracts
│   ├── ecc-adapter/          # narrow ECC compatibility boundary
│   ├── domain/               # shared domain types and invariants
│   └── config/               # typed runtime configuration
└── workers/                  # durable/background execution entry points
```

A module owns its data and public interface even when modules share one deployment process.

## 9. Data Architecture

Primary persistence is PostgreSQL. `pgvector` may be enabled for semantic retrieval, but relational identifiers and statuses remain authoritative.

Core entities across the approved roadmap include:

- `organisations`, `users`, `organisation_memberships`, `project_memberships`;
- `invitations`, `auth_sessions`;
- `projects`, `project_versions`;
- `product_knowledge`, `knowledge_revisions`;
- `knowledge_extraction_runs`, `knowledge_candidates`;
- `conversations`, `conversation_messages`;
- `documents`, `document_versions`;
- `requirements`, `requirement_versions`;
- `product_packages`, `package_approvals`;
- provider/model/route catalogue and usage records;
- later `ai_connections`, `ai_connection_project_shares`, `ai_runners` and common execution evidence;
- `skills`, `skill_versions`, `project_skills`;
- `tools`, `tool_permissions`, `project_tools`;
- `audit_events`.

The current database may implement only the subset required by the active delivery slice. The absence of later connection/runner tables does not permit provider-specific state to become canonical project state.

Large binary artefacts use S3-compatible object storage and database metadata references.

Every tenant-owned row contains an organisation boundary. Every project-owned row additionally contains a project boundary.

Approved historical package/requirement revisions are immutable; later changes create new revisions.

## 10. Product Knowledge Service

The Product Knowledge Service is the canonical product-memory boundary.

Each knowledge record includes:

- stable ID;
- organisation/project IDs;
- category and title;
- statement/content;
- status: `proposed`, `inferred`, `confirmed`, `approved`, `superseded`, `rejected`;
- source/provenance;
- current revision;
- creator type and timestamp.

AI output may propose or infer knowledge but cannot silently convert it to an approved fact.

For V1, AI extraction is **review-first**: extracted requirements, rules, assumptions, risks and decisions are persisted as non-canonical candidates in a review queue. Only an explicit authorised-user acceptance operation may promote a candidate into canonical Product Knowledge; rejection leaves canonical knowledge unchanged.

The normal Product Partner extraction route requires both `chat` and explicit `structuredOutput` capability. Structured-output eligibility is attached to a concrete route, not inferred from provider name.

A Context Builder queries approved/confirmed project knowledge, relevant source material, requirements and decisions for each task. It explicitly excludes unrelated conversation history and irrelevant tool descriptions.

Model or route switching therefore means rebuilding task context from canonical platform state, not replaying an entire previous provider or harness conversation.

## 11. Execution Gateway and Route Policy

The existing Model Gateway remains the provider boundary but evolves into an execution-route gateway. It exposes internal contracts for session/turn execution, structured output, tools/files, cancellation, capabilities, health and usage metadata.

Provider adapters are replaceable implementations. OpenAI, Anthropic and Google are the initial API provider families, not a closed domain enumeration. Multiple models and multiple route IDs may coexist for one provider.

A concrete route records at least:

- stable route ID;
- provider ID;
- model ID/name;
- execution mode;
- cost type;
- availability/health;
- priority;
- route capabilities;
- later harness, connection scope, runner and delegation metadata where applicable.

Routing is policy driven:

```text
requested role / agent / task
      ↓
required capabilities + risk + review constraints
      ↓
requester's eligible route?
      ├── yes → prefer under ordinary policy
      └── no  → eligible project-pool route?
                    ├── yes → choose by capability/health/policy
                    └── no  → organisation subscription/enterprise route?
                                  ├── yes → use it
                                  └── no  → approved API/alternate route or pause
```

V1 Product Studio may initially have only API routes configured. Later subscription routes use the same gateway contracts rather than a separate product workflow.

`Auto` means policy-driven route selection; it is not a provider or model.

No core product module imports a provider SDK directly.

## 12. Subscription Execution, Connections and Agent Bridge

Where a provider officially permits subscription-backed programmatic agent work, it is exposed as a distinct execution route rather than pretending consumer chat access is API access.

A personal AI connection belongs to the user who authenticated it. An organisation-owned connection is a separate organisation resource. Provider credentials, refresh tokens and provider session material are never transferred to collaborators or made project-owned.

Personal connections have project sharing states:

- **Do Not Share** — default when connected;
- **Online Only** — default after the owner opts into project sharing; usable only while the owner has active AI Engineering OS presence and the authorised runner is online;
- **Persistent** — explicit owner opt-in; may remain eligible after web sign-out while a suitable authorised persistent runner remains reachable.

Project sharing grants execution eligibility to the orchestrator, not direct credential access to collaborators. It remains subject to project RBAC, provider/account/harness delegation eligibility, route capability, cost/risk policy and owner limits.

A local or managed Agent Bridge is used only where execution must occur through a user-authenticated harness. The bridge:

- initiates outbound authenticated connectivity;
- keeps provider login/session material local where practical;
- uses scoped, revocable runner credentials distinct from provider credentials;
- accepts only signed, scoped task envelopes;
- restricts workspace, operations and expiry;
- advertises safe capability/health/availability metadata;
- streams status, checkpoints and permitted artefacts back to the platform.

Normal consumer chat sessions are not scraped, impersonated or converted into unofficial APIs.

## 13. Skills and OneSkill

ECC skills are the trusted baseline. External skills are quarantined before use.

External intake records source, version/commit, checksum, scripts, dependencies, permissions, network destinations, scan evidence and approval status.

OneSkill is a discovery source, not a trust authority. A new version of an approved skill is a new artefact and must be reviewed again.

## 14. MCP / Tool Registry

ECC's MCP inventory concepts are reused through the ECC adapter. The private platform owns project permissions and activation policy.

Each tool records:

- trust/risk level;
- supported operations (`READ`, `WRITE`, `EXECUTE`, `DELETE`, `DEPLOY`);
- allowed roles;
- allowed environments;
- credential reference requirements;
- organisation/project scope.

Only task-relevant tools are exposed to a worker. A database task does not inherit deployment credentials, and a reviewer does not receive production deployment authority.

## 15. Engineering Execution Plane

V2 engineering work runs in isolated worktrees/sandboxes, never as arbitrary code on the web/API host.

Default lifecycle: create isolated workspace → select authorised agent/model/harness/route → inject only scoped credentials → implement/test → collect evidence → persist checkpoint → commit revision → destroy or release ephemeral environment.

ECC agent definitions are selected independently from model/provider/harness assignment. ECC's canonical session/worker concepts and worktree lifecycle are adapted rather than duplicated.

Hermes is initially a harness/operator runtime beneath AI Engineering OS orchestration. Codex, Claude Code, Antigravity, OpenCode and other supported harnesses follow the same principle: execution state is normalised at the adapter boundary; canonical project truth remains in the platform/repository.

## 16. Independent Review and Quality Gates

Review is a separate execution context with a policy preference for a different provider from the Engineer where a suitable alternative exists. Review independence is an orchestration policy constraint, not a fixed model mapping.

Reviewer context includes approved requirements, acceptance criteria, architecture, code/diff, test evidence and relevant policies. It excludes unnecessary engineer reasoning.

Required gate types are configurable and can include build, lint, type-check, unit/integration tests, security scans, independent review, E2E and requirement coverage.

Reviewer findings are persisted with severity, evidence, affected requirement/code, status and resolution/waiver information.

## 17. GitHub Boundary

GitHub stores source history, branches, pull requests, statuses and releases, but the Product Owner interface remains the web product.

The Engineering OS repository itself uses large, meaningful local commits and controlled pushes. Routine file editing occurs in the Desktop working copy rather than through one-file-at-a-time GitHub API writes when that working copy is available.

Application projects managed by the product may later use separate repositories and worktrees controlled by the GitHub service.

## 18. Security Architecture

Secrets are encrypted and never stored in source control or returned to browser clients. Agents receive task-scoped credentials wherever possible.

Untrusted inputs include uploaded documents, repository content, web content, tool output and external skills. They are treated as data unless explicitly authorised as platform policy.

Core controls:

- organisation/project isolation;
- least-privilege RBAC;
- append-only audit events for material actions;
- skill and MCP provenance/permission review;
- secret and dependency scanning;
- execution sandboxing;
- human approval for production deployment and security waivers;
- personal connection ownership and project-scope delegation boundaries;
- no collaborator access to another user's provider credentials;
- distinct scoped runner credentials for Agent Bridge processes;
- prompt-injection resistance for connection ownership, sharing and credential scope.

Organisation administrators may restrict or prohibit personal connection use but cannot silently opt a user's personal entitlement into sharing.

## 19. Observability and Cost

The platform records workflow state, concrete execution route, provider, model, harness where applicable, connection scope/owner where safe, latency, usage/cost metadata, tool actions, sandbox/build/test results and deployment evidence.

Cost events distinguish subscription-included usage, provider credits, metered APIs, infrastructure and external tools. Budget policies may force provider switching or human approval before paid execution.

Where provider quota telemetry is unavailable, the platform may use conservative task/turn counters, provider health/throttling signals and owner-defined limits. It must not claim a precise remaining percentage that the provider does not expose.

## 20. Initial Deployment Architecture

V1 should remain operationally simple:

- Next.js web application;
- TypeScript platform API/modular backend;
- worker process for durable/background jobs;
- PostgreSQL (local Docker for development; Neon permitted for shared test/staging);
- S3-compatible object storage when binary artefacts are introduced;
- GitHub for source control;
- Cloudflare or equivalent edge controls when deployed;
- Railway or equivalent as an initial application hosting option.

Deployment vendors are adapters, not domain dependencies.

Agent Bridge/persistent personal runners are later execution-plane components and do not need to run inside the V1 API host.

## 21. V1 Implementation Boundary

V1 proves project creation, canonical Product Knowledge, review-first extraction, provider-neutral conversation/execution-route contracts, Product Package versioning, skill/tool registry foundations, auditability and model/route-switch continuity.

The immediate V1 routing foundation shall:

- remove the closed three-provider domain ceiling while retaining the current three API adapters;
- support multiple route IDs/models per provider;
- add explicit `structuredOutput` route capability;
- keep Product Partner selection simple while avoiding provider-name assumptions in core execution contracts;
- complete review-first Product Knowledge extraction using capability-driven route eligibility.

V1 does not require personal connection administration, Agent Bridge, subscription harness adapters, autonomous code generation, full sandbox orchestration, production deployment automation or automatic OneSkill installation.

## 22. Architecture Principle

**Agents do work. The platform owns state.**

A worker may disappear, hit quota, be disconnected, sign out, leave a project or be replaced; approved Product Knowledge, requirements, conversations, task state, source code, checkpoints and evidence remain recoverable and provider/harness-independent.

## 23. Transactional Integrity for Material Actions

A material Product/Engineering state mutation and its mandatory audit event must commit atomically.

The PostgreSQL layer exposes a `DatabaseUnitOfWork` that creates transaction-scoped repositories. API write use cases execute the domain write and corresponding audit append within the same database transaction.

If audit persistence or any later operation fails, PostgreSQL rolls the complete transaction back. The platform must never return an error while silently leaving an unaudited material mutation committed.

Review-first extraction deliberately separates a durable successful conversation turn from candidate-persistence success, while candidate acceptance itself must atomically create canonical Product Knowledge, decide the candidate and append mandatory audit evidence.

Later connection/share policy changes such as enabling/revoking project sharing or changing Online Only/Persistent mode must use the same transaction-plus-audit principle. High-frequency runner heartbeats are operational telemetry and do not require a material audit event for every heartbeat.

## 24. Authentication and Collaboration Architecture

V1 authentication uses **User ID + password only**; email is not required.

New users join through administrator-generated one-time invitation keys. Keys are high entropy, displayed only at creation, stored only as cryptographic hashes, and become permanently unusable after redemption, expiry, cancellation or replacement.

Invitation TTL is organisation-policy driven with a default of **30 minutes**. The invitation stores its absolute expiry timestamp when created.

Access is evaluated through two layers:

- organisation membership: `owner`, `admin`, `member`;
- project membership: `product_owner`, `contributor`, `engineer`, `reviewer`, `viewer`.

A user may be removed from one project without losing access to another. Account suspension blocks all organisations/projects.

Authentication sessions are opaque random bearer values whose hashes are persisted in PostgreSQL. Protected requests re-check current user/session/membership state so revocation takes effect immediately rather than waiting for session expiry.

The web application will ultimately store the session in an HTTP-only cookie. Temporary development identity headers remain available only behind an explicit local-development flag and are disabled by default elsewhere.

Authentication-related database entities include `users`, `organisation_memberships`, `project_memberships`, `invitations` and `auth_sessions`.

Invitation/account/session/membership mutations and their required audit events must use the same PostgreSQL unit-of-work pattern already used for material Product Studio mutations.

No password, invitation plaintext or session plaintext may be written to audit metadata, application logs or browser-visible route metadata.

Project collaboration is independent of any one member's AI connection. Signing out or losing a personal route does not remove project membership, project memory or another collaborator's ability to continue through another eligible route.

The detailed V1 authentication contract is defined in `docs/architecture/AUTHENTICATION-COLLABORATION-V1-DESIGN.md`.

## 25. AI Connection, Sharing and Runner Architecture

The detailed contract is defined in `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`.

The key persisted concepts for the later connection/delegation slice are:

- `ai_connections` — personal or organisation-owned authenticated entitlement references;
- `ai_connection_project_shares` — explicit project delegation with `online_only` or `persistent` mode; absence of a share means Do Not Share;
- `ai_runners` — reachable authorised harness/Agent Bridge processes with safe capability and health metadata;
- common execution evidence — requester, project/task, provider, model, harness, route, connection scope/owner where applicable, runner, cost class, usage and outcome/checkpoint references.

Shared connections form an orchestrator-controlled project execution pool. A project member never receives the contributed connection's credentials. Route use requires active project membership, role permission, owner delegation, provider/account/harness eligibility, runner availability where required, route capability and project/organisation risk/cost policy.

Under ordinary collaborator-initiated routing, the requester's own eligible connection is preferred first, followed by eligible project-contributed capacity, then organisation-owned subscription/enterprise capacity, then approved metered/API or alternate routes. Independent-review or risk policy may intentionally override that ordering.

Revoking a share prevents new project executions through that connection without deleting historical project outputs or audit evidence.

## 26. Delivery Sequencing

The approved execution design is delivered in bounded, independently testable slices:

1. **Routing foundation:** extensible provider/route identifiers, multiple routes per provider, explicit structured-output capability, current API adapters preserved.
2. **Review-first Product Knowledge extraction:** candidate runs/queue, failure isolation, Product Owner review/promotion, UI and audit.
3. **AI connection/delegation administration:** personal/organisation ownership, project sharing modes, usage policy, RBAC and audit.
4. **Agent Bridge/subscription harness adapters:** Codex, Claude Code, Antigravity and other officially supported routes incrementally.
5. **Engineering Studio ECC execution:** approved ECC agents/skills, harness/session adapters, worktrees, checkpoints and independent review.

Each later slice builds on the same execution-route contracts rather than introducing a parallel provider-specific architecture.
