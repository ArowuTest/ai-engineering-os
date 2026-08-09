# Product Studio V1 Design

**Status:** Approved build slice
**Date:** 2026-08-09
**Parent:** AI Engineering OS SRS v1.1 and Technical Architecture v1.1

## Goal

Deliver the first visible Product Studio while preserving the core rule that the platform, not an LLM session, owns product state.

## Scope

V1 provides:

- project dashboard and project creation;
- persistent lifecycle stage and preferred Product Partner;
- Product Studio workspace with navigation, discovery conversation, and canonical Product Knowledge;
- persisted conversations and messages;
- model switching without loss of project state;
- manual Product Knowledge creation and lifecycle changes;
- advisory completeness based on defined knowledge-category coverage;
- tenant scoping and immutable audit events for material actions.

Live LLM execution is deliberately deferred to the next provider-integration slice.
## User Experience

### Dashboard

Each project card shows name, short description, lifecycle stage, preferred Product Partner, knowledge completeness, and last activity.

### Create Product

Required fields:

- product name;
- short idea/description;
- preferred Product Partner: OpenAI, Claude, Gemini, or Auto.

A new project begins in `discovery` and receives one active product-discovery conversation.

### Product Studio Workspace

The page uses three coordinated regions:

1. **Product navigation** Ã¢â‚¬â€ overview, requirements, journeys, business rules, architecture, risks, decisions.
2. **Discovery conversation** Ã¢â‚¬â€ persisted chronological messages and Product Partner control.
3. **Canonical Product Knowledge** Ã¢â‚¬â€ records grouped by category, with provenance and lifecycle status visible.
## Domain Rules

- Project stage is durable and model-independent.
- Product Partner is a preference, not ownership of project state.
- Changing Product Partner never deletes or rewrites messages or knowledge.
- Conversation messages are append-only in V1.
- Product Knowledge revisions remain append-only and retain provenance.
- `proposed` and `inferred` knowledge must remain visibly distinct from `confirmed` and `approved` knowledge.
- Completeness is coverage, not confidence. It must never claim requirements are correct merely because categories are populated.

## Completeness Model

V1 measures coverage across these categories:

- vision;
- objectives;
- users;
- business_model;
- functional_requirements;
- non_functional_requirements;
- business_rules;
- integrations;
- security;
- data;
- user_journeys;
- risks.

A category counts as covered when at least one latest non-rejected record exists. The UI shows both percentage and uncovered categories.
## Technical Shape

- Extend the domain package with project lifecycle, Product Partner, conversations, messages, and completeness calculation.
- Add migration `002_product_studio.sql`; do not rewrite the accepted initial migration.
- Add tenant-scoped repositories for project listing/settings and conversations/messages.
- Extend the API with dashboard, Product Studio, message, partner-switch, and knowledge-revision endpoints.
- Add `platform/apps/web` as a Next.js workspace consuming the Platform API.
- Keep temporary development identity outside page components and centralise it in the web API client.

## Explicit Non-Goals

This slice does not:

- call OpenAI, Claude, or Gemini;
- simulate fake assistant responses;
- implement production authentication;
- generate the formal Product Package;
- implement engineering execution;
- deploy to production.

Those remain later controlled slices.

## Acceptance

The slice is accepted when a user can create/open a project, see persisted Product Knowledge and completeness, persist discovery messages, change Product Partner without losing state, and receive the same state after restart, with tenant isolation and audit tests passing.
