# AI Product & Engineering Operating System
## Product Requirements & Software Requirements Specification

**Document version:** 1.1  
**Status:** Approved baseline for V1 planning  
**Date:** 9 August 2026  
**Working name:** AI Engineering OS  
**Parent initiative:** Private AI-native product and software engineering platform

## 0. Change record

### Version 1.1
This revision incorporates the decisions made after the original v1.0 requirements discussion:

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

The platform shall support multiple AI providers including OpenAI, Anthropic and Google. Models shall be assignable to roles rather than permanently tied to roles.

Examples:

- ChatGPT/OpenAI Product Partner → Claude Engineer → OpenAI Reviewer.
- Claude Product Partner → OpenAI Engineer → Claude Reviewer.
- Gemini/Antigravity UI specialist → Claude engineering reviewer.
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
No project shall depend on one long ChatGPT, Claude, Gemini or Codex conversation remaining available.

## 3.3 Models are workers, not the source of truth
The canonical Product Knowledge Store, approved Product Package, repository and task state belong to the platform.

## 3.4 Provider independence
Core business workflows shall not assume that Claude always engineers, Codex always handles backend work, or Gemini always handles frontend work.

## 3.5 Independent review
An Engineer shall not be able to silently mark its own material work as independently approved.

## 3.6 Subscription-first execution
Where officially supported, existing user subscription entitlements should be preferred before separately metered API execution.

## 3.7 No provider restriction bypass
The system shall not imitate private browser sessions, scrape consumer chat applications or otherwise bypass provider terms to turn consumer subscriptions into unofficial APIs.

## 3.8 Context efficiency
Only task-relevant documents, code, skills and MCP tools should be loaded into an agent context.

## 3.9 Least privilege
Agents receive only the capabilities and credentials required for a task.

## 3.10 Human approval at consequential gates
Product baselines, security waivers, significant paid API use and production deployments require policy-controlled human approval by default.

---

# 4. Open-Source Foundation Strategy

## 4.1 ECC foundation
The solution shall use the official ECC project (`affaan-m/ECC`) as the engineering-methodology and agent-harness foundation.

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
May configure providers, security policy, budgets, trusted skills, MCPs and infrastructure integrations.

## 7.2 Product Owner
May create products, conduct product discovery, review requirements, approve Product Packages, submit changes, monitor builds and approve releases.

## 7.3 Technical Administrator
May manage deployment/integration configuration, investigate execution failures and approve technical exceptions.

## 7.4 Human Engineer / Reviewer
Future and optional role that may participate in code, review and release workflows.

---

# 8. Main Product Areas

## 8.1 Product Studio
Turns an idea into an approved, versioned Product Package.

## 8.2 Engineering Studio
Turns an approved Product Package into tested source code and previews.

## 8.3 Review & QA Studio
Independently evaluates implementation correctness, security and requirement coverage.

---

# 9. Product Studio Functional Requirements

## PS-001 Create project
The Product Owner shall be able to create a new greenfield project or connect an existing application.

## PS-002 Select Product Partner
The Product Owner shall be able to select OpenAI, Claude, Gemini or Auto Select as the Product Partner.

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
Material facts and decisions from conversations shall be extracted into a canonical knowledge model.

## PS-005 Knowledge status
Knowledge records shall support at least Proposed, Inferred, Confirmed, Approved, Superseded and Rejected states.

## PS-006 Model switching
The Product Owner may switch Product Partner without losing agreed project understanding.

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

Examples: `AUTH-FR-001`, `PAY-FR-014`, `STREAM-NFR-006`.

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

## ENG-003 Provider independence
A role may be fulfilled by any provider route whose capabilities satisfy the task.

## ENG-004 Plan before significant change
Material tasks require an implementation plan identifying affected components, tests, migrations, security concerns and rollback implications.

## ENG-005 Test-driven workflow
Where appropriate, engineering shall follow RED → GREEN → REFACTOR with configurable coverage requirements.

## ENG-006 Isolated execution
Engineering must occur in an isolated sandbox/worktree rather than unrestricted execution on the web application host.

## ENG-007 Durable checkpoint
Every material execution shall persist current status, changed files, tests, outstanding work, risks and source revision.

## ENG-008 Handoff
A different model/provider shall be able to resume work from the durable project/task checkpoint.

---

# 16. Independent Review Requirements

## REV-001 Independent reviewer
Material work shall be reviewed in a fresh context.

## REV-002 Cross-provider preference
Default policy: Engineer Provider != Reviewer Provider where a suitable alternative is available.

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

# 20. Model Gateway Requirements

The platform shall expose a provider-independent internal interface for:

- session creation;
- message/turn execution;
- tool attachment;
- file/context attachment;
- cancellation;
- health/capabilities;
- usage/cost metadata;
- provider session references.

Core platform modules shall not call provider-specific APIs directly outside provider adapters.

---

# 21. Execution Modes

The platform shall support:

1. **Subscription First** — use officially supported subscription-backed execution where possible.
2. **API** — use provider API execution.
3. **Hybrid** — subscription first, alternate subscription second, API fallback subject to policy.
4. **Manual/Interactive Handoff** — prepare a portable package for interactive work where programmatic subscription execution is unavailable.

---

# 22. Subscription and API Cost Governance

The platform shall support:

- organisation monthly API budget;
- project budget;
- provider budget;
- per-task approval threshold;
- "switch provider before API" policy;
- "ask before paid API" policy;
- usage classification into subscription-included, separate credits, API metered, infrastructure and external-tool spend.

The system shall never assume ordinary consumer chat subscription usage is equivalent to API billing.

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
- prompt-injection-aware data boundaries.

External text, repository content, web pages, tool output and uploaded documents are data by default, not trusted platform instructions.

---

# 27. Agent Permission Separation

Example default permissions:

**Engineer**
- read/write approved workspace;
- run tests/build;
- no unrestricted production deployment.

**Reviewer**
- read source/diff;
- run tests;
- create findings;
- no deployment authority.

**Deployment Agent**
- deploy an already approved revision only;
- cannot rewrite engineering scope.

---

# 28. Audit Requirements

The system shall append audit events for:

- Product Package approvals;
- requirement changes;
- model assignments;
- provider route changes;
- skill installations/upgrades;
- MCP activation;
- tool writes;
- code revisions;
- review findings and waivers;
- releases;
- production deployment.

---

# 29. Dashboard Requirements

## Main dashboard
Show projects, lifecycle stage, progress, current Engineer, Reviewer, blockers, build/test/review/deployment status and cost information.

## Project dashboard
Provide Product, Requirements, Documents, Engineering, Review, QA, Preview, Changes, Deployment and Chat areas.

## Project chat
Questions such as "Why has payment not completed?" must be answered from durable project/task state rather than guessed from conversation context.

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

Agents must stop/escalate when:

- requirements materially conflict;
- required secrets are unavailable;
- required tool permission is denied;
- security policy fails;
- migrations exceed permitted risk;
- required tests repeatedly fail;
- cost policy is reached;
- provider/tool is unavailable and no safe fallback exists;
- production approval is required.

---

# 32. Data and Storage Requirements

The platform shall maintain:

- relational project state;
- product knowledge;
- requirements;
- documents and versions;
- provider sessions and executions;
- task checkpoints;
- skills and tool registry;
- review findings;
- tests;
- cost events;
- audit events.

Large artefacts shall use object storage rather than being embedded directly in relational rows.

---

# 33. Non-Functional Requirements

## NFR-001 Security
Least privilege and tenant isolation are mandatory.

## NFR-002 Maintainability
Provider, skill, MCP and sandbox integrations shall use modular interfaces.

## NFR-003 Portability
No core workflow shall require one cloud, LLM or deployment vendor.

## NFR-004 Observability
Task state, errors, provider calls, tool actions, tests and deployments shall be observable.

## NFR-005 Scalability
Architecture shall support multiple projects and concurrent jobs while preserving project isolation.

## NFR-006 Resilience
Provider limits, context limits, outages and session loss must not corrupt canonical project state.

## NFR-007 Explainability at product level
The Product Owner must be able to understand what is happening without needing private chain-of-thought or low-level terminal output.

---

# 34. V1 Scope

V1 shall prove the Product Studio and model-independent project-memory concept.

Required V1 outcomes:

- private ECC derivative repository established;
- upstream baseline/provenance recorded;
- project creation;
- Product Partner conversation abstraction;
- provider-independent model gateway contract;
- canonical Product Knowledge Store;
- document upload metadata/storage contract;
- requirements/knowledge extraction pipeline;
- Product Package generation/versioning;
- model switching without loss of canonical project state;
- initial skill registry based on ECC;
- initial MCP registry;
- audit trail;
- provider route/cost metadata.

Full autonomous engineering is not required to prove V1.

---

# 35. V2 Scope

Engineering Studio:

- GitHub project repository creation/import;
- task graph;
- ECC-backed engineering roles;
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
- requirement traceability gates.

---

# 37. V4 Scope

Subscription-first orchestration:

- provider subscription connectors supported by official mechanisms;
- local Agent Bridge where needed;
- provider capability registry;
- quota/availability-aware routing;
- API fallback policy;
- automated provider handoff.

---

# 38. V5 Scope

Capability intelligence:

- OneSkill discovery;
- quarantine and external-skill review;
- automated compatibility/security evaluation;
- dynamic MCP selection;
- project-specific skill generation;
- controlled cross-project learning/promotion.

---

# 39. Core Acceptance Scenario

The target architecture must eventually demonstrate:

1. Product Owner creates a project.
2. Selects OpenAI as Product Partner.
3. Discusses an idea.
4. Platform persists product knowledge outside raw chat history.
5. Product Owner switches to Claude.
6. Claude receives the canonical project context and challenges requirements.
7. Gemini/Antigravity contributes UI/UX analysis.
8. Platform generates Product Package v1.0.
9. Product Owner approves it.
10. Claude is assigned Engineer.
11. Claude implements a feature in an isolated worktree/sandbox.
12. Durable checkpoint is recorded.
13. OpenAI independently reviews the change.
14. Reviewer finds a defect.
15. Engineer fixes it and adds/updates tests.
16. Reviewer re-checks.
17. Automated tests and E2E pass.
18. Product Owner opens live preview.
19. Product Owner approves production release.
20. All material decisions and evidence are auditable.

---

# 40. Final Product Definition

The AI Product & Engineering Operating System is a **private, model-independent, AI-native product and software engineering platform** built around an updateable ECC engineering substrate.

- ECC provides much of the engineering process, agent and skill foundation.
- Curated OneSkill additions expand capability only after review.
- MCPs provide controlled access to external systems.
- OpenAI, Claude and Gemini/Antigravity provide interchangeable model intelligence.
- The Orchestrator manages the lifecycle.
- The Product Knowledge Store owns understanding.
- GitHub owns software source history.
- Sandboxes execute engineering work safely.
- Independent agents review material changes.
- Automated QA verifies behaviour.
- The Product Owner works through conversations, documents, previews and approvals.

**The platform owns state. Agents do work.**
