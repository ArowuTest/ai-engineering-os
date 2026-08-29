# AIOS FS V2B Operational Continuity & Control-Plane Hardening Plan

**Status:** approved for implementation
**Source comparison:** revised FS V2B reviewed against AIOS through checkpoint `978c838590b1ada358f4ecc56cd2ce0bc69506d5`.
**Principle:** adapt useful mechanics into existing AIOS Project/Task/EngineeringSession/Dispatch/Capability Estate/Review Council/Evidence systems; do not embed FS V2B as a second platform.

## Current coverage / programme position

Fresh pre-council Task-9 evidence on the accepted checkpoint:

- static/contracts: **57/57 GREEN**;
- non-DB/unit: **428/428 GREEN**;
- serialized PostgreSQL integration: **63/63 files GREEN**;
- platform + web TypeScript: PASS;
- Next production build: PASS;
- npm high-severity audit: **0 vulnerabilities**;
- root workflow/ECC/command/unicode/path/IOC security checks: PASS;
- live ordinary-user desktop + 390px accessibility verification: PASS.

This is behavioral/acceptance coverage, not a measured statement/branch coverage percentage. A code-coverage percentage is not currently an acceptance gate and shall not be invented.

## P0 â€” implement now

### 1. Durable Engineering Recovery Checkpoints

Extend existing Engineering Session + Collaborative Memory infrastructure. Do not create `.agent` files or a parallel checkpoint database.

A checkpoint records:

- organisation/project/workstream/task/session identity;
- source branch/commit/dirty digest when known;
- selected agent/harness/model route/runner/environment;
- objective/current phase;
- last accepted boundary;
- evidence references;
- blockers;
- next actions;
- checkpoint reason;
- observed timestamp.

Automatic/semiautomatic trigger contract:

- meaningful source mutation boundary;
- successful verification gate;
- coherent accepted commit;
- runner/environment transition;
- before handoff;
- before council;
- before environment suspension/deployment.

AIOS should coalesce/debounce checkpoints rather than writing after every arbitrary command.

**Acceptance:** durable tenant/project/session-scoped checkpoint can be saved and read using existing repositories; stale repository state is explicitly contextual, never current-state authority.

### 2. Portable Project Continuation Context

Expose one provider/harness-neutral continuation projection derived from canonical AIOS state plus trusted durable context.

Fields include:

- objective;
- active task/session;
- source revision observation;
- active execution selections;
- methodologies/provenance metadata;
- decisions;
- blockers;
- pending questions;
- next actions;
- accepted evidence;
- acceptance state;
- latest recovery checkpoint;
- generated timestamp.

A new harness/client may consume the projection, but must re-observe repository/runtime state before treating it as current truth.

**Acceptance:** continuation context can be reconstructed for an owned active Engineering Session without granting new authority or exposing private reviewer/session context.

### 3. Capability Availability + Health + Retryability

Extend `RuntimeCapabilityManifest` so capability support is not conflated with runtime health.

Keep availability:

- `declared`
- `available`
- `unavailable`
- `unknown`

Add health:

- `healthy`
- `degraded`
- `temporarily_unhealthy`
- `unavailable`
- `unknown`

Add retryability:

- `retryable`
- `non_retryable`
- `approval_required`

Also carry safe reason code, observation timestamp/evidence reference where applicable.

**Acceptance:** transient provider/runner/tool failures can be represented as supported-but-temporarily-unhealthy instead of incorrectly becoming unsupported.

### 4. Automatic Review Council Evidence Collector

Build on existing `EvidenceEnvelope` and native Review Council packet sealing.

Automatically collect exact-source evidence before council:

- commit/tree/diff status;
- static/unit/integration/type/build/security evidence;
- relevant runtime capability health;
- applicable execution attribution;
- relevant SRS/ADR references;
- acceptance criteria.

No second council/evidence store.

**Acceptance:** council packet builder consumes existing evidence and source seals; exact packet can be reproduced/audited.

## P1 â€” implement after P0 continuity foundation

### 5. Memory staleness and revision-sensitive context

Add freshness semantics by memory kind and optional source revision. Repository/runtime-sensitive facts, blockers, hypotheses and next actions become stale when their source revision no longer matches current observed state. Stale records remain durable history but are excluded from automatic current-context selection unless explicitly requested.

### 6. Provider-neutral execution-environment lifecycle policy

Add lifecycle policy to `ExecutionEnvironmentProvider`:

- `ephemeral`
- `persistent`
- `protected`

Provider-neutral operations:

- status
- ensureAvailable
- suspend
- resume

No implicit destructive `down`, volume deletion or prune operations. Persist recovery checkpoint before automatic suspension.

### 7. Provider-neutral SourceHostProvider

Introduce a governed source-host seam rather than a GitHub-specific core.

Initial GitHub adapter may support:

- repository observation;
- pull requests;
- issues;
- CI/checks/workflow runs;
- evidence conversion into `EvidenceEnvelope`.

GitLab/Azure DevOps remain future adapters.

### 8. Governed database tool adapter

Expose health/schema/query/explain through Capability Estate + Operation Grants + Runner + Environment. Development writes only through governed policy; staging/production read-only by default.

### 9. Governed browser automation capability

Expose deterministic browser navigation/snapshot/network/console/accessibility/performance through governed execution rather than ambient agent authority.

## P2 â€” later

### 10. Semantic desktop automation capability

Optional Runner capability using stable window identity and accessibility semantics first, visual fallback second and bounded pointer interaction last. Never bypass OS security/consent boundaries.

## Explicit non-adoptions

Do not import:

- FS V2B tunnel/runtime-instance architecture;
- Cloudflare-specific recovery mechanics;
- compact GPT Actions/OpenAPI wrapper;
- PowerShell project lifecycle scripts;
- `.agent-runtime` / `.agent` project state as AIOS canonical storage;
- V2B Mission table as a parallel Project/Task/Session hierarchy;
- V2B Worker queue as a parallel Dispatch system;
- V2B Council store as a parallel Review Council;
- V2B capability broker as a parallel Capability Estate.

## Delivery sequence

1. P0.1 Engineering Recovery Checkpoint.
2. P0.2 Portable Continuation Context.
3. P0.3 Capability Health/Retryability.
4. P0.4 Council Evidence Collector.
5. focused gates + coherent checkpoint commit.
6. resume Task-9 council/adjudication on the new exact source.
7. only then proceed to P1 if no acceptance blocker remains.

The objective is to finish the platform, not create an endless architecture programme. P1/P2 items are bounded follow-on capabilities and shall not block Task-9 acceptance unless implementation reveals an expensive-to-retrofit defect in an existing P0 seam.
