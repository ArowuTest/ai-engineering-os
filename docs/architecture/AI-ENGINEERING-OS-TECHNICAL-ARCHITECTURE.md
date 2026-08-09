# AI Product & Engineering Operating System
## Technical Architecture & Detailed Module Specification

**Document version:** 1.2
**Status:** Approved technical baseline for V1 planning
**Date:** 9 August 2026
**Parent:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md`

## 0. Change Record

Version 1.2 retains the private-derivative baseline and adds the approved V1 authentication/collaboration architecture.

- `ArowuTest/ai-engineering-os` is an independent private repository seeded from official ECC.
- `affaan-m/ECC` is a read-only upstream source of candidate updates.
- Upstream changes enter only through review, testing and an update PR.
- Private product code is isolated from ECC core wherever practical.
- Subscription-backed and API-backed model execution are separate routes behind one gateway.
- V1 is a modular monolith focused first on Product Studio and persistent project knowledge.

## 1. Purpose

This architecture defines the system that takes a software idea through product discovery, formal requirements, engineering, independent review, QA, preview and deployment using interchangeable AI providers.
## 2. Architectural North Star

```text
USER
 │
 ▼
WEB APPLICATION
 ├── Product Studio
 ├── Engineering Studio
 ├── Review & QA Studio
 ├── Documents / Preview
 └── Administration
 │
 ▼
PLATFORM API + ORCHESTRATOR
 │
 ├── Product Knowledge
 ├── Model Gateway
 ├── Skill / MCP Capability Layer
 ├── Policy / Cost Router
 └── Execution Control
 │
 ▼
OpenAI / Anthropic / Google / future providers
 │
 ▼
ECC-backed agents + secure sandboxes + GitHub + CI/CD
```

The platform owns durable workflow state. AI sessions are replaceable workers.
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

### ADR-007 — Provider-Neutral Model Gateway
Product and orchestration modules depend on internal contracts, not provider SDKs directly.

### ADR-008 — Platform-Owned Canonical State
Provider conversation/session state can assist execution but is never the sole project record.

### ADR-009 — Subscription-First Hybrid Routing
Use officially supported subscription-backed execution first where suitable; use API routes when required by capability, reliability or automation policy.

### ADR-010 — Independent Review Policy
The orchestration layer decides whether independent review is satisfied; the Engineer cannot self-certify material work.
## 4. Repository Layout

```text
ai-engineering-os/
├── agents/              # ECC baseline
├── skills/              # ECC baseline
├── rules/               # ECC baseline
├── hooks/               # ECC baseline
├── commands/            # ECC baseline
├── mcp-configs/         # ECC baseline
├── scripts/             # ECC baseline
├── src/                 # ECC baseline
├── platform/
│   ├── apps/web/
│   ├── modules/
│   ├── packages/
│   └── workers/
├── bridge/
│   ├── desktop-agent/
│   └── provider-adapters/
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

A new skill or MCP appearing upstream never automatically receives access to private projects or credentials.

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
            ├── Model provider adapters
            ├── GitHub adapter
            └── ECC adapter
```
## 8. Application Module Boundaries

V1 is a modular monolith with explicit internal contracts.

```text
platform/
├── apps/web/                 # Product Owner web interface
├── apps/api/                 # HTTP/API composition root
├── modules/
│   ├── projects/             # project lifecycle and ownership
│   ├── product-knowledge/    # canonical structured understanding
│   ├── conversations/        # provider-neutral conversation records
│   ├── product-packages/     # package versioning and approval
│   ├── providers/            # routes, capabilities, usage
│   ├── skills/               # trusted skill registry
│   ├── tools/                # MCP/tool registry and permissions
│   └── audit/                # append-only material events
├── packages/
│   ├── model-gateway/        # provider-neutral model contracts
│   ├── ecc-adapter/          # narrow ECC compatibility boundary
│   ├── domain/               # shared domain types and invariants
│   └── config/               # typed runtime configuration
└── workers/                  # durable/background execution entry points
```

A module owns its data and public interface even when modules share one deployment process.
## 9. Data Architecture

Primary persistence is PostgreSQL. `pgvector` may be enabled for semantic retrieval, but relational identifiers and statuses remain authoritative.

Core V1 entities:

- `organisations`, `users`, `memberships`;
- `projects`, `project_versions`;
- `product_knowledge`, `knowledge_revisions`;
- `conversations`, `conversation_messages`;
- `documents`, `document_versions`;
- `requirements`, `requirement_versions`;
- `product_packages`, `package_approvals`;
- `provider_connections`, `provider_routes`, `provider_usage`;
- `skills`, `skill_versions`, `project_skills`;
- `tools`, `tool_permissions`, `project_tools`;
- `audit_events`.

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

A Context Builder queries approved/confirmed project knowledge, relevant source material, requirements and decisions for each task. It explicitly excludes unrelated conversation history and irrelevant tool descriptions.

Model switching therefore means rebuilding a task context from canonical state, not replaying an entire previous provider conversation.
## 11. Model Gateway and Provider Routing

The Model Gateway exposes internal contracts for session creation, turn execution, tools/files, cancellation, capabilities, health and usage metadata.

Provider adapters are replaceable implementations. V1 defines adapters for OpenAI, Anthropic and Google, but can initially run them as stubs until credentials/routes are configured.

Routing order is policy driven:

```text
requested role/task
      ↓
capability + risk check
      ↓
supported subscription route?
      ├── yes → prefer it
      └── no  → suitable alternate subscription?
                    ├── yes → use it
                    └── no  → API route subject to budget/approval
```

The gateway records execution route separately from provider identity so `Claude subscription`, `Claude API`, `Codex subscription` and `OpenAI API` are distinct routes.

No core product module imports a provider SDK directly.
## 12. Subscription Execution and Agent Bridge

Where a provider officially permits subscription-backed programmatic agent work, it is exposed through a subscription adapter.

A local Agent Bridge is used only where execution must occur through a user-authenticated local harness. The bridge:

- initiates outbound authenticated connectivity;
- keeps provider login/session material local where practical;
- accepts only signed, scoped task envelopes;
- restricts workspace, operations and expiry;
- streams status and permitted artefacts back to the platform.

Normal consumer chat sessions are not scraped or impersonated as unofficial APIs.

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

Default lifecycle: create isolated workspace → inject scoped credentials → implement/test → collect evidence → persist checkpoint → commit revision → destroy ephemeral environment.

ECC's canonical session/worker concepts and worktree lifecycle are adapted rather than duplicated.
## 16. Independent Review and Quality Gates

Review is a separate execution context with a policy preference for a different provider from the Engineer.

Reviewer context includes approved requirements, acceptance criteria, architecture, code/diff, test evidence and relevant policies. It excludes unnecessary engineer reasoning.

Required gate types are configurable and can include build, lint, type-check, unit/integration tests, security scans, independent review, E2E and requirement coverage.

Reviewer findings are persisted with severity, evidence, affected requirement/code, status and resolution/waiver information.

## 17. GitHub Boundary

GitHub stores source history, branches, pull requests, statuses and releases, but the Product Owner interface remains the web product.

The Engineering OS repository itself uses large, meaningful local commits and controlled pushes. Routine file editing occurs in the Desktop working copy rather than through one-file-at-a-time GitHub API writes.

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
- human approval for production deployment and security waivers.

## 19. Observability and Cost

The platform records workflow state, provider route, latency, usage/cost metadata, tool actions, sandbox/build/test results and deployment evidence.

Cost events distinguish subscription-included usage, provider credits, metered APIs, infrastructure and external tools. Budget policies may force provider switching or human approval before paid execution.
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

## 21. V1 Implementation Boundary

V1 proves project creation, canonical Product Knowledge, provider-neutral conversation/model contracts, Product Package versioning, skill/tool registry foundations, auditability and model-switch continuity.

V1 does not require autonomous code generation, full sandbox orchestration, production deployment automation or automatic OneSkill installation.

The first engineering batch shall establish the platform workspace, database/domain contracts and tests before live provider integrations.

## 22. Architecture Principle

**Agents do work. The platform owns state.**

A worker may disappear, hit quota or be replaced; approved product knowledge, requirements, task state, source code and evidence remain recoverable and provider-independent.
## 23. Transactional Integrity for Material Actions

A material Product/Engineering state mutation and its mandatory audit event must commit atomically.

The PostgreSQL layer exposes a `DatabaseUnitOfWork` that creates transaction-scoped project, Product Knowledge and audit repositories. API write use cases execute the domain write and corresponding audit append within the same database transaction.

If audit persistence or any later operation fails, PostgreSQL rolls the complete transaction back. The platform must never return an error while silently leaving an unaudited product mutation committed.

This is enforced by integration tests that deliberately reject audit insertion and verify that the associated project does not survive.

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

The detailed V1 contract is defined in `docs/architecture/AUTHENTICATION-COLLABORATION-V1-DESIGN.md`.
