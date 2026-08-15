# AI Engineering OS — Living Handover

**Purpose:** Operational continuation document for a new ChatGPT/Claude/Codex agent if the current thread ends.
**Last updated:** 15 August 2026, after Agent Bridge foundation local verification and independent review; the feature remains unmerged.
**Repository:** `ArowuTest/ai-engineering-os`
**Local repo:** `<LOCAL_REPO_ROOT>`
**Current source-of-truth branch:** `main`
**Current accepted Agent Bridge feature:** `feature/agent-bridge-subscription-harnesses` @ `de947859f57cdfa5806934efc33fae1afe969e86` (locally verified/reviewed; not yet merged or pushed).
**Task 8 product merge SHA:** `69ebe73b549f2fa2c1e63a7fcf13c28771290a2d` (subsequent documentation-only closeout commits may advance `main`).

## 1. Product principle

AI Engineering OS is an "AI-powered software company in a box".
The web application owns the project; models, agents and harnesses are replaceable workers.
AI Engineering OS is the enhanced, privately branded and productised evolution of the inherited ECC repository. ECC agents, skills, commands, workflows, Continuous Learning v2.1, Unified Memory, MCP definitions, evals, verification, security and autonomous-engineering patterns are native product assets, not an external capability package to rebuild later.
The default rule is **reuse before rebuild; preserve before replace; generalise before discard**. `platform/` adds SaaS/product governance, tenancy, durable state, routing, RBAC, audit, entitlement controls and UI around that inherited engineering estate.
Canonical project state must survive provider switches, sign-out, runner loss and individual collaborators leaving.

Keep these concepts separate:
Provider → Model → Execution Route → Harness → Agent → Skill → Tool/MCP → Connection → Runner → Orchestrator.
AI Engineering OS is the master orchestrator. Hermes/Codex/Claude Code/Antigravity are execution surfaces, not canonical state owners.

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

**Immediate next action:** commit the bounded Task 8 hardening, push the feature branch for exact CI, merge locally to `main` only after CI is green, reverify merged `main`, then push/verify GitHub `main`.
## 6A. Agent Bridge foundation - accepted locally (15 August 2026)

Implementation plan: `docs/superpowers/plans/2026-08-14-agent-bridge-foundation.md`.
Accepted feature branch: `feature/agent-bridge-subscription-harnesses` at `de947859f57cdfa5806934efc33fae1afe969e86`.
The branch is locally accepted but has not yet been merged to `main` or pushed as the completed foundation.

Accepted implementation sequence:
- plan: `76ba0e9a`;
- runner contracts and domain hardening: `93acdaf1`, `d74b5642`, `d0f172a4`;
- runner persistence and revocation hardening: `605eb36b`, `f0448b00`;
- runner governance/service hardening: `ff74f40c`, `395cace0`;
- runner HTTP/runtime boundary: `df2321be`, `94b65ad7`;
- runner-aware project execution pools: `643ee38b`;
- harness-neutral execution boundary and hardening: `f2770c20`, `f1a794e9`, `0b78fc36`, `b8aeabdb`;
- whole-branch heartbeat chronology remediation: `de947859`.

The foundation now provides durable runner ownership/status/trust/capability contracts and scoped `RunnerTaskEnvelope`s; migration `007_ai_runners.sql`; organisation-scoped runner/binding/credential persistence; hash-only platform runner credentials; RBAC administration; trust/disable/revoke/rotate; credential-authenticated heartbeat and runner authentication; separate user-session and runner-bearer HTTP paths; runtime composition; real runner-aware requester -> project_pool -> organisation connection eligibility; Online Only/Persistent semantics; and a provider-neutral harness request/result/event boundary with scoped envelope validation and recursive credential-safe metadata handling.

Final whole-branch security review identified one real Important clock-skew defect: an allowed first heartbeat from a behind-clock runner could violate PostgreSQL `last_seen_at >= created_at`. A deterministic RED reproduced SQLSTATE `23514`; `de947859` clamps only the persisted `seenAt` to the immutable runner `createdAt` floor, preserving the five-minute skew allowance and stale/equal replay protection. The corrected-source Grok 4.6 security review and an isolated Gemini 3.7 Flash general review both returned `NO FINDINGS` / zero blockers.

Final verification on `de947859`:
- fresh isolated PostgreSQL 17 volume: 33/33 static + 167/167 unit + 238/238 integration = 438/438 tests GREEN;
- exact heartbeat remediation staged gate: platform/web typecheck PASS and 53/53 runner/database/server tests GREEN;
- Next.js 16.3 production build PASS;
- production dependency audit: 0 vulnerabilities;
- Harness Adapter Compliance PASS (11 adapters);
- Harness Audit 80/80 with 0 failing checks;
- supply-chain IOC scan PASS across 397 files;
- platform audit exited 0; its only attention item was GitHub-fetch authentication because the local `gh` CLI is unavailable;
- migrations 001-006 are Git-blob-identical to `main`; only migration 007 is new;
- provider login/session material is absent from runner persistence, audit metadata and normal read responses; runner platform credentials are plaintext only in the explicit one-time register/rotate response and are hash-only at rest.

The long inherited root ECC `npm test` run has so far observed two README-only assertions in the Itô Compute and Unified Memory surfaces while continuing through many other passing checks. `README.md` is the exact same Git blob as `main`, and those surfaces are unchanged by Agent Bridge; direct adapter, harness and IOC compatibility/security gates are green. Treat those README assertions as inherited baseline debt, not an Agent Bridge regression.

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
Do not hard-code future providers into the initial Product Studio OpenAI/Claude/Gemini/Auto selector unless product requirements change.
Before implementing any new provider, reverify its CURRENT official API, authentication, structured-output and subscription-delegation policy; do not rely on stale vendor assumptions.

## 11. What comes after this connection-administration slice

The Agent Bridge foundation is complete on the accepted feature branch and is ready for integration into `main` after the documented local-main verification/push sequence.
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

**Immediate next action:** create/review the Agent Bridge + subscription-harness implementation plan, including an early OpenRouter route for Qwen 3.8 Max / GLM-5.2 engineering-review calibration, then implement under the existing TDD/Docker/security gates.
