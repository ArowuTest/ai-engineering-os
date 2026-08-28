# Extensibility & Commercialisation Foundation Design

**Date:** 20 August 2026
**Status:** Approved architectural foundation for Task-9 reconciliation
**Parent requirements:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md` v1.7
**Authoritative addendum:** `docs/product/AI-ENGINEERING-OS-EXTENSIBILITY-COMMERCIALISATION-FOUNDATION.md`

## 1. Goal

Preserve AI Engineering OS as the flagship, deeply specialised software-engineering environment while adding only the extension seams whose absence would make future multi-domain, BYOK/BYOC, enterprise or white-label support structurally expensive.

This design does not authorise implementation of a second domain, billing product, white-label administration suite, bespoke integration with every model provider or a full commercial BYOC/provider marketplace. It does require the provider-neutral connection/discovery/connection-scoped-route foundation where deferral would create an expensive routing/authority retrofit.

## 2. Reuse-first rule

Before adding any new type/table/service, classify the requirement against existing architecture:

- Capability Estate and release/eligibility policy;
- AI Connections and secret ownership/delegation;
- common execution evidence;
- ExecutionEnvironmentProvider;
- runner/harness abstractions;
- organisation/project tenancy;
- audit/unit-of-work semantics;
- artifact/evidence/provenance records.

Extend these boundaries where safe. Do not create parallel subsystems merely to satisfy future terminology.
## 3. Minimal extension contract

A future domain contribution needs a stable versioned descriptor boundary, but not a generic plugin marketplace now.

The contract must be able to describe identity/source/version plus contributed capability IDs, specialist roles, workflow/gate kinds, artifact/evidence kinds, review policy, tool requirements, execution requirements, schemas and bounded UI-extension metadata.

The descriptor is declarative input. It does not receive direct authority to mutate tenancy, credentials, audit, entitlements or canonical state.

The Capability Estate remains the authority layer for discovered extension contributions. The minimum safe implementation may be a descriptor/registry seam over existing capability records rather than new domain tables.

## 4. Execution ownership

AI Connections are the starting point. Required hardening, if live reconciliation proves a gap, should add safe owner/billing/entitlement references to existing connection/execution contracts.

OpenRouter is one provider family, not the architectural centre. Task 9 must add a provider-neutral connection-adapter seam capable of connection validation, model discovery or explicit catalogue reconciliation where supported, capability/availability representation and binding a model route to the connection that supplies credentials. Native providers, multi-model aggregators, OpenAI-compatible endpoints and private/enterprise gateways must be able to join through that seam without a new credential or routing subsystem.

The same logical model exposed through two providers/connections is two distinct governed routes. Provider + model + connection owner/reference must survive route identity and execution evidence. Discovery creates candidate routes only; Capability Estate governance/release/eligibility remains authoritative before execution.

Do not duplicate secrets. The platform persists references and ownership; provider auth material remains in the secret store/authorised runner boundary.

## 5. Attribution envelope

Common execution evidence should preserve enough dimensions to support future BYOK/BYOC, quotas and cost attribution without later log reconstruction.

Required conceptual dimensions are requester, organisation/project/task/session, agent/capability, model/route, harness, connection/credential owner, runner, environment, entitlement/budget, usage class/units, known cost reference and outcome/checkpoint/evidence.
## 6. Execution tuple

The orchestrator never treats one selector as authority for another. The independently validated tuple is:

```text
Agent
Model / exact Route
Harness
Connection / Credential Owner
Runner
Execution Environment
Skills / Tools
Operation Grants
Entitlement / Budget
```

Current Product Partner/API turns may persist Agent/Harness as governed selection metadata when that path does not consume those dimensions operationally. This is a path-specific limitation, not a domain rule. Engineering execution later consumes the operational tuple.

`Auto` applies policy ranking. Explicit selection is exact-or-fail-closed.

## 7. Environment model

Keep Local as the implemented/default `ExecutionEnvironmentProvider`. Preserve the provider contract so the pending OpenSandbox adapter and later BYOC/private providers can be added without changing canonical project/session/memory authority.

Do not implement the OpenSandbox POC as part of Task 9 unless separately authorised; do not describe it as already complete.
## 8. Native harness model

The orchestration/runner/environment/harness abstraction and Codex/Claude Code/Antigravity adapters already exist. The richer first-party AIOS Native Harness remains a separate future engineering boundary and must not be inferred complete from the abstraction layer.

## 9. Tenancy and white-label

Organisation remains the current tenancy/security boundary. Avoid a speculative parent Tenant entity. Preserve an additive path for a future enterprise account to own multiple organisations.

White-label architecture is one codebase plus configuration/policy/entitlements/deployment profile/branding. Current work establishes only the configuration ownership seam where an expensive retrofit would otherwise arise.

## 10. Ordinary-user product UX

The extension model must not make ordinary Product Studio users operate an infrastructure console. The default project/setup/composer experience remains conversation-first, guided and usable with `Auto` selections. Provider/Connection, exact Model Route, Harness, Environment and policy controls are advanced settings; Agents, Skills, MCPs and Connectors remain clearly discoverable through project capability surfaces.

Task-9 productisation is incomplete if normal users must understand route IDs, MCP internals, runner topology or credential ownership to complete ordinary project work. Functional raw forms may exist during development but must remain classified as pending UX convergence until the ordinary-user path is clear and familiar.

## 11. Evidence extensibility

Keep stable generic subject/reference/provenance semantics in artifact/evidence/review/decision records. Do not build a generic epistemic-state engine now.

## 12. A/B/C decision rule

At Task-9 reconciliation, each new requirement receives implementation status plus:

- **A:** already satisfied; prove and document.
- **B:** foundational change now; requires evidence that deferral causes breaking migration, security/authority retrofit, irrecoverable attribution loss, customer forks or major foundational restructuring.
- **C:** deliberately deferred product capability; architecture permits it but current implementation is unnecessary.

A B item must be justified individually and should preferably strengthen Engineering itself.

## 13. Expected initial classification hypotheses

These are hypotheses to verify against live source and tests:

- credential ownership: likely A/B using AI Connections;
- execution attribution: likely A/B using common execution evidence;
- provider-neutral AI Connection adapter seam: B;
- connection-scoped model discovery/route reconciliation: B;
- ordinary-user Studio/project UX convergence and progressive disclosure: B where current raw UX would otherwise become the accepted product boundary;
- control/execution plane: likely A plus documentation/hardening;
- Domain Pack descriptor seam: likely B but minimal only;
- environment-provider extensibility: likely A; OpenSandbox implementation is C for Task 9;
- white-label admin/product: C;
- bespoke adapters for every model provider and full commercial BYOC/provider marketplace: C;
- enterprise-parent tenancy: C;
- Scientific Research/domain implementations: C;
- generic epistemic reasoning engine: C.

## 14. Task-9 integration

Resume the current Product Studio Requirements Assurance finding-decision UI RED first, then continue the coherent Task-9 loop. Before acceptance, implement/test the justified provider-neutral connection/discovery/connection-scoped-route foundation and ordinary-user UX convergence, build the full requirement-to-code/A-B-C matrix, document C items, and run the normal deterministic gate/freeze/council/adjudication/remediation sequence.

## 15. Security test

A future third-party extension is safe only if removal/disablement cannot corrupt canonical platform state and installation cannot grant itself tenant access, credentials, entitlements, execution authority or audit exemptions.

## 16. Success criterion

Engineering can continue growing substantially deeper while a later serious domain or enterprise deployment can be added without rewriting platform authority/state semantics or forcing AIOS to carry all customer model/compute cost, and an ordinary user can use the default Studio successfully without understanding execution-infrastructure terminology.
