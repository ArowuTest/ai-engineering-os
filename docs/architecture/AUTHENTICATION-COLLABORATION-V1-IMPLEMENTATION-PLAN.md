# Authentication & Collaboration V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the test-driven execution workflow task-by-task.

**Goal:** Replace temporary identity headers with a real V1 account/invitation/session/membership foundation while preserving local-development compatibility behind an explicit flag.

**Architecture:** PostgreSQL owns users, memberships, invitations and opaque session hashes. Domain code owns validation and cryptographic token/password helpers; repositories own tenant-scoped persistence; Fastify middleware resolves authentication; Product Studio continues to consume a normalized identity rather than provider-specific or browser state.

**Tech Stack:** TypeScript, Node.js crypto, Fastify, PostgreSQL 17, Vitest, Next.js.

## Global Constraints

- Login is User ID + password only; no email in V1.
- Invitation keys are single-use and hash-only at rest.
- Default invitation TTL is 30 minutes and policy configurable.
- Revocation must take effect immediately.
- Organisation and project roles are separate.
- Material access changes require append-only audit evidence.
- Never place passwords, invitation plaintext or session plaintext in audit/log data.

---
## Task 1 — Authentication domain primitives

**Create:** `platform/packages/domain/src/auth.ts`
**Modify:** `platform/packages/domain/src/index.ts`
**Test:** `platform/packages/domain/test/auth.test.ts`

- Write RED tests for User ID normalization/uniqueness shape, account state, organisation/project roles and invitation lifecycle.
- Add password hashing/verification using Node's memory-hard `scrypt` with random salt.
- Add random invitation/session token generation plus SHA-256 token hashing for database lookup.
- Add TTL validation and absolute-expiry calculation; default to 30 minutes when omitted.
- Verify consumed/expired/revoked/replaced invitations cannot be redeemed.
- Run domain tests and strict typecheck.

## Task 2 — PostgreSQL authentication schema and repositories

**Create:** `platform/packages/database/migrations/003_auth_collaboration.sql`
**Create:** auth/user/membership/session repository modules under `platform/packages/database/src/`
**Modify:** database exports and test helpers.
**Test:** repository integration suites.

- Add `users`, `organisation_memberships`, `project_memberships`, `invitations`, `auth_sessions`.
- Add organisation invitation-TTL policy with a 30-minute default.
- Enforce unique normalized User ID.
- Store invitation/session hashes only; never plaintext token columns.
- Add indexes for active session and invitation lookup.
- Prove organisation/project scoping and immediate membership revocation against real PostgreSQL.
## Task 3 — Transactional auth service and audit

**Create:** `platform/apps/api/src/auth-service.ts`
**Modify:** `DatabaseUnitOfWork`, audit usage and API composition.
**Test:** `platform/apps/api/test/auth-service.integration.test.ts`

- Create invitation inside one transaction with its `auth.invitation.created` audit event.
- Redeem invitation transactionally: verify hash/status/expiry, create user, memberships and mark invitation consumed.
- Login verifies User ID/password and creates a hashed opaque session.
- Logout/revoke updates session state without retaining plaintext.
- Suspend/removal operations revoke affected sessions in the same material-operation flow.
- Force audit failures in tests and prove access mutations roll back.

## Task 4 — Authentication middleware and HTTP API

**Modify:** `platform/apps/api/src/app.ts`, `server.ts`.
**Create:** focused auth identity/middleware module.
**Test:** `platform/apps/api/test/auth.integration.test.ts`

- Add invitation creation, redemption, login, logout and `/auth/me` endpoints.
- Add admin user listing/status endpoint and project membership grant/remove endpoints.
- Require session authentication for protected routes.
- Check organisation and project role on each request rather than trusting token claims.
- Preserve `x-organisation-id` / `x-user-id` only when `ALLOW_DEV_IDENTITY_HEADERS=true`.
- Return 401 for invalid/revoked sessions and 403 for authenticated-but-unauthorised access.
## Task 5 — Web login, invitation redemption and access administration

**Create:** web routes/components for `/login`, `/redeem`, and `/admin/access`.
**Modify:** central web API client and Product Studio session handling.
**Test:** workspace contracts plus Next production build.

- Login form accepts only User ID and password.
- Redemption form accepts invitation key, User ID and password; no email field exists.
- Successful auth stores the opaque session in an HTTP-only cookie through the server boundary.
- People & Access shows active/suspended users, organisation role and project grants.
- Owner/admin can create/cancel invitations, change project access and revoke access.
- Browser-visible data never includes password hashes, invitation hashes or session hashes.

## Task 6 — Bootstrap, migration and compatibility

**Modify:** runtime preparation and `.env.example`.
**Test:** runtime integration, clean-database migration and existing Product Studio regressions.

- Provide an explicit development/bootstrap owner mechanism so a new environment can create its first administrator safely.
- Remove implicit production dependence on `org-001/user-001` headers.
- Migrate a brand-new Docker database from 001 → 002 → 003.
- Verify existing Product Studio, live Product Partner, audit and Model Gateway flows under authenticated identity.
- Verify revoked project membership cannot access project state while other authorised projects remain available.

## Final verification gate

- Full platform tests from a clean Docker PostgreSQL volume.
- Strict backend and web TypeScript.
- Next.js production build.
- npm signature/attestation verification and dependency audit.
- ECC agents/skills/rules/workflow/catalog/Unicode/path/IOC validation.
- Secret scan of outgoing diff.
- One batched GitHub push followed by remote CI verification.
