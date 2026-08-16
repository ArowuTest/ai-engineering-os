# ECC-Native Capability Productisation Design

**Date:** 12 August 2026
**Status:** Approved architectural direction captured from product-owner decisions
**Parent:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md`

## 1. Decision

AI Engineering OS is an enhanced, privately branded and productised evolution of ECC. The inherited ECC agents, skills, commands, workflows, learning, memory, MCP definitions, evals, verification, security and autonomous-engineering patterns are native parts of the product repository, not an external capability product to be recreated beside `platform/`.

The default engineering rule is **reuse before rebuild; preserve before replace; generalise before discard**.

Before replacing any material inherited ECC subsystem, the team must record whether it is reused as-is, adapted/generalised, superseded for a documented reason, or excluded for a documented security/product reason.

## 2. Approaches considered

### Chosen — native foundation + thin productisation/control surfaces
Keep ECC implementations in place and make `platform/` discover, permission, route, observe and present them through stable product contracts. Generalise Claude/ECC-specific assumptions only where required for Codex, Hermes, Antigravity, OpenCode or future harnesses.

### Rejected — duplicate capability layer
Do not copy ECC agents/skills/workflows into a second implementation tree or rebuild learning, memory, evals, verification or MCP catalogues from zero. That adds drift and loses upstream value.

### Rejected — direct arbitrary ECC coupling
Do not let SaaS/API code reach into arbitrary ECC internals without stable boundaries. Product governance, tenancy, RBAC, audit, credential scope and durable state remain platform responsibilities.
## 3. Native capability estate to preserve and expose

At minimum the product must retain and progressively productise:

- ECC agent definitions and team-agent orchestration;
- the skill estate, skill-scout, skill-stocktake, skill-health and skill-compliance tooling;
- Continuous Learning v2.1 observation, confidence-scored instincts, project isolation, promotion and evolution into skills/commands/agents;
- Unified Memory / ECC Memory Vault and cross-harness handoff concepts;
- eval-harness, agent-eval, agent-self-evaluation and agent-architecture-audit;
- verification-loop, TDD, independent review, browser QA and canary-watch;
- autonomous/continuous loops and dynamic workflow patterns;
- benchmark optimisation, context-budget and iterative retrieval;
- security review/scanning and enterprise-agent-ops patterns;
- cost tracking/cost-aware routing and evidence-first research workflows;
- ECC's existing MCP catalogue and connector policy.

These capabilities may be expanded or normalised, but should not disappear merely because a new web/API module has not yet surfaced them.

## 4. Skills and MCP policy

The Skills Registry is seeded from the approved inherited ECC skill estate rather than starting empty. Trusted external sources such as OneSkill are discovery channels for capabilities we lack, not trust authorities. Every external skill passes provenance, licence, script/dependency, permission, injection, secret, network and compatibility review before approval.

The MCP/Tool Registry is likewise seeded from approved inherited ECC definitions. MCPs are dynamically activated by organisation, project, agent and task policy; credentials and destructive permissions are never granted merely because an MCP definition exists in the repository.

Only task-relevant skills and tools are loaded into worker context. Context-budget and skill-compliance evidence should feed resolver decisions over time.
## 5. Learning and memory

Continuous Learning becomes a first-class AI Engineering OS capability. ECC's existing observer/instinct/evolve implementation is the starting implementation; product work generalises observation inputs across supported harnesses and adds platform governance rather than replacing the engine.

Learning scopes are isolated by default. Project learning remains project-scoped; promotion to organisation or platform scope requires evidence, policy and review. Learned behaviour never silently becomes security policy, production authority or a trusted external skill.

Memory and learning remain separate concepts: memory preserves durable facts, handoffs and project context; learning derives reusable behaviour from evidence. Both remain inspectable and auditable.

## 6. Runtime productisation boundary

`platform/packages/ecc-adapter` evolves from provenance-only validation into a thin stable boundary for discovery and normalisation. It may expose approved agents, skills, commands, workflows, MCP metadata, memory/learning operations and verification/eval results without copying their implementations.

The platform remains authoritative for tenancy, project membership, RBAC, audit, AI connection/entitlement policy, credential scope, budgets, canonical Product Knowledge, task state and deployment authority.

The orchestrator resolves the smallest authorised capability set for a task: role/agent + execution route/model + harness + relevant skills + relevant MCP/tools + connection/runner + review/quality policy.

## 7. Product experience

The UI is project/team-centred rather than model-centred. Normal users should be able to use Auto/Recommended routing while advanced users and administrators can inspect or override eligible models/routes, agents, skills and MCPs within policy.

Administration is scoped at Platform, Organisation and Project levels. Mission Control/Engineering Team views should expose active agents, tasks, model/harness route, loaded skills, activated MCPs, cost/usage, checkpoints, blockers, reviews and handoffs without exposing private credentials or hidden provider sessions.

## 8. Admin-owned capability catalogue and release governance

The platform/admin control plane owns the complete discovered and inherited capability catalogue. ECC capability discovery is deliberately broader than the ordinary user catalogue: a harness, agent, skill, MCP/tool, model route or workflow may be known to the platform without being released to the user population.

For harnesses specifically, Admin sees every discovered/supported ECC execution surface and its maturity/evidence state. Admin explicitly decides which harnesses are released to all users or to narrower organisation, role/team, cohort or project scopes. Ordinary users and projects may choose only from the released subset for which they are also eligible.

Catalogue presence, product release and execution authority are separate states. A harness may be `discovered` or `ecc_compatible` while governed runner execution is still unverified; it must not gain delegation, write/execute authority, subscription sharing, persistent execution or managed-sandbox eligibility merely because it exists in ECC. Release policy composes with route/model eligibility, connection/subscription policy, runner availability, environment support and task operation authority.

The same governance pattern applies to agents, agent teams, skills, MCP/tools and specialised workflows: preserve the broad applicable ECC estate in the admin catalogue, then publish only approved subsets to users/projects. Upstream discovery never auto-publishes capability.

## 9. Verification and acceptance

Capability productisation is complete only when the inherited implementation remains available, the platform can discover and permission it through stable contracts, cross-harness assumptions are explicit, tests cover tenant/credential boundaries, and existing ECC regression gates remain green.

New ECC upstream changes continue through the existing fetch-only `upstream` / `ecc-upstream` review process. Upstream updates never auto-trust new skills, agents or MCPs.

The immediate delivery order remains: finish AI connection/delegation verification and merge; then Agent Bridge/runner execution; then deepen ECC-native Engineering Studio capability exposure in bounded slices, starting with inventory/registry surfaces, memory/learning, orchestration/evals/verification and dynamic skills/MCP resolution.