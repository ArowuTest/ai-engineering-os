# AI Engineering OS

[![AI Engineering OS CI](https://github.com/ArowuTest/ai-engineering-os/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ArowuTest/ai-engineering-os/actions/workflows/ci.yml)

**An AI-powered software company in a box.**

AI Engineering OS is a web-based product and engineering operating system that takes a software product from idea through discovery, persistent requirements, engineering, independent review, QA and deployment.

> **The web application owns the project. Models are replaceable workers.**  
> **Sessions are temporary; repository and project state are memory.**

## Product lifecycle

```text
IDEA
  ↓
Product Discovery
  ↓
Persistent Product Definition
  ↓
Requirements & Documents
  ↓
Approval / Baseline
  ↓
Engineering
  ↓
Independent Review
  ↓
QA / Preview
  ↓
Deployment
```

## Start here

If you are looking for **our application**, start in `platform/`.

```text
platform/
├── apps/
│   ├── api/              Fastify platform API and orchestrator
│   └── web/              Next.js AI Engineering OS web application
├── packages/
│   ├── domain/           Product, auth and knowledge domain rules
│   ├── database/         PostgreSQL repositories and migrations
│   ├── model-gateway/    Provider-neutral AI model gateway
│   └── ecc-adapter/      Controlled boundary to the ECC foundation
└── test/                 Workspace and CI contract tests
```

The main product documentation is here:

```text
docs/
├── product/
│   └── AI-PRODUCT-ENGINEERING-OS-SRS.md
├── architecture/
│   ├── AI-ENGINEERING-OS-TECHNICAL-ARCHITECTURE.md
│   ├── ECC-BASELINE-ASSESSMENT.md
│   └── ...feature designs and implementation plans
└── superpowers/
    ├── specs/
    └── plans/
```

`UPSTREAM.md` records the exact ECC provenance and accepted baseline.

## What is implemented

The current V1 foundation includes:

- Product/project creation and Product Studio
- persistent Product Partner conversations
- canonical Product Knowledge with revision history and governance states
- provider-neutral Model Gateway with OpenAI, Anthropic and Google adapters
- live Product Partner turns with durable cross-provider context
- User ID + password authentication
- one-time invitation keys with configurable expiry
- organisation and project roles, project-specific access and immediate session revocation
- People & Access administration
- PostgreSQL transactional audit controls
- controlled ECC provenance/compatibility checks

The next product slice is review-first automatic Product Knowledge extraction: every successful Product Partner turn can suggest structured candidates, but AI suggestions do not become canonical Product Knowledge until an authorised human accepts them.

## Architecture at a glance

```text
USER
  │
  ▼
WEB APPLICATION
  ├── Product Studio
  ├── Engineering Studio
  ├── Review & QA Studio
  ├── Documents / Preview
  └── Administration
  │
  ▼
PLATFORM API + ORCHESTRATOR
  ├── Product Knowledge
  ├── Model Gateway
  ├── Skill / MCP Capability Layer
  ├── Policy / Cost Router
  └── Execution Control
  │
  ▼
OpenAI / Anthropic / Google / future providers
  │
  ▼
ECC-backed agents + secure sandboxes + GitHub + CI/CD
```

## ECC foundation

This repository was bootstrapped from the open-source **Everything Claude Code (ECC)** project by `affaan-m`.

ECC is an engineering foundation for this product; it is **not** the product identity or the default development branch. Inherited directories such as the following primarily belong to the ECC foundation:

```text
agents/
skills/
hooks/
rules/
commands/
ecc2/
```

AI Engineering OS does not blindly merge upstream ECC changes. Upstream changes are fetched, classified, security/compatibility reviewed, regression tested and selectively adopted. See `UPSTREAM.md` and `docs/architecture/ECC-BASELINE-ASSESSMENT.md`.

The original ECC README is preserved at `docs/upstream/ECC-README.md` so ECC catalog compatibility can be verified without turning the product homepage back into an ECC landing page.

### Unified Memory runtime

AI Engineering OS productises ECC Unified Memory through the platform Collaborative Memory layer. The inherited local CLI/MCP interoperability surface still requires the ECC runtime when an operator or harness uses those commands directly:

```bash
npm install -g ecc-universal
ecc memory --help
command -v ecc-memory-mcp
```

The optional `ecc-memory-mcp` process exposes the bounded local Memory Vault tools; it is not the platform source of authority and is not enabled automatically for every harness.

## Branch model

```text
main                         AI Engineering OS source of truth
ecc-seed                     frozen original imported ECC seed
ecc-upstream                 upstream ECC tracking/evaluation when refreshed
dependabot/*                 temporary grouped dependency-update branches (max two routine groups)
feature/* or chore/*         short-lived work; delete after merge
release/*                    only when a formal release branch is needed
```

The official ECC repository remains the upstream source. `ecc-seed` is historical provenance and should not receive product development commits.

## Local development

Prerequisites: Node.js 22+ and Docker for the local PostgreSQL database.

```bash
cd platform
npm ci
docker compose up -d
```

Run the API:

```bash
npm run dev --workspace @engineering-os/api
```

Run the web application in another terminal:

```bash
npm run dev --workspace @engineering-os/web
```

Use `platform/.env.example` as the environment template. Provider API credentials are optional for non-AI platform tests and must never be committed.

## Verification

From `platform/`:

```bash
npm test
npm run typecheck
npm run build --workspace @engineering-os/web
npm audit
```

GitHub Actions also runs the platform verification gate and the controlled ECC compatibility/security gate.

## Core design principles

1. The platform owns canonical project state; model sessions do not.
2. AI providers are interchangeable workers behind a provider-neutral gateway.
3. Material state changes and mandatory audit evidence are transactional.
4. AI-generated requirements are suggestions until explicitly accepted by an authorised human.
5. Engineering and review are separated so the builder is not the sole reviewer of its own work.
6. Upstream ECC changes are selectively adopted, never blindly merged into the product.

## Licensing and upstream attribution

The repository contains inherited MIT-licensed ECC material alongside proprietary AI Engineering OS code. The original upstream project is `affaan-m/ECC`; exact provenance is recorded in `UPSTREAM.md`. Existing upstream license and attribution files must be preserved for inherited material.
