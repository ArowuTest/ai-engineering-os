# Studio Requirements Assurance Design

**Status:** APPROVED by Product Owner on 20 August 2026

## Purpose

Product Studio must not merely transcribe what a user asks for. It must help the user discover what a successful product or workstream actually requires, challenge incomplete understanding, and independently assure the resulting requirements before downstream execution begins.

This design adds a reusable **Assurance** substrate to AI Engineering OS and implements its first profile as **Product Requirements Assurance**. The substrate is domain-neutral so future Scientific Research, Compliance, Strategy, Operations and other Domain Packs can reuse it without inheriting software-specific review rules.

## Core principle

**Lead agents create and refine work; independent assurance agents challenge completeness and readiness; the platform owns findings, evidence, resolution state and readiness.**

## Product Studio operating model

The normal Studio flow is:

1. User works with the **Product Partner / Lead**.
2. The Lead uses professional and domain knowledge to clarify, challenge and guide rather than merely agree.
3. User-stated facts, AI inferences, recommendations, research-supported facts and unresolved assumptions remain distinguishable.
4. At meaningful checkpoints an independent **Requirements Reviewer** examines the current governed project state.
5. Reviewer findings are durable structured records, not hidden prompt text.
6. The Lead consumes unresolved material findings and asks the user the highest-value questions.
7. Canonical Product Knowledge changes only through existing authorised acceptance/revision flows.
8. Before requirements are treated as ready for engineering, the current requirements state receives a Requirements Readiness review.

The independent reviewer is an **agent capability**, not a hard-coded model. Its model route is independently governed and may be Auto or explicitly selected by future policy/UI.

## Domain-neutral Assurance substrate

The reusable platform layer SHALL define durable concepts equivalent to:

- `AssuranceRun`: organisation/project, profile ID, target type, exact target digest, reviewer agent capability, reviewer route, status and timestamps.
- `AssuranceFinding`: run, severity, category, finding kind, summary/rationale, proposed question, suggested direction, basis, evidence references and resolution state.
- `AssuranceReadiness`: current run conclusion plus blocking finding IDs and advisory coverage information.
- `AssuranceProfile`: versioned policy describing review areas, reviewer instructions, readiness rules and output contract for a domain/workstream.

Extensions may add profiles and categories, but may not bypass canonical identity, tenancy, audit, capability governance, evidence semantics or execution authority.

A changed target digest invalidates prior readiness for that target. Readiness is therefore evidence about an exact governed state, not a permanent project badge.

## Product Requirements Assurance profile v1

Profile ID: `product_requirements_v1`.

The reviewer must challenge at least:

- vision, objectives, personas and stakeholder goals;
- functional requirements and end-to-end journeys;
- business rules, permissions and state transitions;
- alternate paths, failures, retries, idempotency, cancellation, recovery and reconciliation;
- data ownership, lifecycle, retention and migration;
- integrations and third-party failure/unknown states;
- security, privacy, abuse/fraud and auditability;
- scale, performance, availability, resilience and observability;
- administration, support, operations and analytics;
- accessibility, localisation and deployment assumptions;
- applicable domain/regulatory questions and any item requiring current external research.

The profile may contribute additional domain-specific review areas later, but v1 must remain deeply suited to serious software/product requirements.

## Finding semantics

Finding kinds v1:

- `missing_requirement`
- `ambiguity`
- `contradiction`
- `edge_case`
- `failure_mode`
- `non_functional_gap`
- `security_risk`
- `operational_gap`
- `unresolved_assumption`
- `research_required`
- `recommendation`

Finding basis MUST distinguish `project_evidence`, `trained_knowledge`, and `external_research`. Model knowledge may generate questions and recommendations, but must never be silently promoted to user-approved requirements. Current factual claims that materially depend on changing external information should be marked `research_required` until supported by governed research evidence.

## Review cadence and readiness

The Lead challenges continuously. Independent assurance runs at meaningful checkpoints rather than after every sentence: after substantive discovery progress, after a major feature/domain change, before a section is treated as complete, before SRS generation, and against the final requirements state before engineering planning.

For Task 9 the first executable gate is deliberately simple and explainable:

- open `critical` or `important` findings => `not_ready`;
- unresolved material `research_required` findings => `not_ready`;
- no material open findings after a completed review => `ready`;
- reviewer execution unavailable or evidence incomplete => `insufficient_evidence` rather than a false pass.

A future governed human override may be added, but Task 9 must not silently bypass a blocked or insufficient-evidence readiness state.

## Context boundary

Reviewer input is assembled from platform-owned state: project metadata, relevant durable conversation history, canonical Product Knowledge, pending assumptions/questions where available, governed interaction artefact context, and the current exact requirements/document snapshot when one exists. Secrets and storage references are never exposed merely because an artefact exists.

## Task-9 implementation scope

Build now because these seams are costly to retrofit:

1. generic assurance run/finding/readiness domain and persistence;
2. versioned `product_requirements_v1` profile;
3. governed `agent.requirements_reviewer` capability identity;
4. independent eligible model-route resolution for reviewer execution;
5. exact governed Product Studio snapshot + digest;
6. structured reviewer output and durable findings;
7. readiness evaluation and read API/UI summary;
8. Lead prompt/context awareness of unresolved material assurance findings;
9. audit and fail-closed behavior.

Explicitly defer: large multi-model requirements council, generic marketplace of assurance profiles, full external research engine, regulatory certification, sophisticated probabilistic completeness scores, and domain packs other than Engineering/Product Requirements.

## Acceptance invariants

No reviewer finding mutates canonical Product Knowledge. Agent and model remain independent. A reviewer route must be capability-eligible. A changed reviewed target cannot retain stale readiness. Provider timeout/unavailability is evidence limitation, not readiness. Future Domain Packs reuse the same Assurance contract by adding profiles rather than copying the subsystem.
