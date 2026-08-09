# AI Engineering OS V1 Foundation Design

**Status:** Approved for implementation
**Date:** 9 August 2026

## Goal

Establish the first private platform foundation around the ECC baseline without modifying ECC core unnecessarily.

This slice proves that the product can own durable project/product state independently of any AI provider session.

## Scope

The first implementation slice provides:

- isolated `platform/` workspace;
- shared domain contracts;
- PostgreSQL schema and local development database;
- projects and canonical Product Knowledge primitives;
- provider-neutral Model Gateway contracts;
- provider route/capability model;
- audit-event foundation;
- initial ECC provenance/adapter metadata;
- automated tests for domain invariants and persistence.
## Boundaries

ECC remains the engineering substrate. New application code lives under `platform/`; private skills/workflows later live under `extensions/`; local subscription execution later lives under `bridge/`.

The first slice does **not** implement live OpenAI/Anthropic/Google calls, autonomous engineering, deployment, OneSkill installation or production secrets.

## Runtime Shape

`platform/` is an independent TypeScript workspace so ECC's root package remains upgradeable.

Initial runtime components:

1. domain package — pure types/invariants;
2. database package — schema, migrations and repository adapters;
3. platform API — health/project/knowledge endpoints;
4. model-gateway package — provider-neutral interfaces and capability types;
5. tests — unit plus PostgreSQL integration tests.

The web UI is introduced after these contracts are stable.
## Data and Invariants

A project belongs to one organisation. Product Knowledge belongs to one project and has an explicit lifecycle status. Historical revisions are append-only.

Provider identity and execution route are separate concepts. For example, `anthropic` is a provider while `claude_subscription` and `anthropic_api` are distinct execution routes.

Audit events are append-only records of material state changes.

## Error Handling

Domain validation errors are typed and deterministic. Infrastructure failures are translated at module boundaries rather than leaking raw database/provider errors to callers.

## Testing

Implementation follows RED → GREEN → REFACTOR. Pure domain rules use fast unit tests. Database behaviour uses an isolated PostgreSQL test database (Docker initially; Neon may be used for shared integration environments).

No live-provider credential is required for this slice; provider gateway behaviour is tested against contract fixtures/fakes.

## Success Criteria

The slice is complete when a fresh developer can install the platform workspace, start the test database, run migrations, create a project, persist/revise Product Knowledge, enumerate provider routes, and observe audit events with all required tests passing.