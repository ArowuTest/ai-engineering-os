# ECC Upstream Provenance

This private repository is an independent derivative of the official ECC project. It is **not** a GitHub public fork.

## Accepted Baseline

- Upstream repository: `https://github.com/affaan-m/ECC.git`
- Imported on: 2026-08-09
- Accepted upstream commit: `51a6950bde756fe3ebc8879aa0c8ee49b9c53e78`
- Upstream describe at import: `v2.1.0-47-g51a6950b`
- Private repository: `ArowuTest/ai-engineering-os`
- Import method: clean source snapshot with independent private Git history

The ECC MIT licence and applicable attribution remain in this repository.
## Update Policy

Upstream ECC is a read-only source of candidate changes. No ECC update is automatically merged into the private product.

For each candidate update:

1. fetch/clone the new upstream revision into a review workspace;
2. diff it against the last accepted upstream commit;
3. classify security fixes, bug fixes, agents, skills, MCP, orchestration and provider changes;
4. identify conflicts with `platform/`, `extensions/` and `bridge/`;
5. scan new/changed executable content and configuration;
6. run ECC baseline tests and private-platform regression tests;
7. prepare one dedicated upstream-update change set;
8. independently review it before acceptance;
9. update this file only after the approved update is merged.

New upstream skills or MCP definitions do not automatically become trusted or receive project credentials.
## Branch Tracking

- `main` is the AI Engineering OS source of truth.
- `ecc-seed` is the frozen original private-repository ECC seed and must not receive product development commits.
- local remote `upstream` points to `affaan-m/ECC` and has push disabled; it is fetch-only.
- `ecc-upstream` mirrors the current upstream ECC `main` for comparison and evaluation only.
- Moving `ecc-upstream` does **not** change the accepted ECC baseline above; accepted upstream changes still require the review policy below.
