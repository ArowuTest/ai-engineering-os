# Authentication & Collaboration V1 Design

**Status:** Approved design baseline
**Date:** 9 August 2026
**Parent:** `docs/product/AI-PRODUCT-ENGINEERING-OS-SRS.md`

## 1. Goal

Add real multi-user authentication and project-scoped collaboration without weakening the existing organisation/project isolation model.

Permanent login is **User ID + password only**. V1 does not require email addresses.

New users join through an administrator-generated **single-use invitation key**. Invitation expiry is configurable; the organisation default is **30 minutes**.

## 2. Security principles

- invitation keys are displayed only when generated;
- only a cryptographic hash of an invitation key is stored;
- a key can be redeemed exactly once;
- expired, cancelled, replaced or consumed keys cannot authenticate;
- password verifiers are stored using a memory-hard password KDF;
- active sessions are opaque random tokens stored only as hashes;
- revocation invalidates active sessions immediately;
- permissions are evaluated server-side on every protected request;
- historical audit identity is retained after access removal.

## 3. Invitation lifecycle

```text
Admin creates invitation
        ↓
Generate random one-time key
        ↓
Store key hash + expiry + intended access
        ↓
PENDING
   ├── successful redemption → CONSUMED
   ├── expiry reached        → EXPIRED
   ├── admin cancellation    → REVOKED
   └── replacement generated → REPLACED
```

A replacement invitation invalidates the previous outstanding key before the new key is issued.

The configured TTL is captured on the invitation at creation time so later policy changes do not alter an already-issued expiry timestamp.

## 4. Account lifecycle

On successful invitation redemption, the user selects a unique User ID and password. No email address is requested or required in V1.

Account states are `active` and `suspended`. Removing organisation membership is distinct from suspending the account: suspension blocks the person everywhere, while membership removal blocks only that organisation.

V1 does not implement email-based self-service password recovery. Password reset is an administrator-controlled future extension and must not weaken the one-time-token model.

## 5. Roles and access

Organisation roles:

- `owner` — full organisation control, including provider/security configuration and administrators;
- `admin` — user invitations, membership/project access and operational administration;
- `member` — no organisation-wide administrative authority.

Project roles:

- `product_owner` — product discovery, Product Knowledge approval, Product Package/change/release approvals;
- `contributor` — discovery participation and proposals without baseline approval authority;
- `engineer` — Engineering Studio access for assigned work;
- `reviewer` — review/finding capability without engineering or deployment authority;
- `viewer` — read-only project access.

Project membership is explicit. An organisation member may have access to one project and no access to another.

## 6. Revocation semantics

Administrators can:

- suspend a user account;
- remove organisation membership;
- remove or change access to a specific project;
- cancel a pending invitation;
- revoke all active sessions for a user.

Every protected request revalidates the current account/session/membership state. A removed or suspended user therefore loses access without waiting for token expiry.

## 7. Session model

Login returns an opaque high-entropy session token. The database stores only its hash plus user, expiry and revocation metadata.

The web application will ultimately keep the token in an HTTP-only cookie. The API may accept the same opaque token through a server-side request boundary; provider/API credentials are unrelated to user sessions.

Development identity headers remain available only behind an explicit development flag and are disabled by default outside local development/tests.

## 8. Data model

V1 adds or extends:

- `users`;
- `organisation_memberships`;
- `project_memberships`;
- `invitations`;
- `auth_sessions`;
- organisation invitation-policy fields.

Each invitation records organisation, optional project grants, organisation role, creator, hash, issued/expiry timestamps and terminal status.

## 9. API surface

Initial endpoints:

- `POST /auth/invitations` — admin/owner creates a one-time key;
- `POST /auth/redeem` — consume key and create account;
- `POST /auth/login` — User ID/password login;
- `POST /auth/logout` — revoke current session;
- `GET /auth/me` — current identity and accessible memberships;
- `GET /admin/users` — organisation people/access list;
- `PATCH /admin/users/:userId` — suspend/reactivate organisation user;
- `PUT /projects/:projectId/members/:userId` — grant/change project role;
- `DELETE /projects/:projectId/members/:userId` — revoke project access.

## 10. Audit requirements

Append-only audit events cover:

- invitation created, cancelled, replaced, expired and redeemed;
- account created, suspended and reactivated;
- login success, logout and session revocation;
- organisation role/membership changes;
- project role/membership changes.

Passwords, invitation keys and session tokens must never be written to audit metadata.

## 11. Multi-project and multi-session behaviour

A user may belong to multiple projects. Each project retains isolated Product Knowledge, documents, conversations, requirements and engineering state.

A project may contain multiple product-discovery conversation sessions. All sessions remain subordinate to the same project-owned canonical Product Knowledge; a new conversation is not a new product truth.

## 12. Acceptance criteria

1. A one-time invitation key cannot be redeemed twice.
2. A key cannot be redeemed after its captured expiry timestamp.
3. Default invitation TTL is 30 minutes and can be changed by authorised policy.
4. No email is required for invitation redemption or login.
5. Login succeeds only with the correct User ID/password for an active user.
6. Removing project membership immediately blocks that project while retaining other authorised projects.
7. Suspending a user blocks all protected access and invalidates active sessions.
8. Revoked sessions cannot be reused.
9. Invitation/session plaintext secrets are never stored in PostgreSQL or audit events.
10. Authentication and membership mutations are transactionally paired with mandatory audit events.
