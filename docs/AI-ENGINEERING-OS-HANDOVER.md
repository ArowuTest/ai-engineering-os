# AI Engineering OS — Living Handover

**Purpose:** Operational continuation document for a new ChatGPT/Claude/Codex agent if the current thread ends.
**Last updated:** 17 August 2026. Task 8 Collaborative Memory + Native Review Council is implemented and its original exact-source council findings have been independently adjudicated and remediated. Broad deterministic gates are GREEN; the remediated source still requires its fresh exact-source blind council before Task 8 acceptance. Task 9 is broadened to the Governed Capability Estate / Admin Release / User Eligibility + Studio Multimodal boundary.
**Repository:** `ArowuTest/ai-engineering-os`
**Local repo:** `<LOCAL_REPO_ROOT>`
**Current source-of-truth branch for active work:** `feature/subscription-execution-reconciled` in `.worktrees/subscription-execution-reconciled`; accepted prior foundation remains on `main` until this reconciliation slice passes all gates and is merged.
**Current Agent Bridge integration:** production feature tip `de947859f57cdfa5806934efc33fae1afe969e86`, handover tip `c4011f978f5358645b5b356cb17b97ee8344aca0`, merged locally into `main` as `cb7597a36f4025a831ae09dd377714d698a6ba69`; verify `origin/main` and GitHub CI before treating remote integration as complete.
**Task 4 accepted dispatch protocol:** `e5d0f430 feat: expose trusted runner dispatch protocol`; exact acceptance packet SHA-256 `aa32a1f0955aae824ff652e55f9bac223793f386d7fb86c63a47633ea38d7bbf`. Fresh isolated PostgreSQL 17 evidence: 26/26 focused, 33/33 static, 188/188 unit, 268/268 integration, root/web TypeScript PASS, migration 007 unchanged. Fresh blind council: Grok 4.6, GLM 5.2 and Gemini 3.7 Flash returned `NO FINDINGS`; Qwen 3.8 Max timed out and is recorded only as reviewer availability failure.
**Task 5 accepted execution-environment boundary:** `52f037446cb67258e73b36c9f14437419655b49f feat: define execution environment boundary`; exact final acceptance packet SHA-256 `e15fa8a1fa995e44892e7eabae5b8788db1617c65d947a4f7e1e2981bac723e7`. Fresh evidence: 24/24 focused execution-environment tests, 33/33 static, 212/212 unit, 268/268 isolated PostgreSQL 17 integration, root/web TypeScript PASS and diff checks PASS. Final blind council: Grok 4.6, GLM 5.2 and Gemini 3.7 Flash returned `NO FINDINGS`; Qwen 3.8 Max produced no verdict and is recorded only as reviewer availability failure. The local provider preserves the trusted-runner/worktree model while enforcing structured argv with `shell:false`, cwd/symlink containment, environment allowlisting, bounded UTF-8-safe evidence, provider-owned cancellation/lifecycle authority, and reusable provider-neutral contract tests.
**Task 6 accepted outbound runner loop:** `832c8af48da0d94e7358bdfbaf2786094275ddd6 feat: execute governed dispatches through local runner`; exact final acceptance packet SHA-256 `39325e8f00f50d6913674d0ee8348f079cc62d6fd3d520b318e925b1a9bb4c71`. Fresh evidence: 28/28 focused runner tests, 34/34 adjacent runner authority tests, 33/33 static, 240/240 unit, 268/268 isolated PostgreSQL 17 integration, root/web TypeScript PASS and diff checks PASS. Final blind council: Grok 4.6, GLM 5.2 and Gemini 3.7 Flash returned `NO FINDINGS`; Qwen 3.8 Max exceeded the review availability window with no result artifact. Prior council defects were remediated with in-flight checkpoint fencing, bounded checkpoints, `markRunning` ambiguity cancellation, irreversible local-cancellation semantics and idempotent `cancelObserved` retry. Qwen's malformed-envelope claim was `REJECTED` by canonical verifier source plus a passing direct regression test.
**Task 7 accepted thin harness execution:** final source head `ebb6b4ff75b377b528d40aeb38293a3131aba99e` (`fix: harden local harness execution boundaries`); exact final packet SHA-256 `b8d92fdbeabd86022b2ad2c27aa4b53bc545ad4b3456d0d3eb2670788528d8d2`. Fresh evidence: 85/85 focused harness/environment/policy/registry tests, Harness Adapter Compliance PASS across 11 inherited adapters, Harness Audit 80/80 with 0 failing checks, 33/33 static, 271/271 unit, 268/268 isolated PostgreSQL 17 integration, root/web TypeScript and diff checks PASS. Final blind council: Gemini 3.7 Flash, Grok 4.6 and GLM 5.2 returned `NO FINDINGS`; Qwen 3.8 Max returned an empty payload after 670s and is recorded only as reviewer availability failure. Codex and Antigravity remain fail-closed because their CLIs were unavailable for controlled live proof; Claude subscription auth was live-proven for isolated noninteractive read/edit-only use, but native Windows execute was not safely isolated so delegation/persistence remain disabled. Final hardening added bounded generic stdin, Codex prompt-via-stdin, per-adapter envelope-operation fencing and an Edit-only Claude mutation surface.
**Historical AI-connection Task 8 product merge SHA:** `69ebe73b549f2fa2c1e63a7fcf13c28771290a2d` (subsequent documentation-only closeout commits may advance `main`).

## 1. Product principle

AI Engineering OS is an "AI-powered software company in a box".
The web application owns the project; models, agents and harnesses are replaceable workers.
AI Engineering OS is the enhanced, privately branded and productised evolution of the inherited ECC repository. ECC agents, skills, commands, workflows, Continuous Learning v2.1, Unified Memory, MCP definitions, evals, verification, security and autonomous-engineering patterns are native product assets, not an external capability package to rebuild later.
The default rule is **reuse before rebuild; preserve before replace; generalise before discard**. `platform/` adds SaaS/product governance, tenancy, durable state, routing, RBAC, audit, entitlement controls and UI around that inherited engineering estate.
Canonical project state must survive provider switches, sign-out, runner loss and individual collaborators leaving.

Keep these concepts separate:
Provider → Model → Execution Route → Harness → Agent → Skill → Tool/MCP → Connection → Runner → Orchestrator.
AI Engineering OS is the master orchestrator. Hermes/Codex/Claude Code/Antigravity and other inherited ECC harnesses are execution surfaces, not canonical state owners.

The platform/admin control plane owns the broad inherited/discovered capability catalogue. Admin sees the complete harness/agent/skill/MCP/workflow estate and explicitly releases approved subsets to users, organisations, roles/teams, cohorts or projects. Catalogue presence is not user visibility and is not execution authority: release, delegation, allowed operations, subscription sharing, persistence and local/OpenSandbox environment eligibility remain separately governed.

Collaborative Memory is now a locked first-class OS subsystem. ECC Unified Memory / Memory Vault, `ecc.memory.v1`, cross-harness handoffs and team-agent orchestration are reused; the platform adds authoritative multi-user project/workstream/agent/session/review memory, RBAC/visibility, trust/promotion, audit, parallel-session continuity and Local/OpenSandbox materialisation. Provider/harness transcripts and local vaults are never the sole shared source of truth.

## 2. What is already merged to `main`

The routing foundation + review-first Product Knowledge extraction slice is complete and merged.
Merge commit: `e51a3c18 merge: routing foundation and review-first extraction`.
GitHub `main` passed Platform Verification and ECC Compatibility on that exact merge.
Delivered on `main`:
- Fastify API/orchestrator, Next.js Product Studio and PostgreSQL persistence.
- User ID/password authentication, invitations, organisation/project RBAC and immediate revocation.
- Persistent Product Partner conversations and canonical Product Knowledge/revisions.
- Extensible provider/model/route IDs; `auto` remains a routing sentinel, not a provider.
- Route capabilities including `structuredOutput` and neutral JSON-Schema response contracts.
- Structured-output translation for OpenAI, Anthropic and Google API adapters.
- Review-first knowledge extraction: answer + non-canonical candidates.
- Transaction A preserves conversation; Transaction B isolates extraction/candidate persistence.
- Duplicate suppression against envelope, pending candidates and canonical knowledge.
- Product Knowledge Review Queue with Product Owner Accept / Edit & Accept / Reject / Retry.
- Accepted candidates become canonical `confirmed`; client cannot override status.
- Retry uses original source turn and creates no duplicate conversation messages.
- Migrations on `main`: 001–006.
- Full local smoke and Docker PostgreSQL verification completed before merge.
The AI connection delegation/administration slice is also merged to `main`:
- reviewed feature tip: `ae72181d fix: complete AI connection delegation hardening`;
- merge commit: `69ebe73b merge: AI connection delegation administration`;
- GitHub feature CI run #95: ECC Compatibility + Platform Verification PASS;
- GitHub main CI run #96 on `69ebe73b`: ECC Compatibility + Platform Verification PASS;
- merged-main fresh Docker verification: 33 static + 131 unit + 185 integration tests, typecheck, production build, dependency audit and ECC/security gates all PASS.

## 3. Approved architecture for the current phase

Design: `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`.
SRS and Technical Architecture are v1.4.

Personal connection default sequence:
`Do Not Share` (absence of share) → explicit project share creates `Online Only` → owner may separately enable `Persistent` when trusted policy supports it.

Default execution tiering:
1. Requesting collaborator's own eligible connection.
2. Eligible shared project-pool connections.
3. Organisation-owned eligible connections.
4. Existing configured API routes as separate fallback routes.
5. Safe alternative/pause if none are eligible.Project state always remains durable regardless of connection availability.
Credentials are never delegated to collaborators; only an eligible execution route is delegated.
Personal provider passwords, cookies, refresh tokens and web sessions must never be stored or exposed by the platform.

## 4. Current implementation state

No AI-connection feature branch/worktree remains. The slice is merged to `main`, verified on GitHub, and the merged feature branch/worktree have been removed.

Implementation plan:
`docs/superpowers/plans/2026-08-12-ai-connection-delegation-administration.md`

Historical accepted commits from the merged feature branch:
- `7ae5d5df` — docs: plan AI connection delegation administration
- `4947db2f` — feat: define AI connection policy contracts
- `5b4ebbbe` — feat: persist AI connections and project delegation
- `086f4fd8` — feat: govern AI connection administration
- `f8ad851b` — fix: fail closed on ambiguous AI connection credentials
- `004dc663` — feat: add project-scoped AI connection sharing
- `7bb782f8` — feat: expose project AI execution pool policy

Tasks 1–8 are complete. Final whole-branch review found zero Critical/Important issues; feature and merged-main CI both passed; the feature branch/worktree were cleaned after containment was proven.

## 5. What Tasks 1–7 delivered

Task 1: open stable provider/family IDs plus trusted server-side `ConnectionFamilyPolicyRegistry`.
Unknown families fail closed. Personal subscription families remain non-delegatable until real runner support proves otherwise.Task 2: forward-only migration `006_ai_connections_and_delegation.sql`, `AIConnectionRepository`, project-share history and active-session presence.
Migrations 001–005 remain byte-identical to `main`.
DB enforces personal ownership, same-organisation project/share scope, personal-only project sharing and one active share per project/connection.

Task 3: `AIConnectionService` registration/list/revocation with organisation RBAC and atomic audit.
Personal owner is always the authenticated actor; user input cannot spoof owner/provider/delegatable/status.
Read models expose only `credentialConfigured`; never `secretRefId`.
Task 3 hardening removed host `environment` fallback for personal connections and fails closed on ambiguous organisation credential strategies.

Task 4: project sharing state machine.
No share row = private. First owner opt-in always creates `online_only`.
Persistent is a separate owner action and requires trusted `persistentSupported=true`.
Owner controls enable/mode/revoke. Organisation owner/admin may only narrow usage windows, never widen/clear or enable Persistent for another user.
Mode/window replacements are revoke-old + create-new in one transaction, preserving history and audit.

Task 5: project execution-pool read.
Ordering is requester → project_pool → organisation; API routes are separate fallback metadata.
Own use does not require `delegatable=true`; contributed personal routes do.
Online Only requires a real active AI Engineering OS session for the connection owner.
Persistent does not require web presence, but still obeys trusted policy and runner requirements.
Runner-required routes return `runner_unavailable`; no fake runner state is invented.
Usage window is start-inclusive/end-exclusive. Policy downgrades take effect at read time.

## 6. Task 8 — current work

Task 6 delivered the authenticated AI Connection HTTP API/runtime composition; Task 7 delivered the server-rendered AI Connections administration UI. Both are accepted.

Task 8 fresh verification is green on the current working tree:
- brand-new isolated Docker PostgreSQL volume/container `task8-final-postgres-1` healthy; prior volume preserved;
- clean install: 193 packages installed, 200 audited, 0 vulnerabilities;
- full test matrix: 33/33 static contracts, 131/131 unit, 185/185 integration;
- platform + web typecheck pass; Next.js 16.3/Turbopack production build pass;
- npm signatures: 186 verified packages, 52 attestations; production audit 0 vulnerabilities;
- ECC/security gates all pass: 67 agents, 21 hooks, 94 commands, 284 skills, 34 install modules, 81 components, 7 profiles, 122 rules, 10 workflows, catalog/registry, Unicode, portable paths and IOC scan (199 files);
- final independent whole-branch Opus review: 0 Critical / 0 Important; prior 2 Important + 10 Minor findings confirmed closed (M-3 confirmed false positive);
- two new non-blocking review observations were resolved as contract-clarity comments; targeted 27 domain/datetime + 11 UI tests and full typecheck remain green;
- real Fastify + production Next smoke: PASS; production sharing remains intentionally policy-blocked until Agent Bridge;
- real API restart against the same Docker DB preserved both smoke connections, their registration audits and project state.

The trusted-policy integration suite separately proves first-share Online Only, explicit Persistent, owner-offline behavior, revocation, windows and restart durability. Production subscription families remain non-delegatable until Agent Bridge, so the production smoke correctly proves fail-closed behavior rather than weakening policy.

**Historical Task 8 closeout:** completed before Agent Bridge. Current continuation is recorded in Section 6A and Section 11.
## 6A. Agent Bridge foundation - merged locally (15 August 2026)

Implementation plan: `docs/superpowers/plans/2026-08-14-agent-bridge-foundation.md`.
Accepted production feature tip: `de947859f57cdfa5806934efc33fae1afe969e86`; Task 7 handover closeout tip: `c4011f978f5358645b5b356cb17b97ee8344aca0`.
The branch was locally accepted and merged into local `main` via `cb7597a36f4025a831ae09dd377714d698a6ba69`; the merge tree exactly matches the reviewed feature tree. Remote `main` push/CI verification is still required at this checkpoint.

Accepted implementation sequence:
- plan: `76ba0e9a`;
- runner contracts and domain hardening: `93acdaf1`, `d74b5642`, `d0f172a4`;
- runner persistence and revocation hardening: `605eb36b`, `f0448b00`;
- runner governance/service hardening: `ff74f40c`, `395cace0`;
- runner HTTP/runtime boundary: `df2321be`, `94b65ad7`;
- runner-aware project execution pools: `643ee38b`;
- harness-neutral execution boundary and hardening: `f2770c20`, `f1a794e9`, `0b78fc36`, `b8aeabdb`;
- whole-branch heartbeat chronology remediation: `de947859`.
- Task 7 handover closeout: c4011f97.

The foundation now provides durable runner ownership/status/trust/capability contracts and scoped `RunnerTaskEnvelope`s; migration `007_ai_runners.sql`; organisation-scoped runner/binding/credential persistence; hash-only platform runner credentials; RBAC administration; trust/disable/revoke/rotate; credential-authenticated heartbeat and runner authentication; separate user-session and runner-bearer HTTP paths; runtime composition; real runner-aware requester -> project_pool -> organisation connection eligibility; Online Only/Persistent semantics; and a provider-neutral harness request/result/event boundary with scoped envelope validation and recursive credential-safe metadata handling.

Final whole-branch security review identified one real Important clock-skew defect: an allowed first heartbeat from a behind-clock runner could violate PostgreSQL `last_seen_at >= created_at`. A deterministic RED reproduced SQLSTATE `23514`; `de947859` clamps only the persisted `seenAt` to the immutable runner `createdAt` floor, preserving the five-minute skew allowance and stale/equal replay protection. The corrected-source Grok 4.6 security review and an isolated Gemini 3.7 Flash general review both returned `NO FINDINGS` / zero blockers.

Final verification on `de947859`:
- fresh isolated PostgreSQL 17 volume: 33/33 static + 167/167 unit + 238/238 integration = 438/438 tests GREEN;
- exact heartbeat remediation staged gate: platform/web typecheck PASS and 53/53 runner/database/server tests GREEN;
- local main merge cb7597a36f4025a831ae09dd377714d698a6ba69 has the exact reviewed feature tree and passed 33/33 static + 167/167 unit + 238/238 integration = 438/438 tests, full typecheck, production build, dependency audit, adapter/harness/IOC gates;
- Next.js 16.3 production build PASS;
- production dependency audit: 0 vulnerabilities;
- Harness Adapter Compliance PASS (11 adapters);
- Harness Audit 80/80 with 0 failing checks;
- supply-chain IOC scan PASS across 397 files;
- platform audit exited 0; its only attention item was GitHub-fetch authentication because the local `gh` CLI is unavailable;
- migrations 001-006 are Git-blob-identical to `main`; only migration 007 is new;
- provider login/session material is absent from runner persistence, audit metadata and normal read responses; runner platform credentials are plaintext only in the explicit one-time register/rotate response and are hash-only at rest.

The auxiliary inherited root ECC `npm test` mega-suite completed on this Windows host with 3,382/3,498 passing and 116 failing. This mega-suite is not the configured GitHub `ECC Compatibility` release job, and the full set of 116 failures has not been exhaustively baseline-classified; do not describe it as green or assume every failure is caused by Agent Bridge. The configured GitHub compatibility workflow instead runs the bounded agent/hook/command/skill/install/rule/workflow/catalog/registry/Unicode/path/IOC checks, whose local equivalents are green.

Reviewer transport availability was imperfect: Qwen 3.8 Max and, on some larger packets, GLM/Gemini/Grok calls timed out or returned empty payloads. Those events were recorded as availability failures only and never counted as passes or failures. Acceptance used valid fresh independent reviews plus exact RED/GREEN and platform verification evidence.

**Next slice after integration:** concrete subscription-backed harness adapters for Claude Code, Codex and Antigravity-style runners, plus an early OpenRouter API route. Keep provider login/session credentials runner-local where practical; the platform should continue to receive only safe runner/connection metadata and dispatch capability.
## 7. How the Opus subagent/reviewer workflow is being used

The user selected subagent-driven development.
Each task follows:
1. Fresh implementation agent receives only that task's brief + stable interfaces.
2. Strict TDD: tests are written first and a genuine RED failure is captured before production edits.
3. Implementer reaches targeted GREEN and commits one bounded task.
4. A fresh independent Opus reviewer inspects the exact commit range read-only.
5. Zero Critical/Important findings are required to close the task.
6. Any blocking finding gets a separate fix round with new RED tests, then scoped re-review.
7. Final slice gets a fresh whole-branch Opus review against the approved requirements.

Agent Bridge generalises this into the project Review Council: first-pass reviewers are genuinely blind to one another and receive the same canonical packet for comparative runs; findings are normalised only after blind reviews return; every material finding is independently adjudicated as CONFIRMED, PARTIALLY_VALID, REJECTED or INSUFFICIENT_EVIDENCE; confirmed defects use RED -> minimal fix -> GREEN where practical; rejected/partial findings can be privately re-challenged; and any material source change requires a fresh-source review. Reviewer timeouts/empty payloads are availability failures, never verdicts. Builder/model summaries have no acceptance weight without exact source/diff/test evidence.

**Locked product requirement - native Review Council feedback loop:** productise this workflow in platform code rather than leaving it as an external development convention. The native domain should preserve ReviewRun, ReviewFinding, FindingAdjudication, ReviewerRechallenge, CalibrationSnapshot and ArchitectureInvariant concepts (or equivalently narrow interfaces); enforce blind comparative input isolation; classify findings before remediation; route confirmed defects through RED/GREEN remediation where practical; support private reviewer re-challenge for rejected/partial findings; force fresh-source blind review after material source changes; and feed calibration into later model-role selection without exposing peer findings inside a blind run. One independently confirmed Critical/Important finding blocks acceptance; model majority never overrides a valid defect.

The development agents are launched through the locally installed Claude Code CLI using the user's authenticated Claude subscription.
Typical invocation uses `--model opus --effort medium` (high effort for whole-branch review), `--permission-mode bypassPermissions`, `--no-session-persistence`, `--no-chrome`, and a strict empty MCP config.

Important: the empty MCP config and `--no-chrome` apply ONLY to that individual Claude Code subprocess.
They do not change the user's Claude Desktop/Claude app, global MCP configuration, or Chrome integration.
The strict empty MCP setup was introduced because inherited MongoDB/Chrome MCP startup was delaying isolated backend subagents.Task briefs, implementer reports, review briefs and review reports are archived outside the repo at:
`<EXTERNAL_SDD_ARCHIVE_ROOT>/2026-08-12-ai-connection-delegation-administration/`
This prevents ignored reviewer scratch files from tripping ECC Unicode/path scans or contaminating task commits.

Reviewer focus is not just style. It challenges:
- requirement/spec compliance;
- tenant/RBAC and credential boundaries;
- transaction/audit atomicity;
- concurrency/history semantics;
- fail-closed provider policy;
- test quality and real RED evidence;
- scope leakage into later tasks;
- migration history and exact changed files.

## 8. Verification discipline / environment notes

Never claim Neon unless actually tested. Current work is continuously validated with Docker PostgreSQL; no identifiable AI Engineering OS staging Neon project was available during the previous slice.
Docker credentials for this repo are `engineering_os / engineering_os`, DB `engineering_os_test`, port `55432`.
Do NOT use `postgres/postgres`; that previously caused misleading Vitest timeouts/password failures.

On this Windows Desktop Commander environment, `ComSpec` may be missing from spawned processes. If npm lifecycle commands fail with `@npmcli/promise-spawn ERR_INVALID_ARG_TYPE`, set process-local:
`ComSpec=C:\Windows\System32\cmd.exe` and rerun the exact npm command. Do not change repo code for this environment defect.

Keep ECC scratch/reviewer output outside the repo. Ignored scratch containing Unicode arrows previously caused local `check-unicode-safety.js` to fail even though GitHub CI was clean.

## 9. Git workflow

Established workflow is NOT PR-first:
feature worktree/branch → verify/review → merge locally into `main` → verify merged `main` → push GitHub `main`.
After proving a feature branch is fully contained in `main`, delete the stale remote feature branch so GitHub does not misleadingly show outstanding product branches.
Preserve `ecc-seed` and `ecc-upstream`; never merge `ecc-upstream` wholesale. Dependabot branches are proposals and must be reviewed independently before merge.

## 10. Future providers/models

The architecture is deliberately open-ID and route/capability driven.
Adding Kimi/Moonshot, Grok/xAI, Mistral, DeepSeek or another provider should not require another ownership/domain migration.
Add trusted provider/family policy and a thin adapter/configuration where request/response semantics differ.

**Locked product requirement - governed, swappable model catalogue:** provider/model names such as Qwen, GLM, Grok, Gemini, GPT and Claude are never permanent architectural roles. Platform Admin curates which discovered/configured models are Approved, Trial/Calibration or Disabled and may constrain them by organisation, role/capability, cost/risk or route policy. Ordinary users see only platform-approved models that are eligible through their organisation/API routes or their authorised personal connections, with `Auto` as the normal default and explicit model override available where policy permits. Council seats and agent roles select from eligible model routes by capability/policy/availability/cost/risk/evaluation evidence; changing the preferred model for Security, Correctness, Architecture, General Review or another role must be configuration/evaluation-driven, not a code change. Raw provider catalogues (for example the full OpenRouter catalogue) are an admin discovery surface, not the default end-user dropdown.

Before implementing any new provider, reverify its CURRENT official API, authentication, structured-output and subscription-delegation policy; do not rely on stale vendor assumptions.

## 11. What comes after this connection-administration slice

The Agent Bridge foundation is integrated into verified local `main` at `cb7597a36f4025a831ae09dd377714d698a6ba69`; confirm `origin/main` and GitHub CI are current before starting the next engineering slice.
The next engineering slice is concrete subscription-backed harness execution: Claude Code, Codex and Antigravity-style adapters behind the harness-neutral boundary, plus an early OpenRouter API route for external review/model access. Add each adapter incrementally under the same RED/GREEN, runner-auth, tenant, secret and fresh-review gates; do not collapse Harness, Connection and Runner into one abstraction.
Provider login/session credentials should remain on the authorised runner where practical. The platform receives safe connection/runner metadata, scoped task envelopes and dispatch/results, not personal passwords, cookies, refresh tokens or consumer web sessions.
Online Only now requires both owner platform presence and a healthy authorised bound runner. Persistent can survive owner sign-out only while a trusted persistent-capable bound runner remains healthy and policy allows it.
OpenRouter should be wired as an API execution route rather than masquerading as a subscription runner. Qwen 3.8 Max, GLM-5.2, Grok and Gemini can then participate in the review council through explicit provider/model routes while platform-owned verification remains authoritative.

After Agent Bridge: deeper ECC-native Engineering Studio productisation.
Preserve and progressively surface the inherited ECC capability estate — agents/skills, Continuous Learning, Unified Memory, team orchestration, evals, verification, browser QA/canary, context-budget, skill-compliance/health, benchmark optimisation, security and the MCP catalogue — through platform governance rather than recreating it.
The private `ecc-adapter` currently provides accepted ECC provenance only; future bounded slices add discovery/normalisation contracts while leaving mature ECC implementations in place wherever suitable.
Future product surfaces already agreed:
- terminal/CLI access (including VS Code integrated terminal) must be a first-class client of the same platform API/orchestrator, not a separate state owner;
- the web UI must be responsive/mobile-optimised across phone, tablet and desktop, with dense operational views collapsing into mobile-friendly layouts;
- the conversational product must support general chat and research as well as engineering, with the orchestrator selecting the appropriate agent/model/tools rather than forcing users to choose a coding model for every request.

## 12. Continuation instructions for the next agent

1. Read this handover first.
2. Read SRS v1.4, Technical Architecture v1.4, the approved shared-entitlements design and `docs/superpowers/specs/2026-08-12-ecc-native-capability-productisation-design.md`.
3. Inspect `git status`, current branch, HEAD, `main`, `origin/main` before changing anything.
4. Read the current task plan and archived implementer/reviewer reports.
5. Do not repeat completed questions or redesign locked decisions.
6. Resume from the first unfinished review/TDD gate, not from memory.
7. Maintain Docker PostgreSQL verification and independent multi-model review discipline; use Opus where available and transition external calibration to Qwen 3.8 Max + GLM-5.2 once OpenRouter is wired through the runtime.
8. Keep this handover's `Last updated`, current SHA/task, delivered items and next step current after each task closes.
## 13. Live checkpoint at document creation

Current feature HEAD: `7bb782f8 feat: expose project AI execution pool policy`.
Current branch: `feature/ai-connection-delegation-administration`.
Current main/origin-main: `e51a3c183fa9dc704cb756d471afb515a9c8aed6`.

Task 6 implementer is active.
Current worktree state at this checkpoint:
`?? platform/apps/api/test/ai-connections-http.integration.test.ts`
No Task 6 production file has been edited yet, so Task 6 is in the correct test-only RED preparation phase.
No Task 6 commit/report exists yet.

**Immediate next action:** let the Task 6 agent capture genuine HTTP RED, implement only `app.ts`/`server.ts`, reach GREEN, then run independent Opus review before Task 7.
### Live checkpoint update — Task 6 review

Task 6 implementation commit: `6b17ba98 feat: expose AI connection administration API`.
HTTP RED was 9/9 failing before routes; GREEN is 9/9 passing. Auth/runtime/server regressions and typecheck passed; one service test hit a host 10s timing flake and passed immediately in isolation.
Independent Opus review: SECURITY PASS, QUALITY PASS, but **1 Important finding** blocks Task 6 acceptance.

Important finding: PATCH project share currently accepts `mode` + usage-window fields together but performs them in two separate transactions. The first half can commit and the second half fail, leaving partial caller intent.
Fix round 1 is now active from `6b17ba98`.
Chosen minimal safe behavior for this slice: reject combined mode+window PATCH with 400 before any mutation; keep mode-only and window-only operations individually atomic.
The fix round also closes two minors: non-string mode must 400, and unknown body fields get an explicit "not accepted on this endpoint" validation message.

Do not treat Task 6 as complete until this fix is independently re-reviewed with zero Critical/Important findings.
### Live checkpoint update — Task 6 accepted

Task 6 commits:
- `6b17ba98 feat: expose AI connection administration API`
- `00381add fix: make AI connection share PATCH fail closed`

Task 6 final review: **0 Critical / 0 Important**.
Delivered authenticated endpoints for safe family catalogue, personal/org connection administration, project share controls and project execution-pool reads.
`createRuntimeApp()` now composes the real AI connection repository/service/session presence/trusted policy and restart persistence is covered.
Combined `mode` + usage-window PATCH is intentionally rejected with 400 in this slice so one HTTP request cannot partially commit across two transactions.
Invalid/non-string share modes 400; disallowed fields use an explicit "not accepted on this endpoint" error and never echo supplied values.

Task 6 is complete. Immediate next task: Task 7 AI Connections web administration UI, then Task 8 whole-slice verification/merge/push.
A pre-existing DB test-harness race after repeated schema resets was reproduced on baseline during fix verification; Task 8 fresh-volume full-suite execution is the mandatory gate to determine whether any harness correction is needed before merge.
### Live checkpoint update — Task 7 accepted

Task 7 commits:
- `7a001a49 feat: add AI connection administration UI`
- `2c687432 fix: expose durable owner AI connection share state`

Task 7 final independent Opus re-review: **SPEC PASS / SECURITY PASS / QUALITY PASS, 0 Critical / 0 Important**.
The initial UI review found one Important cross-layer defect: requester-owned shares were deduplicated out of `project_pool`, so the owner could not see/manage their durable share after refresh.
The fix preserves requester dedup while adding a safe optional `share` object to requester/project-pool entries containing only share id, mode and availability window.
The `/ai-connections` page now derives owner share state from `entry.share`, hydrates existing window values, preserves separate mode/window mutations, and loads project pools in parallel.
Fresh acceptance evidence on `2c687432`: UI contract 8/8, AI connection PostgreSQL integration 50/50, unit tests 115/115, typecheck pass, Next.js production build pass.
No migrations, HTTP routes, trusted policy, model gateway, runner/Agent Bridge or ECC files changed in this fix.
Non-blocking notes: `datetime-local` currently formats stored timestamps using UTC digits; there is no explicit one-click clear-both-window-bounds affordance yet. Backend authority and durable state are correct.

**Immediate next action:** Task 8 fresh-volume full platform/ECC/security verification, product smoke, whole-branch Opus review, then local merge to `main`, merged-main verification and GitHub `main` push if every gate is green.

### Live checkpoint update — Task 8 hardening and architecture clarification

Task 8 hardening commits now include:
- `84d40d6d fix: harden AI connection usage window controls`
- `a106700e test: harden AI connection usage window coverage`
- `6d3132c7 fix: harden AI connection datetime parser and tests`
- `104a6be0 fix: reject calendar-invalid offset-bearing AI connection dates`

The latest datetime fix has targeted GREEN evidence for 13 parser tests, 14 AI Connections HTTP integration tests, 11 UI contract tests, platform typecheck and `git diff --check`. It still requires fresh independent whole-branch review plus the complete Task 8 fresh-volume platform/ECC/security/product-smoke gates before merge readiness can be claimed.

The product architecture has also been clarified and documented as SRS/Technical Architecture v1.4: AI Engineering OS is the enhanced/productised evolution of ECC. Existing ECC learning, memory, skills, agents, MCPs, evals, verification, orchestration and related engineering capabilities are native assets to preserve and surface rather than duplicate. See `docs/superpowers/specs/2026-08-12-ecc-native-capability-productisation-design.md`.

**Latest Task 8 checkpoint:** fresh Docker/platform/ECC/security/product-smoke gates and final whole-branch review are green with 0 Critical / 0 Important. The remaining sequence is hardening commit → feature push/exact CI → local merge → merged-main verification → GitHub main push/CI verification.
### Final Task 8 completion checkpoint

Task 8 is complete.
- hardening commit: `ae72181df0860a68c16d176b04416b492df8e43a`;
- explicit merge commit: `69ebe73b549f2fa2c1e63a7fcf13c28771290a2d`;
- merge tree exactly matched the reviewed feature tree;
- feature CI run #95 and main CI run #96 both passed ECC Compatibility and Platform Verification;
- local merged-main verification passed 33 static, 131 unit and 185 integration tests plus typecheck, production Next/Turbopack build, dependency audit and ECC/security checks;
- feature branch and `.worktrees/ai-connection-delegation-administration` were removed after ancestry/containment was proven;
- `main` is now the sole source of truth for this slice.

**Immediate next action (16 Aug 2026):** Task 4 is accepted at `e5d0f430`. Begin Task 5 by classifying and reusing suitable inherited ECC execution/process/sandboxing capability behind the generic `ExecutionEnvironmentProvider`, then implement the minimal secure local provider under strict RED -> GREEN. Do not rebuild mature ECC execution capability in parallel. OpenSandbox remains the first managed provider behind this same boundary after the local provider contract is proven.
### Subscription-execution reconciliation — Task 5 accepted / Task 6 next

Task 5 is accepted at `52f037446cb67258e73b36c9f14437419655b49f` (`feat: define execution environment boundary`). The final exact-source blind-review packet is SHA-256 `e15fa8a1fa995e44892e7eabae5b8788db1617c65d947a4f7e1e2981bac723e7`.

The generic `ExecutionEnvironmentProvider` boundary is now proven for the trusted local route. It deliberately reuses ECC hardening invariants rather than creating a competing execution engine, and remains provider-neutral so OpenSandbox can implement the same contract as the first managed `trial` provider. OpenSandbox is still a separately gated dependent POC, not part of Task 5 acceptance.

**Immediate next action:** Task 6 — build the outbound-only runner loop over the accepted dispatch API + signed-envelope verifier + `ExecutionEnvironmentProvider`: claim -> verify -> prepare -> running -> execute -> checkpoint -> terminal. Start with RED tests for tampered/expired dispatch refusal, heartbeat/claim ordering, workspace-root enforcement, cancellation and provider-failure terminal evidence. No inbound listener or generic remote shell.
### Subscription-execution reconciliation — Task 6 accepted / Task 7 active

Task 6 is accepted at `832c8af48da0d94e7358bdfbaf2786094275ddd6` (`feat: execute governed dispatches through local runner`). The final exact-source blind-review packet is SHA-256 `39325e8f00f50d6913674d0ee8348f079cc62d6fd3d520b318e925b1a9bb4c71`.

The outbound runner now authenticates, heartbeats, claims, verifies the canonical signed envelope, enforces approved workspace roots, prepares through `ExecutionEnvironmentProvider`, runs only through an injected execution driver, emits bounded checkpoints, and records complete/fail/cancel lifecycle without exposing an inbound shell/listener. Local cancellation is irreversible only after provider-owned process cancellation succeeds; control-plane acknowledgement is retried idempotently. Task instructions are never converted into shell syntax by the runner.

### Subscription-execution reconciliation — Task 7 accepted / Task 8 active

Task 7 is accepted at final source head `ebb6b4ff75b377b528d40aeb38293a3131aba99e` (`fix: harden local harness execution boundaries`). Final packet SHA-256 is `b8d92fdbeabd86022b2ad2c27aa4b53bc545ad4b3456d0d3eb2670788528d8d2`; acceptance evidence is 85/85 focused, 33/33 static, 271/271 unit, 268/268 isolated PostgreSQL 17 integration, root/web TypeScript PASS, Harness Adapter Compliance PASS for 11 inherited adapters, Harness Audit 80/80 with zero failures and diff checks PASS. Gemini 3.7 Flash, Grok 4.6 and GLM 5.2 returned `NO FINDINGS`; Qwen 3.8 Max produced no content after 670s and is an availability failure only.

ECC breadth is part of the OS rather than a later optional integration backlog. The inherited estate includes broader harness/install/on-ramp surfaces beyond the initial three; agents, teams, skills, MCP/tools, memory, learning, evals, verification, security, browser QA and orchestration remain native product assets. Before each product slice, classify inherited capability as `REUSE`, `ADAPT`, `PRODUCTISE`, `SUPERSEDE`, `REFERENCE` or `EXCLUDE` and avoid parallel rebuilds.

Admin owns the complete capability catalogue. Ordinary users see only the harnesses/agents/skills/MCPs/workflows that Admin has explicitly released to their permitted population/scope and for which they remain otherwise eligible. Release never creates execution authority, delegation, write/execute operations, sharing, persistence or managed-sandbox eligibility by itself.

**Current Task 8 checkpoint (17 Aug 2026):** original frozen candidate `e13a5fb6f5a21f1be99c47a6bbb2bfe3be4c0356` received a fresh blind council. Grok specialist/general seats found material authority, concurrency, recall and acceptance defects; GLM added edge-state findings; Gemini returned PASS. Qwen 3.8 Max is retained only as historical availability evidence and has been replaced in the active fleet by DeepSeek V4 Pro. DeepSeek was made operational with reasoning disabled for large packets; its first exact-source claim was independently adjudicated `REJECTED` because inherited ECC and platform memory IDs share the same 132-character grammar.

The normalized original findings were independently adjudicated with GPT-5.5 before remediation. The hardening batch closes unresolved-material acceptance, engineer self-certification, revocation serialization, duplicate blind collection, workstream/agent assignment authority, SQL-bounded memory recall, durable review-material recovery, session-rebind CAS, scoped session/reviewer referential integrity, UTF-8 byte bounds and internal-vs-malformed reviewer-error classification. Old invalidated-run evidence remains immutable history by design.

**Fresh deterministic re-gate on the remediation working source:** 102/102 focused remediation tests; 33/33 static; 321/321 unit; 319/319 PostgreSQL integration across 38 files; root and web TypeScript PASS; Next.js 16.3/Turbopack production build PASS; production dependency audit 0 vulnerabilities; derivative catalogue 67 agents / 94 commands / 284 skills matches documentation; command registry PASS; Harness Adapter Compliance 11/11; Harness Audit 80/80 with 0 failures; Unicode/path/install/IOC validators and `git diff --check` PASS. The inherited ECC memory regression bundle has five Windows-host setup failures caused exclusively by `fs.symlinkSync` returning `EPERM`; those are recorded as non-gating host-capability evidence, not hidden or reported green. Platform ECC adapter/materialisation tests are GREEN.

**Immediate next action:** update/freeze the authoritative docs, commit the known remediation source, construct a fresh packet from that exact new SHA and run the blind fleet (Grok 4.6 specialist/general, DeepSeek V4 Pro, GLM 5.2, Gemini 3.7 Flash; GPT-5.5 only for material disputes). Task 8 remains unaccepted until that council is normalized/adjudicated and clear. Once accepted, immediately start Task 9: governed model/harness/agent/skill/MCP estate, Admin release/user eligibility, `Agent: Auto` plus specialist selection, and Studio text/voice/file/image/extensible-video interaction with governed artefact provenance/permissions.

## 12. Task 9 live continuation and v1.7 extensibility foundation — 20 August 2026

Task 8 is accepted and backed up on GitHub `main` at `7340f136a770f6d8441854dc4b9209c5336e354f`. The authoritative active worktree is `.worktrees/subscription-execution-reconciled` on `feature/subscription-execution-reconciled`. Task-9 source is deliberately dirty/uncommitted until its full reconciliation/gate/council acceptance completes.

Task 9 = **Governed Capability Estate / Admin Release / User Eligibility + Studio Multimodal + Requirements Assurance + provider-neutral AI Connections + ordinary-user UX convergence**. Substantial focused-green WIP already includes Platform/Organisation/Project authority separation, capability catalogue/release/eligibility, team/cohort population membership, dynamic ECC discovery/refresh, governed AI fallback, exact model-route selection, independent Studio Agent/Harness/Model resolution, governed multimodal artifacts/context, Requirements Assurance, durable finding closure/readiness and the Platform Admin Capability Estate surface.

Current evidence includes a serial Task-9 backend gate of **103/103 GREEN across 16 files**, Product Partner **17/17 GREEN**, ModelGateway **19/19 GREEN**, Assurance domain **9/9 GREEN**, Assurance repository **6/6 GREEN**, Requirements Assurance HTTP **4/4 GREEN**, Capability Estate Admin UI **4/4 GREEN**, and direct web TypeScript compilation GREEN. These are WIP evidence, not Task-9 acceptance.

The exact current TDD boundary is the Product Studio Requirements Assurance finding-decision UI. `platform/test/studio-requirements-assurance-ui.test.mjs` currently has the established three existing UI behaviours green and the new Product-Owner closure-control behaviour RED until `closeRequirementsAssuranceFinding()` → server action → Studio reason/resolve/dismiss controls are wired. Resume there before unrelated source edits, then continue the remaining Task-9 B work below.

New authoritative current-build documents are:
- `docs/product/AI-ENGINEERING-OS-EXTENSIBILITY-COMMERCIALISATION-FOUNDATION.md`;
- SRS v1.7, especially `EXT-FR-001..020`;
- Technical Architecture v1.7 section 28, especially 28.10 provider-neutral AI Connections and 28.11 ordinary-user-first Studio;
- `docs/superpowers/specs/2026-08-20-extensibility-commercialisation-foundation-design.md`;
- Task-9 plan/addendum in `docs/superpowers/plans/2026-08-15-subscription-execution-reconciliation.md`;
- provider-neutral connection/model discovery implementation plan in `docs/superpowers/plans/2026-08-20-provider-neutral-ai-connections-model-discovery.md`.

The newly approved provider requirement is a targeted Task-9 foundation, not a backend rewrite: OpenRouter is one provider family, not the architecture. The pending B seam is provider-neutral connection adapters + connection-scoped model discovery/route reconciliation + exact provider/model/connection identity/attribution. Bespoke integrations for every provider and a full provider marketplace remain deferred C work.

The ordinary-user UX rule is now authoritative: Product Studio/project setup stays conversation-first and guided, with sensible `Auto` defaults. Provider/Connection, Harness, Environment and similar expert controls use progressive disclosure, while Agents, Skills, MCPs and Connectors remain discoverable in clear project capability surfaces. A functional raw API/form is not sufficient evidence of product completeness if an ordinary user must understand infrastructure vocabulary to perform normal work.

These additions do not create a generic-platform detour. Engineering remains first-class; future Domain Packs are additive/versioned/capability-governed; AI Connections remain the ownership foundation; execution attribution is preserved without building FinOps; control/state and execution planes remain separate; Organisation remains the current tenant boundary; white-label is configuration/policy rather than customer source forks.
Sandbox/environment status: the generic `ExecutionEnvironmentProvider` and secure Local provider are implemented/accepted; Local is current/default. The concrete production `OpenSandboxProvider` adapter/POC remains pending. Future Local/OpenSandbox/BYOC/private providers remain interchangeable environment implementations subject to independent governance.

Native Harness status: AIOS owns the orchestration/runner/environment/harness abstraction and has governed Codex/Claude Code/Antigravity adapters. The richer first-party **AIOS Native Harness** remains roadmap/incomplete until separately implemented, gated and accepted.

Governed execution tuple remains independently composable: **Agent + Model/Route + Harness + Connection Ownership + Runner + Environment + Skills/Tools + Operation Grants + Entitlement/Budget**. `Auto` uses policy ranking; explicit selections are exact-or-fail-closed. Current Product Partner API turns may persist Agent/Harness as governed metadata because that path does not yet operationally consume them; Engineering execution will.

Before Task-9 acceptance, every new extensibility/commercialisation requirement must receive normal implementation status plus A/B/C timing: A = already satisfied/prove; B = only expensive-to-retrofit foundational change now; C = explicitly deferred future capability. A B item must document the breaking-migration, security/authority, irrecoverable-attribution, customer-fork or major-boundary reason for implementing it now.

Do **not** build Scientific Research/Legal/Strategy/Data domains, full billing/FinOps, white-label administration, bespoke adapters for every model provider, a full commercial BYOC/provider-marketplace administration suite, speculative parent-enterprise tenancy or a generic epistemic engine merely to satisfy v1.7. The provider-neutral AI Connection/discovery/connection-scoped-route foundation and ordinary-user UX convergence are explicitly required Task-9 B work. Continue the current coherent slice, then include these requirements in the mandatory full pre-acceptance reconciliation.
## 25 August 2026 continuation update — Task 9 remains WIP

Fresh continuation evidence after resuming from the 21 August handover:

- Production AI Connection runtime composition is now wired in `platform/apps/api/src/server.ts` using shared `AIConnectionRepository`, `AIConnectionSecretRepository`, provider adapter registry, configured managed-secret protector/resolver, `ConnectionModelRouteCatalogue`, `CapabilityEstateService` and `AIConnectionService` dependencies. The preserved composition RED is now `3/3 GREEN`.
- The strict root + web TypeScript gate is GREEN. Task-9 exact-optional/capability-shape errors uncovered during the composition gate were fixed without weakening runtime contracts.
- Focused provider/BYOC/model-gateway hardening is `79/79 GREEN`, including exact connection-scoped model discovery/resolution, provider adapters, managed-secret crypto/runtime and ModelGateway regressions.
- Platform Admin tenant-scoped eligibility authority was reproduced as a real HTTP-boundary defect (`403` for a platform-only admin), then fixed without weakening tenant authorization. Capability Estate authority regression is `11/11 GREEN`; ordinary members remain denied.
- Requirements Readiness is now an executable project lifecycle gate. `PATCH /projects/:id/stage` requires Product Owner authority and fails closed for `engineering_planning` or later unless the exact current Product Requirements Assurance state is `ready`. No-review / blocked / insufficient evidence returns conflict; a ready exact-state review permits the transition and emits `project.stage.changed` audit evidence. Requirements Assurance HTTP regression is `5/5 GREEN`.

These are intermediate Task-9 hardening results only. Task 9 is still intentionally uncommitted/unaccepted. Remaining major boundaries include durable execution provenance/evidence convergence, v1.7 Studio progressive-disclosure/connection-aware model UX, Domain Pack seam reconciliation, full deterministic gate, exact-source blind council/adjudication and acceptance.

### 25 August 2026 — accepted feature-branch checkpoints

To keep Task 9 recoverable and prevent the authoritative worktree from accumulating one oversized dirty boundary, verified coherent units are now checkpointed on `feature/subscription-execution-reconciled`; only whole-Task-9 acceptance remains eligible for promotion to `main`.

- `269f8646` — `feat: checkpoint task 9 backend governance and byoc`
  - Capability Estate / Platform Admin authority foundations
  - multimodal Studio backend + semantic normalization/object storage
  - Requirements Assurance + exact-state engineering readiness gate
  - provider-neutral AI Connections/BYOC, connection-scoped routes and managed secrets
  - Product Partner / dispatch provenance hardening
- `411f91d1` — `feat: checkpoint task 9 studio and capability admin`
  - conversation-first Studio progressive disclosure for Agent/Model/Harness
  - exact route identity retained while routes are grouped as AIOS Managed / personal provider / organisation / team
  - global Capability Admin tenant release/eligibility controls
  - Platform Admin team/cohort population authority with explicit organisation targeting
  - Requirements Assurance finding closure UI and multimodal composer web contracts

Fresh evidence for the second checkpoint: Capability authority integration `12/12 GREEN`; Studio/Admin static contracts `17/17 GREEN`; Studio composer helper `6/6 GREEN`; root + web TypeScript PASS; Next production build PASS. Task 9 remains WIP/unaccepted.
- `c7f0f75c` — `feat: add minimal domain pack descriptor seam`
  - immutable declarative Domain Pack identity/version/publisher/source boundary
  - bounded capability/agent/workflow/artifact/evidence/review/tool/execution/schema/UI contribution metadata
  - exact-version registry that rejects silent replacement
  - contributed capabilities project only into Capability Estate `discovered + unverified`; no release/eligibility/authority is implied
  - full domain regression `156/156 GREEN`; TypeScript PASS

## 26 August 2026 — Task-9 mandatory extensibility/commercialisation reconciliation

This matrix is evidence-based against the current feature-branch source through `8390d5cd`. `A` means already satisfied/prove, `B` means expensive-to-retrofit foundation implemented now, and `C` means explicitly deferred product capability. A row may split A/B/C where the approved requirement intentionally spans present and future product scope.

| Requirement | Status | Timing | Current evidence / boundary |
| --- | --- | --- | --- |
| Domain-neutral primitives | implemented + proven | A | Existing organisation/project/session/memory/evidence/orchestration primitives remain reusable underneath Engineering; no second domain model introduced. |
| Domain Pack boundary | implemented + proven | B | `c7f0f75c`; immutable declarative `DomainPackDescriptor`/exact-version registry; contributions enter Capability Estate only as `discovered + unverified`. Full Domain Packs/marketplace remain C. |
| Tenant isolation | implemented + proven | A | Organisation remains canonical tenant/security boundary; Capability Estate/AI Connection/Assurance/database tests preserve organisation/project scoping. Enterprise-parent tenancy is C. |
| Entitlements | implemented for current connection entitlement ownership; broader budget product deferred | A / C | Approved shared-entitlement design defines an AI Connection as one authenticated entitlement/managed credential source. Personal/org ownership, project delegation and usage windows are durable. Full organisation/project/provider budget administration and billing/FinOps are C. |
| Credential ownership | implemented + proven | B hardening | `269f8646`, `a1785e33`; personal/organisation connection ownership, JIT credential resolution, encrypted managed credentials and safe external-secret references. Raw credentials never enter normal read models. |
| Execution provider extensibility | implemented + proven seam | A | Existing `ExecutionEnvironmentProvider` + secure Local provider and provider-neutral runner contracts. Concrete OpenSandbox adapter remains C/pending separate approval. |
| Usage attribution | implemented for currently resolved dimensions; future dimensions not fabricated | B hardening / C product analytics | `269f8646`; Product Partner preserves provider/model/exact route/connection owner/usage/cost type; dispatch evidence preserves requester/project/task/connection/runner/route/harness/outcome. Environment/budget refs are recorded only when a future execution path actually resolves them. Full analytics/FinOps is C. |
| White-label boundary | architecture satisfied; product administration deliberately deferred | A / C | One-codebase/configuration-policy rule is locked in SRS/architecture. White-label admin, custom domains, SAML/SCIM/reseller/billing catalogue are C. |
| Control/execution separation | implemented + proven | A | Canonical state/policy/audit/memory remain platform-side; models/harnesses/runners/environments are replaceable execution resources. Local execution environment remains default. |
| BYOC state ownership | implemented + proven | B | AI Connections own credential/provider/account state; connection-scoped discovered routes reconcile into Capability Estate and never become canonical project state. |
| Epistemic/provenance extensibility | implemented stable provenance seam; generic epistemic engine deferred | A / C | Existing artifact, knowledge, assurance, review and execution evidence keep stable subject/source/reference provenance. Generic Claim/Epistemic reasoning system is C. |
| Extension governance/security | implemented + proven | B | Capability Estate separates discovery/governance/verification/release/eligibility/technical authority; Domain Pack descriptors cannot grant tenant/credential/execution authority. |
| Independent governed execution tuple | partial by path, intentionally truthful | A / B / future | Agent/Model/Harness are independently selectable; connection/route authority is exact; runner/environment/operations are separately governed for engineering dispatch. Product Partner API turns retain Agent/Harness as selection metadata because those dimensions are not operationally consumed there. Rich first-party AIOS Native Harness remains future work. |
| Generic Assurance substrate | implemented + proven | B | `269f8646`; generic versioned Assurance run/finding/readiness persistence and service contracts. |
| Product Requirements Assurance reviewer | implemented + proven | B | Independent Requirements Reviewer agent capability and `product_requirements_v1` profile; findings remain non-canonical evidence. |
| Requirements Readiness exact-state gate | implemented + proven | B | `269f8646`; `engineering_planning` or later fails closed unless the exact current Requirements Assurance state is `ready`; stage transition is audited. |
| Reviewer model independence/capability eligibility | implemented + proven | B | Requirements reviewer agent and model route resolve independently from Product Partner and must be governed/released/eligible. |
| Assurance provenance / no silent canonical mutation | implemented + proven | B | Exact target digest, invalidation, reviewer route/agent provenance and separate finding closure; reviewer output never silently mutates Product Knowledge. |
| Multi-provider BYOC/BYOM | foundation implemented + proven | B / C | `269f8646`, `a1785e33`; provider-neutral adapter + OpenAI-compatible/reference family, secure personal/org onboarding and discovery. Exhaustive native named-provider adapters/provider marketplace are C. |
| Connection-scoped model catalogue | implemented + proven | B | Migration `016`, deterministic connection route identity, stale/unavailable reconciliation, exact Capability Estate `sourceRef`, project route catalogue. |
| Exact provider/model/connection routing | implemented + proven | B | Explicit route is exact-or-fail-closed; scoped dynamic resolver is installed only after Capability Estate authorises the selected exact route; no global credential resolver. |
| Managed encrypted credentials | implemented + proven | B | Migration `017`; AES-256-GCM managed-secret store, opaque `dbsecret:` refs, deployment master key outside PostgreSQL, JIT decrypt and revocation. |
| Delegated execution authority | implemented + proven | A / prior foundation | Personal connection Do-Not-Share default, project `online_only`/`persistent` delegation, runner availability and provider/harness policy gates remain independently enforced. |
| Usage/cost attribution | implemented for known current facts; comprehensive commercial costing deferred | B hardening / C | ModelGateway/Product Partner retain cost type and token usage plus exact route/connection provenance. Dispatch evidence retains governed execution identity. Price normalisation, invoices, cost centres and FinOps dashboards are C. |

### Reconciliation decision

No additional speculative billing/entitlement table is justified for Task 9. The approved 11-August shared-entitlement design explicitly defines an AI Connection as the current authenticated entitlement/managed credential source. A separate commercial budget object is not yet resolved by any current execution path, and existing append-only execution evidence can carry bounded metadata when such a policy exists later. Creating a billing/budget subsystem now would therefore be C work, not a justified B retrofit.

The remaining Task-9 acceptance work is evidence/gating rather than a newly discovered foundational product subsystem: final documentation cleanup, accessibility/responsive/browser verification of the ordinary-user path, complete deterministic gate, exact-source fingerprint, blind council, adjudication/remediation, re-gate/re-review, then whole-Task-9 acceptance and promotion policy.

### 26 August 2026 — AIOS-native V2B-derived hardening checkpoints

The approved V2B review has now been selectively incorporated into AIOS without embedding V2B as a second platform layer:

- `13e4743c` — `feat: add trusted context and runtime capability primitives`
  - context trust classes and source-of-truth arbitration;
  - `RuntimeCapabilityManifest` distinguishes declaration from observed availability;
  - existing `AgentHandoff` extended with goal/decisions/pending questions/next actions/source revision;
  - full domain regression `163/163 GREEN`, TypeScript PASS.
- `126331fb` — `feat: add durable trusted execution evidence envelope`
  - generic `EvidenceEnvelope` over existing persistence rather than a new evidence database;
  - Product Partner audit persists trusted exact-route/connection/usage attribution;
  - Product Partner `18/18 GREEN`, evidence-envelope `3/3 GREEN`, TypeScript PASS.
- `6913fb11` — `feat: expose governed runner capability manifests`
  - tenant/ownership-scoped `GET /ai-runners/:runnerId/capabilities`;
  - declared runner capabilities exposed without runner credential material;
  - runner HTTP regression `9/9 GREEN`, TypeScript PASS.

Review Council sealing/lease/recovery mechanics were inspected and already satisfy the useful V2B patterns: SHA-256 source/evidence/packet seals, immutable run/assignment identity, collection leases, execution claims, stale recovery, durable reviewer state, adjudication and rechallenge are existing AIOS-native behavior. No duplicate council subsystem was added.

A separate V2B-style `Mission` table was deliberately not introduced. AIOS already owns orchestration through Project/Workstream/Task/EngineeringSession/Dispatch plus ReviewRun lifecycles. The useful Mission semantics are carried through structured handoffs, acceptance/evidence and durable checkpoints; a new Mission/Objective entity requires a future distinct product need.

The authoritative product relationship has also been corrected in the SRS/architecture: AI Engineering OS is a separate product platform that evolved from useful ECC capabilities and selectively incorporates approved ECC updates. `main` is the AIOS product line; `ecc-seed`/`ecc-upstream` and the read-only `upstream` remote exist for provenance/comparison and controlled selective adoption, not as canonical AIOS state.

## 28 August 2026 — Task-9 pre-council deterministic gate checkpoint

The authoritative feature branch remains `feature/subscription-execution-reconciled`. Accepted implementation checkpoints through `6913fb11` are preserved. The current reconciliation boundary adds only authoritative documentation updates, stale-test expectation corrections, race-safe Review Council test hardening, and Unicode BOM normalization; generated build/version output is excluded.

Fresh deterministic evidence on the normalized current source:

- static/contracts: `57/57 GREEN`;
- non-DB/unit: `428/428 GREEN` across 53 files;
- serialized PostgreSQL integration: `63/63 files GREEN`;
- platform + web TypeScript: PASS;
- Next.js 16.3/Turbopack production build: PASS;
- `npm audit --audit-level=high`: 0 vulnerabilities;
- root agent/hook/command/skill/install/rule/workflow-security validation: PASS;
- ECC derivative catalogue and command registry checks: PASS;
- Unicode safety, no-personal-path and supply-chain IOC scans: PASS;
- source ESLint with generated `.next/**` excluded: PASS;
- changed/new Task-9 Markdown documents: PASS;
- SRS Markdown: PASS with only the document's pre-existing multi-H1/heading-increment conventions (`MD025`, `MD001`) excluded;
- `git diff --check`: PASS before checkpoint staging.

Gate findings remediated during this pass:

- stale migration-order expectations were updated from the Task-8 chain through `012` to the accepted Task-9 chain through `017`;
- the AI Connection HTTP security regression was corrected to reject a genuinely unsupported secret-shaped field now that `apiKey` is an approved write-only managed credential input;
- Review Council stale-claim recovery test expiry was made race-safe without weakening the database claim invariant;
- 12 leading UTF-8 BOM bytes rejected by repository Unicode policy were removed with no semantic source change;
- repeated `resetDatabase()` timeouts/connection refusals were traced to the isolated AIOS Postgres test container and destructive schema-reset cost; affected files passed cleanly in isolation and the complete serial 63-file gate is green.

The broad root `npm run lint` command is not used as Task-9 acceptance evidence because it traverses generated `platform/apps/web/.next/**`, nested `platform/node_modules/**`, and historical Markdown outside the changed Task-9 boundary. Its source-equivalent checks were run explicitly and are green as listed above.

Next boundary: checkpoint-commit this exact accepted reconciliation source, seal the resulting commit/source fingerprint, run the blind Review Council on that exact source/evidence packet, independently adjudicate findings, reproduce/remediate any valid defects, re-gate changed source, and only then make the Task-9 acceptance/promotion decision.

## 29 August 2026 — FS V2B adaptation tranche started

The revised FS V2B implementation was re-reviewed against AIOS checkpoint `978c838590b1ada358f4ecc56cd2ce0bc69506d5`. The adaptation plan is documented in `docs/superpowers/plans/2026-08-29-v2b-operational-continuity-hardening.md`. AIOS continues to adapt useful mechanics into existing Project/Task/EngineeringSession/Dispatch/Capability Estate/Review Council/Evidence architecture; FS V2B is not embedded as a second platform.

P0.1–P0.3 implementation status:

- Durable Engineering Recovery Checkpoint is implemented over existing session-private Collaborative Memory with typed schema `engineering_recovery_checkpoint_v1`; no new persistence subsystem or migration was introduced.
- Portable Project Continuation Context is reconstructed from live Engineering Session state plus the latest stored recovery checkpoint. Live session state remains authority for current execution selection; stored source revision remains contextual and must be re-observed before use as current truth.
- Runtime Capability Manifest now separates availability from health/retryability. Capability observations can carry `healthy`, `degraded`, `temporarily_unhealthy`, `unavailable`, or `unknown` health plus `retryable`, `non_retryable`, or `approval_required`, supported flag, safe reason code and evidence reference.
- Runner declarations remain `declared` with health `unknown`; declaration does not prove current availability/health.

Fresh focused evidence: Engineering Session integration `18/18 GREEN`, Runtime Capability Manifest `3/3 GREEN`, combined focused tranche `21/21 GREEN`, platform + web TypeScript PASS.

Next FS V2B adaptation boundary: P0.4 automatic Review Council evidence material collection using existing `EvidenceEnvelope` and native Review Council source/evidence/packet sealing. No second council or evidence store will be introduced.

### 29 August 2026 — FS V2B P0 continuity tranche complete

P0.4 automatic Review Council evidence-material assembly is implemented without changing council persistence. AIOS now builds deterministic `review_council_evidence_material_v1` from applicable source seal, gate results, runtime capability observations, execution `EvidenceEnvelope` records, requirements references and acceptance criteria, then passes that exact canonical material through the existing Review Council source/evidence/packet digest and durable material path.

Fresh evidence for P0.4: Review Council service integration `38/38 GREEN`, Review Council evidence-domain tests `2/2 GREEN`, combined `40/40 GREEN`, platform + web TypeScript PASS.

FS V2B P0 status is therefore complete:

1. Durable Engineering Recovery Checkpoint — implemented.
2. Portable Project Continuation Context — implemented.
3. Capability availability + health + retryability — implemented.
4. Automatic Review Council evidence-material assembly — implemented.

No second Mission, worker, council, evidence or capability-governance subsystem was introduced.
