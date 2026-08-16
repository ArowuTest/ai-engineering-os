# Collaborative Memory & Parallel Session Design

**Date:** 16 August 2026
**Status:** Product-owner approved design; written-spec review pending
**Parent SRS:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md`
**Parent architecture:** `docs/architecture/AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md`
**ECC foundation:** `docs/design/ecc-memory-vault.md`, `docs/architecture/cross-harness.md`, `skills/unified-memory/`, `skills/team-agent-orchestration/`

## 1. Decision

AI Engineering OS shall productise ECC Unified Memory / Memory Vault, cross-harness handoffs and team-agent orchestration as a first-class **Collaborative Memory** subsystem.

The platform shall not depend on one harness transcript, one local workstation, or one agent process to preserve engineering context. Multiple authorised users, agents and parallel sessions must be able to continue the same project with policy-scoped access to durable context, evidence and handoffs.

The platform control plane is authoritative for collaborative memory identity, tenancy, access policy, session/workstream bindings, audit, review isolation and governed promotion. ECC memory documents, CLI/MCP adapters and harness-neutral handoff semantics are reused as interoperability/runtime surfaces rather than discarded.

Core rule: **private working context may be session-local; durable collaborative context belongs to the project and survives the session.**

## 2. Approaches considered

### Chosen — ECC engine + platform collaborative control plane
Reuse ECC memory schemas, kinds, handoffs, CLI/MCP access, secret/path hardening and cross-harness concepts. Add platform-owned durable metadata/content, RBAC, project/workstream/agent/session scopes, visibility policy, audit and orchestration integration. Local ECC vaults become interoperable caches/import-export surfaces rather than the only shared source of truth.

### Rejected — ECC vault as the only canonical store
A local Markdown vault is excellent for inspectability and cross-harness portability, but by itself it cannot provide authoritative multi-user tenancy, remote collaborators, OpenSandbox workers, durable access revocation, central audit or concurrent project coordination across machines.

### Rejected — rebuild memory independently in `platform/`
A separate memory engine would duplicate ECC's mature document contract, CLI/MCP adapters, handoff semantics and safety work. It would create drift and reduce cross-harness compatibility.

## 3. Inherited ECC capability to reuse

The first implementation must reuse or adapt, not recreate, the following ECC assets:

- `ecc.memory.v1` portable memory document semantics;
- project, team and user memory concepts;
- memory kinds including context, decision, fact, handoff, lesson, note, preference and runbook;
- source-harness and target-harness routing metadata;
- create-only/supersession semantics and explicit links;
- bounded lexical search and direct-ID read behavior;
- secret/private-key rejection and symlink/path safety rules;
- `ecc memory` CLI behavior and the opt-in memory MCP contract;
- cross-harness support for Claude, Codex, Hermes, OpenCode, Cursor and future adapters;
- team-agent orchestration concepts: owner, scope, state, branch/worktree, evidence, merge gate and handoff.

ECC automatic session capture and cross-harness session-resume behavior are not treated as already complete. AI Engineering OS adds those product semantics deliberately.

## 4. Product-owned collaborative memory model

The platform shall expose durable memory through explicit scopes rather than one undifferentiated store:

1. **Project Memory** — stable project facts, architecture context, approved decisions, reusable runbooks and governed references.
2. **Workstream/Task Memory** — task-local discoveries, checkpoints, blockers, evidence and active handoffs.
3. **Agent Memory** — durable context associated with an OS agent identity, never permanently bound to a model or harness.
4. **Session Memory** — ephemeral or durable session-specific working context, tool state references and continuation checkpoints.
5. **Review Memory** — Review Council packets, findings, adjudications, rechallenges, calibration evidence and acceptance state with strict blind-review visibility rules.
6. **User Private Memory** — user-owned preferences/context not shared merely because the user joins a project.
7. **Organisation Knowledge** — explicitly promoted reusable knowledge available across authorised projects under organisation policy.

Memory records must carry immutable organisation/project identity where applicable, creator/agent/session provenance, kind, scope, visibility, trust/promotion state, content digest, timestamps and supersession/link relationships.

## 5. Canonical state and ECC interoperability

The platform database is the system of record for collaborative-memory authority and content required for multi-user continuation. It must support transactional access control, audit, concurrent readers/writers and remote execution environments.

ECC Markdown memory remains a supported portable representation. The ECC adapter may import, export or materialise authorised platform memories into the task worktree/vault and may ingest newly created ECC-compatible memories back through platform validation.

A local vault must never silently override a newer or more authoritative platform record. Import uses stable memory identity plus content digest/version metadata. Conflicts fail closed or create a new superseding record; they do not perform last-writer-wins mutation.

Canonical Product Knowledge remains distinct from Collaborative Memory. Memory can reference Product Knowledge and can propose promotion, but unreviewed memory cannot alter approved requirements, architecture, security policy or deployment authority.

## 6. Parallel-session architecture

A project may have multiple concurrent engineering sessions owned by different human users and/or agents. Each session has:

- a stable platform session ID separate from provider/harness session IDs;
- organisation/project/workstream/task binding;
- agent identity and current harness/model/runner/environment route;
- branch/worktree or sandbox workspace reference where applicable;
- status/heartbeat and last durable checkpoint;
- private session context plus authorised shared-memory subscriptions;
- explicit handoff targets and evidence references.

Harness/provider session identifiers are optional evidence only. Switching Codex to Claude Code, moving Local to OpenSandbox, or replacing one model route must not change the OS session/task identity or erase its durable memory.

## 7. Visibility and isolation policy

Memory visibility is policy-controlled and evaluated before recall, context assembly or MCP/CLI materialisation.

Minimum visibility classes:

- `session_private` — visible only to the owning authorised session/user/agent context;
- `workstream_shared` — visible to authorised collaborators/agents assigned to the workstream;
- `project_shared` — visible to authorised project members/agents;
- `organisation_shared` — visible only after explicit governed promotion;
- `reviewer_private` — visible only to one Review Council assignment plus authorised adjudication flows;
- `adjudication_shared` — visible to the adjudicator after blind first-pass reviews are complete;
- `user_private` — owned by a user and never inherited through project membership alone.

A blind reviewer must receive the canonical review packet and any explicitly allowed governed project references, but not peer findings, peer reasoning, adjudications, rechallenges or reviewer-private memory from the same blind run.

Fresh-source review creates fresh reviewer contexts. Prior reviewer-private state is not injected into the fresh run unless the protocol explicitly classifies it as permitted calibration metadata rather than case-specific opinion.

## 8. Context assembly and retrieval

The orchestrator shall build task context from the smallest authorised set:

`Product Knowledge + governed project references + relevant shared memory + task/workstream memory + allowed agent/session context + skills/tools + review policy`.

Retrieval is bounded by tenant, project, visibility, task relevance, recency, trust, target-agent/harness metadata and context budget. Search results are data, not executable instructions.

Initial retrieval may reuse ECC bounded lexical search and explicit linked memories. Semantic/vector reranking is optional and must remain an index/ranker rather than the sole canonical store. The platform must remain usable without embeddings.

The resolver shall expose why a memory item was included or excluded so context assembly is auditable and debuggable.

## 9. Handoffs and parallel agent collaboration

A handoff is a durable memory/event linking source session/agent to one or more target agents, sessions, workstreams or harness-neutral roles. It includes summary, outstanding work, evidence/checkpoint references, blockers, source commit/worktree/sandbox identity where relevant and creation time.

Handoffs do not transfer credentials or hidden provider sessions. A target agent resolves its own eligible model/harness/connection/runner/environment route under platform policy.

Parallel agents may read approved shared workstream/project memory while maintaining private scratch context. Worktree isolation remains mandatory for overlapping code changes. Shared memory is coordination context, not permission to edit another agent's workspace.

Mission Control should eventually show active sessions/agents, current workstream, harness/model/runner/environment, last heartbeat/checkpoint, handoffs, blockers and memory visibility without exposing hidden prompt text or secrets.

## 10. Trust and promotion

Inherited ECC writes remain unreviewed by default. AI Engineering OS keeps the same safety principle and adds explicit promotion states:

- `unreviewed` — generated/imported context; may be recalled only where policy permits;
- `verified` — evidence checked but not canonical Product Knowledge;
- `governed` — explicitly accepted as organisation/project reference through an authorised workflow;
- `superseded` — replaced by a newer memory/reference while retained for audit;
- `rejected` — excluded from normal recall but retained where audit policy requires.

An agent cannot promote its own memory into canonical Product Knowledge, security policy, release approval or organisation-wide knowledge without the required human/review authority.

## 11. Security and privacy

Collaborative Memory must preserve existing ECC protections and add platform controls:

- tenant/project/user scoping on every read/write/search;
- secret/private-key/credential pattern rejection before persistence or materialisation;
- no browser cookies, refresh tokens, consumer-session credentials or provider auth-store bodies;
- bounded content/metadata/links/targets;
- immutable provenance and append/supersede history for material records;
- immediate access revocation from future recall/materialisation;
- audit of create, read where required, share/promote/reject/supersede and handoff actions;
- no symbolic-link/path escape when materialising to a local vault/worktree;
- no reviewer-private memory leakage across blind Review Council seats;
- user-private memory never becomes project-shared by inference.

OpenSandbox workers receive only task-authorised materialised context. Personal local vaults/auth stores are never mounted wholesale into managed sandboxes.

## 12. Review Council integration

Review Council is a specialised consumer/producer of Collaborative Memory, not a separate memory silo. ReviewRun identity, exact source/evidence digests, reviewer assignments, findings, adjudications, rechallenges and calibration remain durable platform records and can emit bounded memory references for continuation/audit.

Blindness is enforced by visibility policy at context assembly time. A reviewer assignment receives no peer-review memory. Adjudication happens only after the blind collection phase. Material source change invalidates the acceptance state and creates a fresh review context rather than mutating the old run.

## 13. Data model direction

The implementation plan should introduce narrow platform contracts rather than one oversized memory object. Expected concepts include:

- `CollaborativeMemoryRecord` — durable content/provenance/trust/visibility record;
- `MemoryLink` — explicit relationship such as supersedes, supports, relates-to or handoff-from;
- `EngineeringSession` — platform-owned session identity and lifecycle;
- `SessionParticipant` or assignment — user/agent ownership and authorised collaborators;
- `MemorySubscription` / context policy — what shared scopes a session may consume;
- `AgentHandoff` — durable continuation package;
- `MemoryPromotion` — evidence-backed transition into governed reference state;
- `MemoryMaterialization` — auditable export/import boundary to ECC vault/worktree/MCP surfaces.

Exact table/type names may be refined in the implementation plan, but provider/model/harness/runner IDs must remain references rather than being collapsed into memory identity.

## 14. Failure handling

The subsystem fails closed:

- unauthorised scope or stale membership -> no recall/materialisation;
- unknown/revoked session -> no session-private access;
- malformed or oversized memory -> reject before persistence;
- secret-like content -> reject or quarantine according to policy;
- local-vault import conflict -> create explicit supersession/conflict outcome, never blind overwrite;
- materialisation path/symlink escape -> reject;
- unavailable harness/MCP -> memory remains durable in platform state and execution may continue through another eligible route;
- reviewer isolation uncertainty -> exclude the disputed context from the blind packet;
- persistence/audit failure on a material memory/share/promotion mutation -> rollback.

## 15. Testing and acceptance

Implementation follows RED -> verify RED -> minimal GREEN -> focused regression, then broad platform/ECC gates on coherent batches.

Minimum acceptance proofs:

1. Two concurrent sessions on one project can maintain separate private context and share an authorised workstream handoff without cross-session leakage.
2. A second harness can continue a task using the same platform session/task memory without requiring the first harness transcript.
3. Project RBAC/revocation immediately prevents future recall/materialisation while preserving immutable audit history.
4. User-private memory is not visible to project collaborators merely because the owner shared an AI connection or joined the project.
5. Blind Review Council seats cannot retrieve peer findings/reasoning from the same run; adjudication can retrieve them only after the blind phase.
6. Local/ECC vault import-export preserves stable IDs/digests/provenance and rejects conflicts, secrets and path escapes.
7. OpenSandbox task context contains only authorised bounded memory, never a wholesale user vault/auth store.
8. Unreviewed memory cannot directly mutate Product Knowledge, release approval, security policy or organisation-wide governed knowledge.
9. Handoff state survives runner loss, provider switch and harness replacement.
10. Existing ECC unified-memory and cross-harness regression gates remain green.

## 16. Delivery sequencing

This is a foundational Engineering Studio capability and shall be incorporated now, before frontend work assumes session semantics.

The current Review Council work may continue only in a way compatible with this design: reviewer/run/finding state must use the shared visibility/provenance principles and must not create an isolated long-term memory architecture.

Implementation should be decomposed into a dedicated Collaborative Memory/Parallel Session plan, with Review Council integration as a dependent boundary. The first slice should establish domain + persistence + access/context policy + ECC adapter interoperability before richer UI, semantic search or automatic reflection/capture.

Non-goals for the first slice: hosted vector database as authority, automatic organisation-wide promotion, cross-machine CRDT vault sync, unrestricted transcript ingestion, or copying user provider sessions into platform storage.