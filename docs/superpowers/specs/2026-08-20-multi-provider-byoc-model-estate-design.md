# Multi-Provider BYOC/BYOM Model Estate Design

**Status:** APPROVED through Task-9 architectural reconciliation, 20 August 2026

## Purpose
AI Engineering OS must treat OpenRouter as one provider family, not as the model architecture. Users and organisations may bring model access from direct vendors, multi-model aggregators, cloud platforms, OpenAI-compatible gateways, or private/self-hosted endpoints without bypassing AIOS governance.

## Existing foundation retained
- `AIConnectionRecord` already separates `providerId`, `connectionFamilyId`, ownership and secret reference.
- Personal and organisation connection ownership, project sharing and execution pools already exist.
- `ModelProvider` is already an extensible string.
- Capability Estate already governs model-route release, eligibility, technical verification and operation authority.
- Exact route selection already fails closed rather than silently substituting a different route.

## Current gap
The current production connection registry exposes only direct OpenAI/Anthropic/Google API families for organisation ownership and subscription harnesses for personal ownership. OpenRouter is configured only as a platform environment-backed gateway with a static `OPENROUTER_MODELS` list. User-owned API connections do not currently materialise their models as connection-scoped governed routes.
## Core execution identity
A selectable model execution is identified by the tuple:

`model + provider family + connection + route + connection owner + capabilities`

The same model exposed by OpenRouter, Together and an enterprise gateway is three different routes because credentials, price, latency, data handling and availability differ.

`ModelRoute` therefore gains optional connection provenance for connection-backed routes while platform-managed routes remain valid without it. No provider-specific identifiers are embedded in generic domain authority.

## Provider adapter contract
Introduce a provider-neutral `ModelConnectionProvider` contract that can:
- validate a connection configuration;
- discover or enumerate available models;
- probe/declare capabilities conservatively;
- create execution adapters for exact connection-scoped routes;
- return safe provider metadata and normalized usage.

Native adapters may exist for strategic providers. An OpenAI-compatible adapter covers compatible hosted/private endpoints. Unknown capabilities default to false until verified.
## Credential ownership
Task-9 implementation keeps the existing PERSONAL and ORGANISATION authority model and external secret references. PLATFORM and TEAM ownership remain extension seams unless already required elsewhere; do not add parallel tenancy or permission systems.

A personal API connection may use an external secret reference just as an organisation API connection does. Secrets never appear in connection summaries, route metadata, capability records, audit payloads or model-selection responses.

## Route materialisation
Connection-backed discovered models are materialised as deterministic connection-scoped routes. Route identity must include the connection ID and provider model identifier, not just the model slug.

A route is selectable only when all are true:
1. the connection is active/available;
2. its connection family is permitted;
3. the discovered model is technically compatible;
4. the route is represented in Capability Estate;
5. release and eligibility permit it for the project/user;
6. required task/agent capabilities are satisfied.

Explicit route selection remains exact and fail-closed. Auto may rank eligible routes across platform, organisation and user-owned connections according to policy.
## V1 provider families
Task 9 must prove the generic architecture with:
- OpenAI direct API;
- Anthropic direct API;
- Google direct API;
- OpenRouter multi-model API;
- generic OpenAI-compatible API family.

Additional native providers such as Together, Fireworks, Groq, Bedrock, Vertex or Azure can register through the same provider registry without changing connection or route authority.

OpenRouter V1 discovery may use a provider catalogue client; static environment `OPENROUTER_MODELS` remains a platform-managed compatibility path but is not the user BYOC architecture.

## Execution and audit
Model responses must include the exact route. Connection-backed execution additionally records connection ID/owner tier in safe execution metadata and usage attribution. Secret references are never exposed to adapters except through a trusted credential resolver at execution time.

## Acceptance invariants
- OpenRouter is not hard-wired as the universal model source.
- A personal API connection can be represented without storing raw credentials in application records.
- Two connections exposing the same model produce distinct routes.
- Unknown capability claims fail closed.
- Project release/eligibility applies to connection-backed routes exactly as platform routes.
- Explicit route never silently changes provider/connection.
- Revoked/unavailable connection makes its routes ineligible.
- No connection or route response leaks secret references.
- Existing platform-managed model routes and subscription harness flows remain compatible.
