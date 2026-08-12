# AI Engineering OS — Living Handover

**Purpose:** Operational continuation document for a new ChatGPT/Claude/Codex agent if the current thread ends.
**Last updated:** 12 August 2026, during AI Connection / Delegation Task 6.
**Repository:** `ArowuTest/ai-engineering-os`
**Local repo:** `C:\Users\sanus\Desktop\AI-Engineering-OS`
**Current source-of-truth branch:** `main`
**Current remote/local main SHA:** `e51a3c183fa9dc704cb756d471afb515a9c8aed6`

## 1. Product principle

AI Engineering OS is an "AI-powered software company in a box".
The web application owns the project; models, agents and harnesses are replaceable workers.
Canonical project state must survive provider switches, sign-out, runner loss and individual collaborators leaving.

Keep these concepts separate:
Provider → Model → Execution Route → Harness → Agent → Skill → Tool/MCP → Connection → Runner → Orchestrator.
AI Engineering OS is the master orchestrator. Hermes/Codex/Claude Code/Antigravity are execution surfaces, not canonical state owners.

## 2. What is already merged to `main`

The routing foundation + review-first Product Knowledge extraction slice is complete and merged.
Merge commit: `e51a3c18 merge: routing foundation and review-first extraction`.
GitHub `main` passed Platform Verification and ECC Compatibility on that exact merge.Delivered on `main`:
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
- Migrations on `main`: 001–005 only.
- Full local smoke and Docker PostgreSQL verification completed before merge.

## 3. Approved architecture for the current phase

Design: `docs/superpowers/specs/2026-08-11-extensible-ai-execution-routing-and-shared-entitlements-design.md`.
SRS and Technical Architecture are v1.3.

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

## 4. Current implementation branch / worktree

Branch: `feature/ai-connection-delegation-administration`
Isolated worktree:
`C:\Users\sanus\Desktop\AI-Engineering-OS\.worktrees\ai-connection-delegation-administration`

Implementation plan:
`docs/superpowers/plans/2026-08-12-ai-connection-delegation-administration.md`

Current accepted commits on the feature branch:
- `7ae5d5df` — docs: plan AI connection delegation administration
- `4947db2f` — feat: define AI connection policy contracts
- `5b4ebbbe` — feat: persist AI connections and project delegation
- `086f4fd8` — feat: govern AI connection administration
- `f8ad851b` — fix: fail closed on ambiguous AI connection credentials
- `004dc663` — feat: add project-scoped AI connection sharing
- `7bb782f8` — feat: expose project AI execution pool policy

Tasks 1–5 are implemented and independently approved with zero Critical/Important findings.
Task 6 is currently in progress and has not yet been accepted or committed.

## 5. What Tasks 1–5 delivered

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

## 6. Task 6 — current work

Goal: expose authenticated AI Connection HTTP APIs and compose the real service in `createRuntimeApp()`.
Planned endpoints include safe family catalogue, connection list/register/revoke, project share controls and project execution-pool read.
HTTP must reject sensitive/policy body fields such as `providerToken`, `password`, `cookie`, `refreshToken`, `delegatable`, and `ownerUserId` rather than silently ignore them.
Actor/user identity comes only from the existing authenticated session/project identity.Task 6 RED/GREEN evidence must use Docker PostgreSQL:
`postgres://engineering_os:engineering_os@127.0.0.1:55432/engineering_os_test`.
It must prove unauthenticated/cross-tenant/RBAC failures, safe response shapes, first-share Online Only, runtime composition and persistence across runtime restart.

After Task 6: Task 7 adds the server-rendered AI Connections administration UI.
Task 8 performs fresh-volume Docker, full tests/typecheck/build/audit/ECC/security, whole-branch review, then local merge to `main`, reverify merged `main`, and push GitHub `main`.

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

The development agents are launched through the locally installed Claude Code CLI using the user's authenticated Claude subscription.
Typical invocation uses `--model opus --effort medium` (high effort for whole-branch review), `--permission-mode bypassPermissions`, `--no-session-persistence`, `--no-chrome`, and a strict empty MCP config.

Important: the empty MCP config and `--no-chrome` apply ONLY to that individual Claude Code subprocess.
They do not change the user's Claude Desktop/Claude app, global MCP configuration, or Chrome integration.
The strict empty MCP setup was introduced because inherited MongoDB/Chrome MCP startup was delaying isolated backend subagents.Task briefs, implementer reports, review briefs and review reports are archived outside the repo at:
`C:\Users\sanus\Desktop\AI-Engineering-OS-SDD-archive\2026-08-12-ai-connection-delegation-administration\`
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
Preserve `ecc-seed` and `ecc-upstream`; never merge `ecc-upstream` wholesale.Dependabot branches are proposals and must be reviewed independently before merge.

## 10. Future providers/models

The architecture is deliberately open-ID and route/capability driven.
Adding Kimi/Moonshot, Grok/xAI, Mistral, DeepSeek or another provider should not require another ownership/domain migration.
Add trusted provider/family policy and a thin adapter/configuration where request/response semantics differ.
Do not hard-code future providers into the initial Product Studio OpenAI/Claude/Gemini/Auto selector unless product requirements change.
Before implementing any new provider, reverify its CURRENT official API, authentication, structured-output and subscription-delegation policy; do not rely on stale vendor assumptions.

## 11. What comes after this connection-administration slice

Next major slice: Agent Bridge / runner execution.
Add durable runner registration/heartbeat/trust/revocation and real subscription-backed harness adapters incrementally (Codex, Claude Code, Antigravity, then future harnesses).
Provider credentials should remain on the authorised runner where practical; the platform receives safe connection/runner metadata and dispatch capability, not personal passwords/cookies.
Online Only then requires both owner platform presence and authorised personal runner online.
Persistent allows use after owner sign-out only when an authorised persistent runner remains reachable and trusted policy allows it.

After Agent Bridge: deeper ECC Engineering Studio integration.
Reuse the inherited ECC agent/skill substrate (Planner, Architect, Engineer, Reviewer, Security Reviewer, DB Reviewer, TDD, etc.) through the private `ecc-adapter` rather than coupling agents to providers.
The private `ecc-adapter` currently provides accepted ECC provenance only; future work must add agent/skill enumeration, task translation, session normalization and verification-result normalization.

## 12. Continuation instructions for the next agent

1. Read this handover first.
2. Read SRS v1.3, Technical Architecture v1.3 and the approved shared-entitlements design.
3. Inspect `git status`, current branch, HEAD, `main`, `origin/main` before changing anything.
4. Read the current task plan and archived implementer/reviewer reports.
5. Do not repeat completed questions or redesign locked decisions.
6. Resume from the first unfinished review/TDD gate, not from memory.
7. Maintain Docker PostgreSQL verification and independent Opus review discipline.
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