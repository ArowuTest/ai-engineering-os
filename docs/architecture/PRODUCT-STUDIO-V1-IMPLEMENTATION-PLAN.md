# Product Studio V1 Implementation Plan

## Batch Strategy

Work remains local on `platform-v1-foundation` until all tasks below pass together. Push one tested Product Studio checkpoint.

## Task 1 — Domain Contracts

Tests first for:

- project lifecycle stage;
- Product Partner preference;
- conversation creation;
- append-only messages;
- partner switching;
- completeness calculation.

Then implement the minimum domain code.

## Task 2 — PostgreSQL Persistence

Add migration `002_product_studio.sql` and integration tests for:

- upgraded project records;
- tenant-scoped project listing;
- conversations/messages;
- durable partner changes;
- cross-organisation isolation.

## Task 3 — API Vertical Slice

Integration tests first for:

- project list/create/read;
- Product Studio summary;
- create/list conversation messages;
- change Product Partner;
- revise Product Knowledge status/content;
- audit events for material writes.

All material writes must remain transactional with mandatory audit evidence.

## Task 4 — Web Application

Create `platform/apps/web` with:

- project dashboard;
- create-product form;
- Product Studio three-region layout;
- persistent message composer;
- Product Partner selector;
- canonical Product Knowledge cards;
- completeness/open-category panel.

## Task 5 — Verification

Run from a clean local PostgreSQL volume:

1. platform contract tests;
2. unit tests;
3. PostgreSQL integration tests serially;
4. TypeScript typecheck;
5. platform dependency signature/audit checks;
6. ECC structural compatibility validators;
7. Next.js production build;
8. browser smoke test where practical.

## Push Gate

Only after the complete batch is green:

- review `git diff --check`;
- confirm no accidental ECC-core edits;
- make one Product Studio commit;
- push once;
- verify GitHub `Engineering OS CI` remotely.
