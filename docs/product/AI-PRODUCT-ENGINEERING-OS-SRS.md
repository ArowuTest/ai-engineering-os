# AI Product & Engineering Operating System
## Product Requirements & Software Requirements Specification

**Document version:** 1.4
**Status:** Approved baseline for V1 planning
**Date:** 12 August 2026
**Working name:** AI Engineering OS
**Parent initiative:** Private AI-native product and software engineering platform
**Execution design:** `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`
**ECC-native capability design:** `docs/superpowers/specs/2026-08-12-ecc-native-capability-productisation-design.md`

## 0. Change record

### Version 1.4

This revision makes explicit that AI Engineering OS is the enhanced, privately branded and productised evolution of the inherited ECC foundation rather than a separate platform that later imports ECC features.

1. Existing ECC agents, skills, commands, workflows, continuous learning, unified memory, evals, verification, security patterns, autonomous loops and MCP definitions are native product capabilities and must be preserved unless deliberately superseded or excluded with recorded rationale.
2. The engineering default is **reuse before rebuild; preserve before replace; generalise before discard**. Platform work productises and governs inherited capability instead of duplicating it.
3. Continuous Learning v2.1 becomes a first-class product capability: project-scoped observations/instincts, confidence scoring, controlled promotion and evolution into skills/commands/agents are retained and generalised across supported harnesses.
4. Unified Memory remains distinct from learning and supplies durable cross-harness project/team/user handoff context.
5. The Skills Registry and MCP/Tool Registry are seeded from the approved inherited ECC estate; they do not begin empty. External sources such as OneSkill are used to find missing capability only after trust/security/licence/compatibility review.
6. Advanced inherited ECC capabilities including team-agent orchestration, eval-harness/agent-eval, verification-loop, browser QA, canary-watch, context-budget, skill-compliance/health, benchmark optimisation, council, enterprise-agent-ops, cost tracking and iterative retrieval are retained for progressive productisation.
7. The product UI is project/team-centred with Auto/Recommended defaults plus advanced controls for models/routes, agents, skills and MCPs, and Platform/Organisation/Project administration scopes.

### Version 1.3

This revision incorporates the approved extensible AI execution, harness and shared-entitlement requirements while preserving the current V1 Product Studio sequence:

1. Provider, model, execution route, harness, agent, skill, tool, connection and runner are separate product concepts.
2. Core contracts shall support an extensible provider/model/route catalogue rather than imposing a three-provider ceiling. OpenAI, Anthropic and Google remain the initial provider families, not the domain limit.
3. Multiple models and execution routes may coexist for one provider. Route capability is evaluated per concrete route.
4. Review-first Product Knowledge extraction requires explicit structured-output capability and must not infer that capability from provider identity.
5. ECC's existing agent/skill substrate is reused through the private ECC adapter; agent definitions are assignable independently of provider/model/harness.
6. AI Engineering OS remains the master orchestrator. Hermes, Codex, Claude Code, Antigravity, OpenCode and future harnesses are replaceable execution surfaces rather than sources of canonical project truth.
7. Personal AI connections remain owned by the individual who authenticated them; organisation-owned AI connections are separate resources.
8. Personal AI connections default to **Do Not Share**. When a user opts into project sharing the default is **Online Only**; **Persistent** availability requires an explicit owner toggle and a suitable authorised persistent runner.
9. Once an eligible connection is shared with a project, authorised collaborators may benefit from it automatically through the orchestrator, subject to project RBAC, owner limits and provider/account/harness delegation eligibility. Credentials are never exposed to collaborators.
10. The requester's own eligible connection is preferred before contributed project capacity under ordinary routing policy. Multiple contributed connections form a shared pool selected by capability, health, quota/availability, cost/risk and policy rather than always consuming the project owner's connection first.
11. User sign-out, connection revocation, runner loss or provider failure shall not delete or strand durable project state.
12. The immediate delivery sequence is: routing-foundation generalisation → review-first Product Knowledge extraction → connection/delegation administration → subscription Agent Bridge/harness adapters → ECC-backed Engineering Studio execution.

### Version 1.2

This revision added the approved V1 authentication and collaboration requirements:

1. Permanent login is **User ID + password only**; email is not required for V1.
2. New users join through an administrator-generated **single-use invitation key**.
3. Invitation expiry is configurable by organisation policy, with a **30-minute default** and optional per-invitation override.
4. Invitation keys are stored only as cryptographic hashes and become permanently unusable after successful redemption, expiry, cancellation or replacement.
5. Organisation membership and project membership are separate access-control layers.
6. Administrators may revoke organisation access, remove a user from selected projects, suspend an account, and invalidate active sessions immediately.
7. Authentication, invitation, membership, role and revocation events are auditable.
8. Multiple independent projects and multiple product-discovery conversation sessions are supported while canonical Product Knowledge remains project-scoped.

### Version 1.1

This revision incorporated the decisions made after the original v1.0 requirements discussion:

1. The product will be based on an **independent private derivative of the official `affaan-m/ECC` repository**, not a GitHub public fork.
2. The private repository will retain the exact ECC baseline commit and use the official ECC repository only as a **read-only upstream source for candidate updates**.
3. ECC updates must pass an explicit update review gate before entering the private product.
4. ECC's built-in skills form the trusted baseline; selected external skills discovered through OneSkill may be added only after security, provenance and compatibility review.
5. The platform is **subscription-first, API-capable and provider-independent**. Existing supported subscription entitlements should be used where the provider officially permits programmatic agent execution; APIs are fallback/automation routes rather than the only route.
6. The platform owns project state; AI sessions are replaceable workers.
7. GitHub remains an engineering substrate and audit/source-control system, not the primary Product Owner interface.

---

# 1. Executive Summary

The AI Product & Engineering Operating System is a web application that enables a Product Owner to move from an early idea to a working, independently reviewed and deployable software product using an AI engineering organisation.

The user should be able to start with a conversation such as:

> I want to build an enterprise livestream platform with PPV, subscriptions, telco integrations and support for very large live audiences.

The system must first help the user understand and define the product. It must not immediately jump from a short prompt into coding.

The intended lifecycle is:

```text
IDEA
  ↓
PRODUCT DISCOVERY
  ↓
STRUCTURED PRODUCT KNOWLEDGE
  ↓
SRS / BRD / UI-UX / ARCHITECTURE / ACCEPTANCE CRITERIA
  ↓
PRODUCT PACKAGE APPROVAL
  ↓
ENGINEERING PLAN
  ↓
AI ENGINEERING
  ↓
INDEPENDENT AI REVIEW
  ↓
AUTOMATED QA / SECURITY / E2E
  ↓
PREVIEW
  ↓
RELEASE APPROVAL
  ↓
DEPLOYMENT
```

The platform shall support an extensible catalogue of AI providers, models and execution routes. OpenAI, Anthropic and Google are the initial provider families. Models and routes shall be assignable to roles rather than permanently tied to roles.

Agent definitions and execution harnesses are also independent from provider identity. An ECC code reviewer may run through Codex, Claude Code or another eligible harness; Hermes may act as an operator/runtime harness without becoming another model provider.

Examples:

- ChatGPT/OpenAI Product Partner → Claude Engineer → OpenAI Reviewer.
- Claude Product Partner → OpenAI Engineer → Claude Reviewer.
- Gemini/Antigravity UI specialist → Claude engineering reviewer.
- ECC security-reviewer agent → eligible independent provider/harness selected by policy.
- High-risk payment work → Engineer plus two independent reviewers.

The system is intended to feel like an **AI software company in a box**, not merely a coding assistant.

---

# 2. Product Vision

The Product Owner manages **what should be built and why**.

The AI organisation manages much of:

- discovery;
- analysis;
- formal requirements;
- technical design;
- implementation planning;
- coding;
- testing;
- code review;
- security review;
- release preparation.

The Product Owner should primarily interact with:

- natural-language conversation;
- product documents;
- decisions;
- diagrams;
- requirements;
- approvals;
- progress;
- risks;
- application previews;
- release status.

The Product Owner should not normally need to operate:

- Git commands;
- terminals;
- raw branches/worktrees;
- CI configuration;
- MCP configuration;
- provider SDKs;
- API payloads;
- infrastructure credentials.

---

# 3. Core Principles

## 3.1 Product understanding precedes implementation
A short prompt is not sufficient authority to build a complex application. Product discovery and requirements maturity come first.

## 3.2 Project state is permanent; sessions are temporary
No project shall depend on one long ChatGPT, Claude, Gemini, Codex, Hermes or other harness/session remaining available.

## 3.3 Models are workers, not the source of truth
The canonical Product Knowledge Store, approved Product Package, repository and task state belong to the platform.

## 3.4 Provider, model, harness and agent independence
Core business workflows shall not assume that Claude always engineers, Codex always handles backend work, Gemini always handles frontend work, or any ECC agent definition belongs permanently to one model/harness.

## 3.5 Independent review
An Engineer shall not be able to silently mark its own material work as independently approved.

## 3.6 Subscription-first execution
Where officially supported, eligible user or organisation subscription entitlements should be preferred before separately metered API execution, subject to capability, availability, delegation and project policy.

## 3.7 No provider restriction bypass
The system shall not imitate private browser sessions, scrape consumer chat applications, forward another user's credentials or otherwise bypass provider terms to turn consumer subscriptions into unofficial APIs.

## 3.8 Context efficiency
Only task-relevant documents, code, skills and MCP tools should be loaded into an agent context.

## 3.9 Least privilege
Agents, harnesses, runners and collaborators receive only the capabilities and credentials required for a task.

## 3.10 Human approval at consequential gates
Product baselines, security waivers, significant paid API use and production deployments require policy-controlled human approval by default.

## 3.11 Connection ownership is not project ownership
A personal AI connection remains owned by the individual who authenticated it. Project sharing delegates eligible execution capacity to the orchestrator without transferring provider credentials or ownership.

## 3.12 Collaboration survives individual availability
User sign-out, connection loss, model switching, runner failure or collaborator departure shall not delete canonical project state or prevent other authorised collaborators from continuing through another eligible execution route.

---

# 4. Open-Source Foundation Strategy

## 4.1 ECC foundation
AI Engineering OS is the enhanced private product evolution of the accepted ECC baseline. The inherited ECC repository is the native engineering-methodology, agent, skill, workflow, learning, memory, evaluation, verification and harness foundation of the product.

Relevant ECC capabilities include:

- agents;
- skills;
- rules;
- hooks;
- TDD workflows;
- planning;
- review;
- security;
- verification;
- memory concepts;
- orchestration;
- session adapters;
- MCP inventory;
- worktree lifecycle management;
- continuous-learning patterns.

ECC agent definitions, skills and other inherited engineering subsystems are native reusable capabilities. The platform shall enumerate, govern and select approved inherited assets through stable product contracts rather than recreating them as hard-coded private duplicates. Before replacing a material ECC subsystem, the implementation decision must be recorded as reuse, adapt/generalise, supersede or exclude with rationale.

## 4.2 Independent private derivative
The project shall **not** use GitHub's public fork mechanism.

Instead:

```text
PUBLIC SOURCE
affaan-m/ECC
      │
      │ baseline import / update comparison
      ▼
PRIVATE PRODUCT
ArowuTest/ai-engineering-os
```

The private repository contains our product and is accessible only to explicitly authorised GitHub users/integrations.

## 4.3 Upstream provenance
The repository must record:

- upstream repository URL;
- exact upstream baseline commit;
- imported date;
- accepted upstream version/tag where available;
- subsequent accepted update commits.

## 4.4 Controlled upstream updates
ECC updates shall never be blindly merged into private `main`.

Required process:

```text
ECC update detected
      ↓
Fetch into review workspace
      ↓
Diff from accepted baseline
      ↓
Classify changes
      ↓
Security review
      ↓
Compatibility review
      ↓
Automated tests
      ↓
Dedicated update branch / PR
      ↓
Independent review
      ↓
Approval
      ↓
Merge selected changes
      ↓
Record new accepted baseline
```

The update analyser should distinguish:

- security fixes;
- bug fixes;
- new/changed agents;
- new/changed skills;
- MCP changes;
- orchestration changes;
- session/worktree changes;
- provider adapter changes;
- harness/runner changes;
- files conflicting with private platform extensions.

## 4.5 Separation from ECC core
Our proprietary code should live in isolated namespaces such as `platform/`, `extensions/` and `bridge/` wherever practical. Direct edits to ECC core files should be exceptional and documented.

---

# 5. Skill Ecosystem

## 5.1 Trust classes
The Skill Registry shall support:

1. **ECC Core** — baseline skills inherited from the accepted ECC version.
2. **Curated External** — externally sourced skills that passed review.
3. **Organisation Private** — proprietary reusable skills.
4. **Project Specific** — skills limited to one project.
5. **Quarantine** — untrusted candidate skills.
6. **Rejected** — skills prohibited from execution.

## 5.2 OneSkill discovery
OneSkill or equivalent registries may be searched when a required capability is not adequately covered by trusted skills.

External discovery does not equal trust.

## 5.3 External skill intake
Candidate skill lifecycle:

```text
Discover
  ↓
Download to quarantine
  ↓
Record provenance + checksum
  ↓
Inspect prompts/scripts/dependencies
  ↓
Security scan
  ↓
Permission analysis
  ↓
Compatibility test
  ↓
Approve / reject
  ↓
Version lock
```

## 5.4 Skill upgrades
A newly released version of an approved external skill is treated as a new artefact requiring re-review.

## 5.5 Continuous learning, memory and capability evolution
ECC Continuous Learning v2.1 and Unified Memory are inherited first-class capabilities. The platform shall preserve project-scoped observation/instinct learning, confidence scoring, controlled promotion and evolution into skills/commands/agents, while generalising observation and retrieval across approved harnesses.

Memory and learning remain separate: memory preserves durable facts, handoffs and context; learning derives reusable behaviour from evidence. Learned behaviour must not silently become security policy, production authority or a trusted external skill.

The platform shall progressively expose inherited agent evaluation, eval-harness, verification-loop, browser QA, canary-watch, context-budget, skill-compliance/health, benchmark optimisation, team orchestration, council, enterprise-agent operations, cost tracking and iterative retrieval capabilities rather than replacing them with new implementations without cause.

---

# 6. MCP and Tool Strategy

## 6.1 Controlled registry
The platform shall maintain an approved registry of MCP servers and other tools.

Likely capability categories include:

- GitHub/source control;
- filesystem/code workspace;
- Playwright/browser testing;
- live documentation lookup;
- web research;
- PostgreSQL/database tools;
- Railway/Vercel/Cloudflare infrastructure;
- Jira/Confluence;
- persistent memory;
- observability.

## 6.2 Dynamic loading
The system shall not enable every MCP for every task.

Example:

**Database design task**
- GitHub;
- filesystem;
- PostgreSQL;
- documentation.

**Checkout E2E task**
- GitHub;
- filesystem;
- Playwright;
- test database.

**Deployment task**
- GitHub;
- Railway;
- Cloudflare.

## 6.3 Tool permissions
Each tool shall declare:

- trust level;
- READ/WRITE/EXECUTE/DELETE/DEPLOY capabilities;
- permitted agent roles;
- permitted environments;
- credential requirements;
- project scope;
- data classification.

---

# 7. User Roles

## 7.1 Platform Owner
May configure providers, model/route catalogues, organisation AI connections, security policy, budgets, trusted skills, MCPs and infrastructure integrations.

## 7.2 Product Owner
May create products, conduct product discovery, review requirements and extraction candidates, approve Product Packages, submit changes, monitor builds and approve releases.

## 7.3 Technical Administrator
May manage deployment/integration configuration, investigate execution failures and approve technical exceptions.

## 7.4 Human Engineer / Reviewer
Future and optional role that may participate in code, review and release workflows.

## 7.5 Connection Owner
A user who authenticates a personal AI connection owns that connection's project-sharing scope and may enable, change or revoke eligible sharing subject to organisation policy. Other project members cannot widen that user's sharing scope.

---

# 8. Main Product Areas

## 8.1 Product Studio
Turns an idea into an approved, versioned Product Package.

## 8.2 Engineering Studio
Turns an approved Product Package into tested source code and previews.

## 8.3 Review & QA Studio
Independently evaluates implementation correctness, security and requirement coverage.

## 8.4 Administration / AI Connections
Manages organisation provider configuration and, in the later connection/delegation slice, user-owned AI connections, project sharing, runner status and route availability without exposing provider credentials to collaborators.

## 8.5 Capability & Engineering Administration
Provides Platform, Organisation and Project scoped management of approved agents, skills, MCP/tools, learning/memory policies, model/route assignments and engineering-team defaults. Normal users receive Auto/Recommended behaviour; advanced/admin users may inspect and override eligible capability assignments subject to security policy.

---

# 9. Product Studio Functional Requirements

## PS-001 Create project
The Product Owner shall be able to create a new greenfield project or connect an existing application.

## PS-002 Select Product Partner
The initial Product Studio shall present OpenAI, Claude, Gemini or Auto Select as Product Partner choices. These initial choices shall not impose a closed provider domain; later approved providers/models/routes may be added through the execution-route registry without changing canonical project-state semantics.

## PS-003 Natural-language discovery
The Product Partner shall discuss the business/product before finalising an SRS.

Discovery may cover:

- target customers;
- users/personas;
- business model;
- monetisation;
- capabilities;
- workflows;
- integrations;
- geography;
- regulatory obligations;
- security;
- scale;
- resilience;
- administration;
- analytics;
- support model.

## PS-004 Persistent Product Knowledge
Material facts and decisions from conversations shall be extracted as structured candidates for the project knowledge model.

## PS-004A Review-first AI extraction
AI-extracted requirements, business rules, assumptions, risks, decisions and other product facts shall enter a candidate review queue first. AI extraction alone shall **not** create or modify canonical Product Knowledge. A candidate becomes canonical only after an authorised user explicitly accepts it; rejected candidates remain non-canonical review evidence.

## PS-004B Automatic extraction trigger
After every successful live Product Partner turn, the platform shall automatically attempt to extract structured Product Knowledge candidates. The normal execution path should obtain the conversational answer and candidate set within the same model operation where the selected concrete route explicitly supports the approved structured-output contract. Extraction capability shall not be inferred from provider name. Extraction failure shall not silently promote knowledge or erase an otherwise successful conversation turn.

## PS-005 Knowledge status
Knowledge records shall support at least Proposed, Inferred, Confirmed, Approved, Superseded and Rejected states.

## PS-006 Model/route switching
The Product Owner may switch Product Partner model/provider/eligible route without losing agreed project understanding.

## PS-007 Cross-model challenge
The Product Owner may ask another model to challenge requirements, architecture, business rules or UI/UX.

## PS-008 Document ingestion
Users may upload available source documents including SRS, BRD, UI/UX documents, notes, PDFs, DOCX, text and relevant images.

## PS-009 Gap/contradiction identification
The Product Studio shall identify missing requirements, contradictions, unresolved assumptions and material risks.

## PS-010 Completeness indicator
The Product Studio should provide an advisory completeness view by requirement area without implying mathematical certainty.

---

# 10. Product Knowledge Model

The canonical model shall support at least:

- Product Vision;
- Problem Statement;
- Objectives;
- Stakeholders;
- Personas;
- Business Model;
- Revenue Model;
- Functional Requirements;
- Non-Functional Requirements;
- User Journeys;
- Business Rules;
- Roles and Permissions;
- Data Requirements;
- Integrations;
- Security Requirements;
- Regulatory Requirements;
- Performance Requirements;
- Availability/Resilience Requirements;
- UI Decisions;
- Architecture Decisions;
- Risks;
- Assumptions;
- Dependencies;
- Constraints;
- Open Questions;
- Decisions.

---

# 11. Product Documentation

The system shall generate the appropriate subset of:

### Product artefacts
- Product Vision;
- Product Description;
- Business Requirements Document;
- Software Requirements Specification;
- Functional Requirements;
- Non-Functional Requirements;
- Business Rules Catalogue;
- User Roles and Permissions;
- User Stories;
- Acceptance Criteria.

### UX artefacts
- User Journey Catalogue;
- Information Architecture;
- UI/UX Specification;
- Screen Catalogue;
- Navigation Specification;
- Responsive Behaviour;
- Accessibility Requirements;
- Design System Specification.

### Technical artefacts
- Solution Architecture;
- Application Architecture;
- Data Architecture;
- Database Design;
- API Specification;
- Integration Specification;
- Security Architecture;
- Infrastructure Architecture;
- Deployment Architecture;
- Observability Architecture.

### Delivery artefacts
- Implementation Roadmap;
- Test Strategy;
- Release Strategy;
- Risk Register;
- Assumptions Register;
- Dependency Register.

---

# 12. Product Package and Baselining

## PP-001 Package version
Approved product artefacts shall form a versioned Product Package.

## PP-002 Approval
Material engineering shall require an approved Product Package by default.

## PP-003 Immutable historical baseline
Approval creates a historical baseline. Later edits create a new version rather than rewriting the previous approved state.

## PP-004 Machine-readable package
The Product Package shall exist as structured entities as well as human-readable documents.

---

# 13. Requirement Traceability

Requirements shall receive persistent IDs and support traceability:

```text
Requirement
  ↓
Design Decision
  ↓
Engineering Task
  ↓
Code Revision
  ↓
Test Case
  ↓
Review Finding
  ↓
Release
```

Examples: `AUTH-FR-001`, `AI-CONN-FR-001`, `PAY-FR-014`, `STREAM-NFR-006`.

---

# 14. Change Management

Post-baseline changes shall normally be formal Change Requests.

The Product Studio shall perform impact analysis against:

- requirements;
- screens;
- APIs;
- database;
- security;
- integrations;
- tests;
- release scope.

Approved changes shall create a new Product Package version, e.g. v1.0 → v1.1.

---

# 15. Engineering Studio Requirements

## ENG-001 Task decomposition
The platform shall decompose the approved Product Package into a task graph of epics/features/tasks with dependencies.

## ENG-002 Role assignment
Engineering tasks shall be assigned to logical roles such as Principal Engineer, Backend Engineer, Frontend Engineer, Database Engineer, Test Engineer or Security Engineer.

## ENG-003 Execution independence
A role may be fulfilled by any approved agent/model/provider/harness/route combination whose capabilities and permissions satisfy the task. ECC agent definitions shall not be permanently coupled to one provider or harness.

## ENG-004 Plan before significant change
Material tasks require an implementation plan identifying affected components, tests, migrations, security concerns and rollback implications.

## ENG-005 Test-driven workflow
Where appropriate, engineering shall follow RED → GREEN → REFACTOR with configurable coverage requirements.

## ENG-006 Isolated execution
Engineering must occur in an isolated sandbox/worktree rather than unrestricted execution on the web application host.

## ENG-007 Durable checkpoint
Every material execution shall persist current status, changed files, tests, outstanding work, risks and source revision.

## ENG-008 Handoff
A different model/provider/harness shall be able to resume work from the durable project/task checkpoint without requiring the previous worker's private provider conversation.

---

# 16. Independent Review Requirements

## REV-001 Independent reviewer
Material work shall be reviewed in a fresh context.

## REV-002 Cross-provider preference
Default policy: Engineer Provider != Reviewer Provider where a suitable alternative is available. The orchestrator may additionally use harness/agent separation as policy evidence but provider difference remains the default preference for material independent review.

## REV-003 Reviewer context isolation
Reviewer receives requirements, acceptance criteria, architecture, code/diff, tests and policies, but not unnecessary engineer reasoning/confidence statements.

## REV-004 Severity
Findings: BLOCKER, HIGH, MEDIUM, LOW, OBSERVATION.

## REV-005 Resolution loop
Finding → Engineer Fix → Tests → Reviewer Re-check until accepted, waived or escalated.

## REV-006 High-risk review
Payments, authentication, permissions, financial ledgers, sensitive data, migrations and critical infrastructure may require multiple independent reviewers.

---

# 17. Automated Quality Requirements

Quality gates may include:

- dependency installation;
- build;
- lint;
- type checking;
- unit tests;
- integration tests;
- migration validation;
- secret scanning;
- dependency/security scanning;
- independent AI review;
- E2E/browser testing;
- requirement coverage.

Material tasks cannot be labelled complete while required gates are failing unless a documented waiver exists.

---

# 18. Browser/E2E Requirements

Playwright or equivalent shall validate user journeys against a running preview where appropriate.

Test evidence may include screenshots, video, traces, network failures, console errors and step results.

Acceptance criteria shall be linkable to E2E tests.

---

# 19. Preview Requirements

The Product Owner shall be able to open a working development/staging preview from the platform.

Natural-language preview feedback shall be routed through controlled change analysis rather than being treated as an ungoverned direct coding instruction for significant changes.

---

# 20. Execution Gateway Requirements

The platform shall expose a provider-independent internal interface for:

- provider/model/route identity;
- session creation where applicable;
- message/turn execution;
- structured-output contracts;
- tool attachment;
- file/context attachment;
- cancellation;
- route health/capabilities;
- usage/cost metadata;
- provider/harness session references;
- later connection/runner metadata where applicable.

The gateway shall support multiple routes/models per provider and stable extensible provider identifiers. The presence of OpenAI, Anthropic and Google adapters shall not impose a closed provider type on core domain contracts.

Capabilities shall belong to concrete routes. At minimum the architecture shall be able to represent chat, structured output, tools, files, vision, MCP, local workspace, shell/command execution, headless execution, checkpoint/resume, persistent-runner support, cancellation and usage/quota telemetry where available.

Core platform modules shall not call provider-specific APIs or harness internals directly outside approved adapters.

---

# 21. Execution Modes

The platform shall support:

1. **Personal Subscription** — use an eligible user-owned provider/harness entitlement where officially supported and authorised for the task/project.
2. **Organisation Subscription/Enterprise** — use eligible organisation-owned capacity according to policy.
3. **API** — use provider API execution with separate metered/credit classification.
4. **Hybrid / Auto** — select among eligible personal, project-contributed, organisation and API routes according to capability, availability, risk, review and cost policy.
5. **Manual/Interactive Handoff** — prepare a portable package where programmatic execution is unavailable.

Personal subscription execution shall not mean scraping a consumer chat application or transferring another user's login credentials.

---

# 22. Subscription and API Cost Governance

The platform shall support:

- organisation monthly API budget;
- project budget;
- provider budget;
- per-task approval threshold;
- subscription-first preference where eligible;
- requester's-own-route-first policy under ordinary collaborator-initiated work;
- eligible project-contributed connection pool;
- organisation subscription/enterprise fallback;
- "switch provider before API" policy;
- "ask before paid API" policy;
- connection-owner usage contribution limits where enforceable;
- usage classification into subscription-included, separate credits, API metered, infrastructure and external-tool spend.

The system shall never assume ordinary consumer chat subscription usage is equivalent to API billing or claim a precise remaining subscription percentage unless the provider exposes sufficient telemetry.

---

# 23. Context Management

For each task, the platform shall construct a bounded context using only relevant:

- requirements;
- architecture;
- decisions;
- source code;
- previous findings;
- skills;
- tool definitions.

Context exhaustion is an expected runtime condition. The system shall checkpoint and resume rather than lose work.

A provider/harness session is not the canonical memory layer. Switching or losing an execution route shall rebuild context from platform-owned project/task state and repository evidence.

---

# 24. GitHub Requirements

GitHub shall normally be hidden behind the product interface.

The platform shall eventually manage:

- repository creation/import;
- branches/worktrees;
- commits;
- pull requests;
- statuses;
- review comments;
- CI;
- releases/tags.

Product Owners shall not be required to operate Git directly.

---

# 25. Existing Application Support

For existing applications, the platform shall analyse the repository and supplied documentation before making material changes.

Where documentation is incomplete, the system may reconstruct:

- architecture map;
- API catalogue;
- database overview;
- inferred business rules;
- technical-debt summary.

Inferred facts must remain labelled as inferred until confirmed.

---

# 26. Security Requirements

The platform shall implement:

- encrypted secret storage;
- least privilege;
- organisation/project isolation;
- sandboxed execution;
- skill provenance/scanning;
- MCP permission controls;
- secret detection;
- dependency scanning;
- audit logging;
- production deployment gates;
- prompt-injection-aware data boundaries;
- user ownership of personal AI connections;
- explicit project-scoped delegation rather than credential sharing;
- separate scoped/revocable runner credentials for Agent Bridge processes;
- immediate connection/share revocation for new executions;
- organisation policy able to restrict personal AI use without silently enabling sharing.

External text, repository content, web pages, tool output and uploaded documents are data by default, not trusted platform instructions.

Provider credentials, refresh tokens and personal provider session material shall never be written into Product Knowledge, conversations, audit metadata, task prompts or repository files, and shall never be exposed to collaborators.

---

# 27. Agent Permission Separation

Example default permissions:

**Engineer**
- read/write approved workspace;
- run tests/build;
- use only orchestrator-authorised model/harness/tool routes;
- no unrestricted production deployment.

**Reviewer**
- read source/diff;
- run tests;
- create findings;
- use only reviewer-authorised routes/tools;
- no deployment authority.

**Deployment Agent**
- deploy an already approved revision only;
- cannot rewrite engineering scope.

A shared AI connection does not grant a project member any additional product/project permission beyond their existing role.

---

# 28. Audit Requirements

The system shall append audit events for:

- Product Package approvals;
- requirement changes;
- model/agent assignments;
- provider/execution route changes;
- skill installations/upgrades;
- MCP activation;
- tool writes;
- code revisions;
- review findings and waivers;
- releases;
- production deployment;
- AI connection registration/disconnection/revocation;
- project share enabled/mode changed/revoked;
- material runner trust/capability changes;
- contributed-route execution selection/fallback/failure;
- usage-limit or policy blocks.

Audit metadata shall use safe identifiers and shall never contain provider credentials or hidden model reasoning.

---

# 29. Dashboard Requirements

## Main dashboard
Show projects, lifecycle stage, progress, current Engineer, Reviewer, blockers, build/test/review/deployment status and cost information.

## Project dashboard
Provide Product, Requirements, Documents, Engineering, Review, QA, Preview, Changes, Deployment and Chat areas.

## Project chat
Questions such as "Why has payment not completed?" must be answered from durable project/task state rather than guessed from conversation context.

## AI connection status
When the connection/delegation slice is implemented, authorised users shall be able to distinguish private, shared Online Only, shared Persistent, runner-offline, quota/rate-limited, re-authentication-required and revoked/disabled connection states without seeing another user's provider secrets.

---

# 30. Build Modes

## Supervised
Stop for Product Package, material architecture changes, significant change requests, security waivers and production release.

## Assisted Autopilot
Proceed through low-risk work automatically; stop for ambiguity, credentials, repeated failures, security failure, significant paid API use or production approval.

## Advanced Autopilot
Future policy-controlled mode with broader autonomous authority.

---

# 31. Stop Conditions

Agents/orchestration must stop or safely reroute/escalate when:

- requirements materially conflict;
- required secrets are unavailable;
- required tool permission is denied;
- security policy fails;
- migrations exceed permitted risk;
- required tests repeatedly fail;
- cost/usage policy is reached;
- provider/model/route/harness/runner is unavailable and no safe fallback exists;
- a contributed personal route is not delegatable under provider/account/harness policy;
- production approval is required.

---

# 32. Data and Storage Requirements

The platform shall maintain, as required by the active delivery slice:

- relational project state;
- Product Knowledge and revisions;
- extraction runs and non-canonical knowledge candidates;
- requirements;
- documents and versions;
- conversations/messages;
- provider/model/route executions and usage evidence;
- task checkpoints;
- skills and tool registry;
- review findings;
- tests;
- cost events;
- audit events;
- later personal/organisation AI connection records;
- later project connection-sharing records;
- later authorised runner/Agent Bridge records;
- later common execution evidence linking requester, route, agent/harness and outcome without exposing secrets.

Large artefacts shall use object storage rather than being embedded directly in relational rows.

---

# 33. Non-Functional Requirements

## NFR-001 Security
Least privilege, credential isolation and tenant/project isolation are mandatory.

## NFR-002 Maintainability
Provider, model, route, harness, connection, skill, MCP and sandbox integrations shall use modular interfaces.

## NFR-003 Portability
No core workflow shall require one cloud, LLM, harness or deployment vendor.

## NFR-004 Observability
Task state, errors, route selection, provider/model/harness execution, tool actions, tests and deployments shall be observable at an appropriate product level.

## NFR-005 Scalability
Architecture shall support multiple projects and concurrent jobs while preserving project isolation.

## NFR-006 Resilience
Provider limits, context limits, route outages, runner loss, user sign-out and session loss must not corrupt canonical project state.

## NFR-007 Explainability at product level
The Product Owner must be able to understand what is happening without needing private chain-of-thought or low-level terminal output.

---

# 34. V1 Scope

V1 shall prove the Product Studio and model-independent project-memory concept while ensuring the execution contracts do not create a future three-provider/harness dead end.

Required V1 outcomes:

- private ECC derivative repository established;
- upstream baseline/provenance recorded;
- project creation;
- Product Partner conversation abstraction;
- extensible provider-independent execution gateway contract;
- multiple route IDs/models per provider supported by core contracts;
- explicit structured-output route capability;
- current OpenAI/Anthropic/Google API adapters retained as initial metered routes;
- canonical Product Knowledge Store;
- review-first automatic Product Knowledge extraction and candidate queue;
- Product Owner candidate review/promotion/rejection with audit;
- document upload metadata/storage contract;
- Product Package generation/versioning;
- model/route switching without loss of canonical project state;
- initial skill registry based on ECC;
- initial MCP registry;
- audit trail;
- provider route/cost metadata;
- real User ID/password authentication with no email requirement;
- one-time invitation-key onboarding with configurable expiry and 30-minute default;
- organisation/project memberships and roles;
- session revocation, account suspension and project-specific access removal;
- People & Access administration.

Full personal connection administration, Agent Bridge, subscription harness adapters and autonomous engineering are not required to complete the immediate V1 extraction slice.

---

# 35. V2 Scope

Engineering Studio:

- GitHub project repository creation/import;
- task graph;
- approved ECC agent/skill enumeration through the private ECC adapter;
- agent definitions selected independently of provider/model/harness;
- worktrees;
- secure execution sandbox;
- TDD/build/test;
- durable checkpoints;
- preview deployment.

---

# 36. V3 Scope

Review & QA:

- independent reviewer routing;
- review isolation;
- findings/fix/re-review;
- Playwright E2E;
- security review;
- requirement traceability gates;
- provider/route/harness evidence sufficient to demonstrate configured review independence.

---

# 37. V4 Scope

Subscription-first and shared-entitlement orchestration:

- personal and organisation AI connection administration;
- provider subscription connectors supported by official mechanisms;
- Do Not Share / Online Only / Persistent project-sharing modes;
- orchestrator-controlled project execution pools;
- connection-owner usage limits where enforceable;
- provider/account/harness delegation-eligibility rules;
- local or managed Agent Bridge where needed;
- runner registration, scoped authentication, health and revocation;
- Codex, Claude Code, Antigravity and other supported harness adapters incrementally;
- provider/model/route/harness capability registry;
- quota/availability-aware routing;
- organisation and API fallback policy;
- automated provider/model/harness handoff from durable project/task state.

---

# 38. V5 Scope

Capability intelligence:

- OneSkill discovery;
- quarantine and external-skill review;
- automated compatibility/security evaluation;
- dynamic MCP selection;
- project-specific skill generation;
- controlled cross-project learning/promotion;
- more advanced policy scoring across agents, models, harnesses, connection pools and cost/performance evidence.

---

# 39. Core Acceptance Scenario

The target architecture must eventually demonstrate:

1. Product Owner creates a project.
2. Selects OpenAI as Product Partner.
3. Discusses an idea.
4. Platform persists the successful conversation and produces non-canonical Product Knowledge candidates through an eligible structured-output route.
5. Product Owner accepts selected candidates into canonical Product Knowledge.
6. Product Owner switches to Claude.
7. Claude receives canonical project context and challenges requirements without relying on the previous provider session.
8. Gemini/Antigravity contributes UI/UX analysis through an eligible route/harness.
9. Platform generates Product Package v1.0.
10. Product Owner approves it.
11. An approved ECC engineering agent is assigned independently of provider/harness.
12. The orchestrator selects an eligible engineering route and isolated worktree/sandbox.
13. Durable checkpoint is recorded.
14. An independent reviewer route is selected according to policy.
15. Reviewer finds a defect.
16. Engineer fixes it and adds/updates tests.
17. Reviewer re-checks.
18. Automated tests and E2E pass.
19. Product Owner opens live preview.
20. Product Owner approves production release.
21. A collaborator may continue the project after another collaborator signs out because canonical state is project-owned.
22. Where later subscription sharing is enabled, a collaborator's own eligible connection is preferred before eligible contributed project capacity under ordinary routing policy.
23. Revoking a contributed personal connection blocks new use without deleting historical project evidence.
24. All material decisions, execution routes and evidence are auditable without exposing provider credentials.

---

# 40. Authentication & Collaboration Requirements

## AUTH-FR-001 Login identity
The platform shall support permanent sign-in using a unique **User ID + password**. Email shall not be required for V1 account creation, authentication or normal use.

## AUTH-FR-002 One-time invitation onboarding
New users shall be onboarded using an administrator-generated high-entropy invitation key. The key shall be single-use and shall not be accepted after successful redemption.

## AUTH-FR-003 Configurable invitation expiry
Invitation expiry shall be configurable by organisation policy. The default shall be **30 minutes**. An authorised administrator may override the period for an individual invitation. The absolute expiry timestamp shall be captured when the invitation is issued.

## AUTH-FR-004 Secret storage
The platform shall store only cryptographic hashes of invitation keys and authentication-session tokens. Passwords shall be stored only as memory-hard password verifiers. Plaintext passwords, invitation keys and session tokens shall not be written to audit metadata or application logs.

## AUTH-FR-005 Invitation lifecycle
Invitation states shall include pending, consumed, expired, revoked and replaced. Expired, consumed, revoked and replaced invitations shall be permanently unusable. Replacing an invitation shall invalidate the previous outstanding key before a new key is issued.

## AUTH-FR-006 Organisation roles
Organisation roles shall include `owner`, `admin` and `member`. Owner/Admin privileges shall govern organisation-level administration, provider/security configuration and access management.

## AUTH-FR-007 Project roles
Project roles shall include `product_owner`, `contributor`, `engineer`, `reviewer` and `viewer`. Project access shall be explicit and separable from organisation membership.

## AUTH-FR-008 Immediate revocation
Authorised administrators shall be able to suspend a user, revoke organisation membership, revoke or change access to an individual project, cancel a pending invitation and invalidate active sessions. Protected requests shall re-evaluate current account/session/membership state so revocation takes effect immediately.

## AUTH-FR-009 Auditability
Invitation creation/redemption/cancellation/expiry, login/logout, account suspension/reactivation, organisation membership changes, project membership changes and session revocation shall produce append-only audit evidence without exposing authentication secrets.

## AUTH-FR-010 Multiple products and discovery sessions
A user may belong to multiple projects subject to access control. Each project shall retain independent Product Knowledge, documents, requirements, conversations and engineering state. A project may contain multiple product-discovery conversations that share the same project-owned canonical Product Knowledge.

## AUTH-FR-011 Collaboration survives sign-out
Signing out of the web application shall terminate the user's web session but shall not delete project state, conversations, canonical Product Knowledge, task/checkpoint state or other collaborators' project access.

---

# 41. AI Connection & Shared Entitlement Requirements

These requirements apply to the approved connection/delegation architecture. Their full implementation is phased after the immediate routing-foundation and review-first extraction work.

## AI-CONN-FR-001 Separate connection ownership
An AI connection shall be owned by either one user (`personal`) or the organisation. A personal connection shall not become project- or organisation-owned merely because it is used for collaborative work.

## AI-CONN-FR-002 Do Not Share default
A newly connected personal AI entitlement shall default to **Do Not Share**. Connecting an account shall never automatically contribute personal capacity to a project or organisation.

## AI-CONN-FR-003 Online Only sharing default
When the connection owner explicitly shares an eligible personal connection with a project, the default sharing mode shall be **Online Only**. The route is eligible only while the owner has active AI Engineering OS presence and the required authorised runner is online.

## AI-CONN-FR-004 Persistent sharing
The owner may explicitly change a project share to **Persistent**. Persistent sharing may remain eligible after the owner signs out only while a suitable authorised persistent runner remains reachable and provider/account/harness policy permits the execution.

## AI-CONN-FR-005 Project scope
Personal sharing shall be project-scoped. Sharing with one project shall not implicitly share with another project or the entire organisation.

## AI-CONN-FR-006 Automatic collaborator benefit
Once an eligible connection is explicitly shared with a project, authorised collaborators may benefit from it automatically through the orchestrator without per-collaborator connection approval, subject to their project role and all connection/provider/policy gates.

## AI-CONN-FR-007 No credential sharing
A collaborator shall never receive another user's provider password, token, cookie, refresh token or provider session material. Shared capacity is consumed through an authorised execution route controlled by the orchestrator.

## AI-CONN-FR-008 Provider/account/harness eligibility
User consent to share capacity is necessary but not sufficient. A personal connection may enter the executable project pool only where the provider, account type, harness and applicable terms technically and contractually permit delegated execution.

## AI-CONN-FR-009 Personal route preference
For ordinary collaborator-initiated work, the requesting user's own eligible route shall be preferred before eligible contributed project routes, unless risk, review-independence, capability or explicit routing policy requires another route.

## AI-CONN-FR-010 Shared project pool selection
When multiple collaborators contribute eligible connections, the orchestrator shall select from the project pool by capability, route health, provider/harness suitability, allowance/quota signals, cost/risk and policy. It shall not automatically consume the project owner's entitlement first.

## AI-CONN-FR-011 Organisation/API fallback
Eligible organisation subscription/enterprise routes and approved API routes shall remain separate fallback tiers rather than being conflated with personal contributed capacity.

## AI-CONN-FR-012 Usage contribution controls
A connection owner may constrain contributed capacity using enforceable limits such as task/execution counts, time windows, project scopes or provider-reported quota signals. The platform shall not claim a precise percentage of remaining allowance where the provider does not expose sufficient telemetry.

## AI-CONN-FR-013 Revocation
Changing a project share to Do Not Share or otherwise revoking delegation shall block new project executions through that connection immediately. Revocation shall not delete historical outputs, checkpoints, Product Knowledge, conversations, repository revisions, usage records or audit evidence.

## AI-CONN-FR-014 Runner separation
Where a subscription-backed route requires a local or managed harness, provider authentication shall remain on the authorised runner where practical. Runner authentication to AI Engineering OS shall use separate scoped/revocable credentials and shall expose only safe capability/health metadata.

## AI-CONN-FR-015 Persistent project memory
A project shall remain continuable by other authorised collaborators when a connection owner signs out, disconnects, goes offline, exhausts quota or leaves the project. A replacement worker shall resume from platform-owned context, repository/task state and durable checkpoints rather than requiring the unavailable provider session.

## AI-CONN-FR-016 Master orchestration
Contributed AI capacity shall be made available to the AI Engineering OS orchestrator, not directly controlled as another user's provider account by collaborators. The orchestrator shall enforce project RBAC, capability, cost, risk, owner limit and independent-review policy before use.

## AI-CONN-FR-017 Material auditability
Connection registration/revocation, project sharing/mode changes, material runner trust/capability changes, contributed-route use, routing fallback and usage/policy blocks shall be auditable using safe identifiers without exposing provider credentials.

---

# 42. Final Product Definition

The AI Product & Engineering Operating System is a **private, provider/model/harness-independent, AI-native product and software engineering platform** built around an updateable ECC engineering substrate.

- ECC provides much of the engineering process, agent and skill foundation.
- Curated OneSkill additions expand capability only after review.
- MCPs provide controlled access to external systems.
- An extensible provider/model/route registry supplies interchangeable intelligence and execution capacity.
- Codex, Claude Code, Antigravity, Hermes, OpenCode and future harnesses are replaceable execution surfaces where supported, not canonical project-memory owners.
- Personal AI connections remain user-owned and may contribute eligible project capacity only through explicit governed sharing.
- Organisation AI connections and APIs remain separate governed resources.
- The Orchestrator manages the lifecycle and route selection.
- The Product Knowledge Store owns governed understanding.
- GitHub owns software source history.
- Sandboxes/worktrees execute engineering work safely.
- Independent agents review material changes.
- Automated QA verifies behaviour.
- The Product Owner works through conversations, documents, previews and approvals.

**The platform owns state. Agents do work.**
