# AI Engineering OS â€” Extensibility & Commercialisation Foundation

**Status:** Authoritative current-build architectural addendum
**Date:** 20 August 2026
**Applies to:** AI Engineering OS current architecture and Task-9 acceptance reconciliation
**Relationship to future SRS:** This document establishes extension seams only. A later full-scale extension SRS may elaborate future products without weakening these invariants.

## 1. Purpose

AI Engineering OS remains first and foremost a best-in-class software-engineering operating environment. The current build must not be paused, genericised, or diluted in order to build unrelated domains, billing products, white-label administration, or customer-cloud infrastructure.

At the same time, current architectural boundaries must avoid expensive future rewrites. The platform shall therefore preserve a domain-neutral work/orchestration foundation underneath the deeply specialised Engineering environment.

The target is:

```text
AI Work Platform / reusable core
        â†“
AI Engineering OS â€” flagship and deepest domain
        â†“
future additive Domain Packs / Operating Environments
```

Generality comes from the platform underneath Engineering, never by weakening Engineering itself.
## 2. Engineering remains first-class

Engineering-specific concepts remain dedicated product capability, including repositories, branches, worktrees, commits, diffs, TDD, CI/build/test, code intelligence, dependency/architecture analysis, exact-source/SHA evidence, security/race/performance testing, engineering councils, deployment, release and rollback.

Do not refactor these into generic abstractions merely to make future extension appear elegant.

Reusable platform concepts may include Project, Workspace, Agent, Task, Artifact, Evidence, Claim, Decision, Review, Approval, Tool, Execution, Memory, Policy and Capability. Engineering specialises those concepts where useful while retaining its own rich domain model.

## 3. Platform invariants

The following are non-negotiable:

1. **Agents do work. Platform owns state.** Canonical identity, project state, memory, authority, evidence and audit remain platform-owned.
2. **Harness = HOW; Environment = WHERE.** Neither selector grants authority to the other.
3. **Execution dimensions are independently governed.** Agent, model/route, harness, connection/credential owner, runner, environment, skills/tools, operation grants and entitlement/budget compose only after independent eligibility checks.
4. **Explicit selection is exact.** `Auto` may rank eligible routes; an explicit eligible route must be used exactly or execution fails closed. No hidden fallback to Auto.
5. **Extensions may extend capability, not redefine authority.** Domain Packs, harnesses, providers, environments, connectors and tenant configuration cannot bypass platform identity, tenancy, audit, entitlement, credential ownership, evidence/provenance or canonical-state rules.
6. **One maintained codebase.** White-labeling and commercial variation are configuration/policy driven, not customer-specific branches or forks.
## 4. Domain Pack extension boundary

Future domains shall be additive, versioned operating modules rather than cloned products. The minimal extension contract should be capable of declaring:

- stable pack ID, version and publisher/source;
- lifecycle/governance status;
- contributed capabilities and specialist agent roles;
- workflow/gate types;
- artifact and evidence types;
- review/adjudication policies;
- required tools/connectors;
- execution requirements;
- schema contributions;
- bounded UI extension metadata.

The existing Capability Estate is the governance authority for extension contributions. A future Domain Pack must flow through the same discovery â†’ approval â†’ release â†’ entitlement/eligibility â†’ technical/operation/environment authority chain as native capabilities.

The Engineering environment is the reference implementation, but it must not be reduced to a JSON-only configuration pack. Its implementation may remain large, opinionated and Engineering-specific.

No Scientific Research, Legal, Strategy, Data or other new Domain Pack is required in the current build.
## 5. Credential and execution ownership

Commercial execution must not assume platform-owned credentials or platform-funded inference.

Extend the existing AI Connection/secret-reference architecture rather than creating a parallel credential subsystem. The durable model must be able to identify an execution credential/connection owner such as:

- platform;
- organisation;
- team, when a real team authority substrate requires it;
- user.

Secrets remain in approved secret/connection storage. Normal domain records store safe references, ownership, provider identity, policy and entitlement/billing attribution, never raw provider credentials.

Resolution is conceptually:

```text
requested capability
â†’ organisation/project/user policy
â†’ eligible provider/route
â†’ eligible connection and credential owner
â†’ entitlement/budget
â†’ runner/environment eligibility
â†’ execute
```

This is the foundation for BYOK, organisation-owned provider accounts, shared subscription capacity and customer-funded execution.

### 5.1 Provider-neutral model connections and discovery

OpenRouter is one provider family, not the architectural centre. AIOS must preserve a provider-neutral connection adapter seam so native vendors, multi-model aggregators, OpenAI-compatible endpoints, cloud gateways and private/enterprise model gateways can participate without a new credential or routing subsystem.

The Task-9 foundation must support: connection validation/authentication; provider model discovery or explicit catalogue reconciliation where supported; independent capability/availability representation; creation/reconciliation of connection-scoped candidate model routes; and preservation of provider + model + connection owner/reference in execution identity/evidence. The same logical model exposed through two providers/connections is two distinct routes.

Discovery is never release authority. Discovered routes flow through Capability Estate governance, release, eligibility, technical verification and operation authority before becoming selectable. Protocol compatibility must not imply unsupported capabilities such as tools, structured output, vision or files.

**Required now (B):** provider-neutral adapter seam, connection-scoped route identity/reconciliation, one proven/reference discovery path and exact-route/fail-closed semantics across owned connections.

**Explicitly deferred (C):** bespoke adapters for every provider, full provider marketplace/catalogue UX, comprehensive price-normalisation/FinOps, and enterprise procurement administration.

## 6. Execution attribution and usage envelope

Every material execution should be attributable without reconstructing meaning from logs later. The durable execution/evidence model must be able to carry, where applicable:

- actor/requester;
- organisation and project;
- task/workstream/session;
- selected agent;
- capability;
- model and exact route;
- harness;
- connection and credential-owner class/reference;
- runner;
- execution environment/provider;
- entitlement/budget reference;
- usage class and metered units;
- cost/cost-reference where known;
- outcome/checkpoint/evidence references.

The current build needs the attribution envelope and durable semantics only where absence would cause future data loss or breaking migration. It does **not** need billing screens, invoices, FinOps dashboards, plan catalogues or cost-centre UI.

## 7. Control plane and execution plane

AI Engineering OS shall preserve an explicit control/state plane separate from potentially expensive execution resources.
Control/state plane responsibilities include identity, tenancy, RBAC, projects, capability governance, orchestration, canonical memory, councils, evidence, audit, policy, entitlements, usage attribution, Studio/Admin and durable workflow state.

Execution-plane resources include model inference, harness processes, runners, sandboxes, builds/tests, browsers, GPU/CPU jobs and future specialist compute.

Execution resources may be platform-managed, customer-owned, BYOK/BYOC, private, dedicated or hybrid without becoming separate sources of canonical project authority.

## 8. Execution environment provider model

The generic `ExecutionEnvironmentProvider` boundary and secure Local provider are already implemented and accepted. Local is the current/default environment.

The concrete production-grade `OpenSandboxProvider` adapter/POC remains pending. OpenSandbox is the approved first additional managed-provider concept, not a replacement for Local or for AIOS orchestration.

Future eligible providers may include customer AWS/Azure/GCP, Kubernetes, private cloud, sovereign/on-prem workers or other managed sandboxes implementing the environment contract.

Environment selection is independently governed. Selecting a harness does not select/grant an environment, and selecting an environment does not grant a harness, runner, credential, model or operation.

## 9. Native AIOS Harness status

AIOS already owns the orchestration, runner, environment and harness-abstraction substrate and has governed Codex, Claude Code and Antigravity adapters.

The richer first-party **AIOS Native Harness** remains a roadmap capability. It must not be marked complete merely because the abstraction/runner layer exists. When implemented it joins, rather than replaces, the governed harness estate.
## 10. Tenancy and commercial configuration

`Organisation` remains the current commercial/security tenant boundary. Do not introduce a speculative parent `Tenant`/Enterprise entity until a real requirement exists for one customer to own multiple independently administered organisations.

A future enterprise parent can be added above Organisation without redefining organisation-scoped authority.

White-label and commercial variation must be configuration/policy driven. The architecture should permit future organisation-level product identity, branding/domain, authentication policy, enabled Domain Packs, capability entitlements, provider policy, execution policy, retention and notification branding without source forks.

The current build does not require the white-label administration UI, custom-domain provisioning, SAML/SCIM, reseller support or billing catalogue.

### 10.1 Ordinary-user-first product UX

Extensibility must not turn Studio into an infrastructure console. The default user experience remains conversation-first and guided: create/select a project, explain the goal, attach supported context and work with `Auto` selections. Ordinary users must not need to understand provider routes, harnesses, environments, MCP internals, runner topology or credential ownership to use the product successfully.

Advanced controls are progressively disclosed. Provider/Connection, exact Model Route, Harness, Environment and execution policy belong in advanced run settings; Skills, MCPs, Connectors, Agents and broader capabilities require clear discoverable project-level capability surfaces. The platform may expose richer detail to expert users and administrators without making that detail mandatory for normal use.

This UX rule is an acceptance invariant: a backend capability is not considered fully productised merely because an API or raw form exists. Task-9 reconciliation must identify functional-but-not-yet-best-in-class UI and carry it as pending acceptance work rather than silently treating it as complete.

## 11. Epistemic/evidence extensibility

Do not build a generic epistemology subsystem during Task 9. Preserve stable, generic subject/reference/provenance boundaries across artifacts, evidence, review findings and decisions so a later Claim/Epistemic layer can represent beliefs, supporting/contradicting evidence, reproduction status, confidence, assumptions and invalidation/revalidation.

Engineering's exact-source gates, review findings, adjudication and RED reproduction remain the reference assurance implementation.

## 12. Task-9 A/B/C reconciliation rule

Every new extensibility/commercialisation requirement is assessed during Task-9 pre-acceptance reconciliation on two axes:

**Implementation status:** implemented + proven; implemented but under-tested; partial; missing; deliberately deferred; superseded.

**Timing decision:**
- **A â€” Already satisfied:** prove/document existing architecture; no speculative source change.
- **B â€” Foundational change required now:** implement only where deferral would create breaking schema/API migration, security/authority retrofit, irrecoverable attribution/evidence loss, customer forks, or major foundational restructuring.
- **C â€” Explicitly deferred product capability:** architecture permits it; implementation is intentionally out of current scope.
A proposed B item must explain why it is B rather than C and should preferably strengthen AI Engineering OS itself.

Current B candidates include any remaining gaps in explicit credential ownership, durable execution attribution, the provider-neutral AI Connection adapter seam, connection-scoped model discovery/route reconciliation, and ordinary-user productisation needed to prevent infrastructure concepts becoming mandatory in the default Studio path. Current C items include Scientific Research implementation, white-label administration UI, billing/FinOps dashboards, bespoke adapters for every model provider, full commercial BYOC/provider-marketplace administration, enterprise-parent tenancy and a generic epistemic reasoning engine. Final classification still depends on live-code reconciliation and test evidence, not assumption.

## 13. Task-9 sequencing

This addendum does not create a new programme before Task 9. The required sequence is:

```text
finish current Task-9 REDâ†’GREEN boundary
â†’ continue the coherent Task-9 slice
â†’ full current-doc/recent-decision/code reconciliation
â†’ apply this addendum and classify each requirement A/B/C
â†’ prove A; implement/test only justified B; document C
â†’ focused + full deterministic gates
â†’ exact-source freeze
â†’ fresh blind council
â†’ normalize/deduplicate + independent adjudication
â†’ RED valid findings + batch remediation
â†’ re-gate/fresh review after source changes
â†’ accept Task 9 only when clean
â†’ commit/push accepted boundary to GitHub main
â†’ continue next substantial task
```

## 14. Acceptance test for the foundation

The architecture is correctly separated when AI Engineering OS can continue becoming substantially deeper and more specialised while a future serious domain or white-label enterprise can be added without rewriting core identity/orchestration/governance/state semantics or forcing the platform operator to fund every customer's AI/compute usage.

Until a future extension SRS supersedes or elaborates this document, these invariants are authoritative for current-build decisions.
