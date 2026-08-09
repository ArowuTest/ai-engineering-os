# Live Product Partners V1 Design

**Status:** Approved implementation slice
**Date:** 2026-08-09
**Parent:** Product Studio V1 and AI Engineering OS Technical Architecture v1.1

## Goal

Turn Product Studio discovery from durable manual notes into a live AI conversation with OpenAI, Anthropic, or Google while preserving the rule that the platform owns project state.

A user can select Auto, OpenAI, Claude, or Gemini, send a discovery message, receive a live assistant response, switch provider on the next turn, and retain one coherent conversation and Product Knowledge context.

## Non-goals

This slice does not add autonomous knowledge extraction, document generation, research agents, MCP tool execution, provider billing UI, or encrypted per-user key storage. Those remain later Product Studio capabilities.

Provider-side conversation IDs may be added later as performance optimisations, but they are not the source of truth in V1.

## Approaches Considered

1. **Official provider SDKs behind our gateway — selected.** Best access to current provider APIs while keeping orchestration provider-neutral.
2. Raw HTTP adapters. Fewer dependencies, but more hand-maintained protocol and error-shape code.
3. One generic AI SDK. Faster initial unification, but creates another abstraction layer that may lag provider-native APIs.
## Provider Contracts

The adapter implementations use current official APIs as of 2026-08-09:

- OpenAI: Responses API through the official `openai` JavaScript SDK.
- Anthropic: Messages API through `@anthropic-ai/sdk`.
- Google: Gemini Interactions API through `@google/genai`.

The provider model name is configuration, not business state. Defaults may be supplied for development, but deployments can override `OPENAI_MODEL`, `ANTHROPIC_MODEL`, and `GEMINI_MODEL` without code changes.

API keys stay server-side. V1 reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` from the runtime environment. Missing keys make that route unavailable rather than causing application startup to fail.

## Gateway Boundary

`ModelGateway` remains the only component that Product Studio calls for model execution. Provider adapters implement the existing `ModelAdapter` contract and expose route metadata and capabilities.

The gateway chooses a route using existing capability and cost policy. An explicit Product Partner maps to `routing.preferredProvider`; Auto leaves provider preference unset and lets route policy decide.

Provider SDK response shapes must not leak into the API or database layers. Each adapter normalises output to gateway content, usage, provider, model, route ID, execution mode, and cost type.

## Canonical Conversation Context

Before every live Product Partner turn, the API reconstructs model input from platform-owned state:

1. project identity and current discovery stage;
2. current canonical Product Knowledge records;
3. durable Product Studio message history in append order;
4. the new user message.
This lets a user switch providers without losing continuity. Provider continuation IDs are never required to recover the conversation.

The system instruction tells the Product Partner to act as a product strategist/business analyst, challenge ambiguity, avoid inventing approved requirements, and distinguish questions, assumptions, and recommendations. Canonical Product Knowledge is supplied as governed context, not silently rewritten by the model.

## Turn Transaction

The live endpoint is `POST /projects/:id/product-partner-turn` with `{ content }`.

Flow:

1. validate organisation/user identity and project ownership;
2. load conversation, message history, and current Product Knowledge;
3. create the user message in memory;
4. build a provider-neutral `ModelRequest` and execute it through `ModelGateway`;
5. create an assistant message carrying provider attribution;
6. in one database transaction append both messages and their audit events;
7. return both persisted messages plus normalised model route metadata.

If provider execution fails, neither message is persisted by this endpoint. The user can retry or change Product Partner without leaving an orphan user turn. Existing manual `POST /messages` remains available for deliberate note capture.

## Runtime Composition

Runtime startup registers only API routes whose credentials are present. A route is therefore observable as unavailable through the gateway rather than failing later with an absent credential.

The initial live routes are metered API routes. Subscription/browser harness execution remains a future execution mode and is not faked in V1.

## Error Behaviour

- No configured eligible provider: HTTP 503 with a safe `No live Product Partner is configured` response.
- Provider authentication/rate/network failure: HTTP 502 with a safe provider-execution error and no raw key, response body, or stack trace.
- Invalid user input: HTTP 400 through existing domain validation.
- Cross-organisation project access: HTTP 404 as today.
- Successful provider response with blank text: treated as execution failure and not persisted.
## UI Behaviour

Product Studio replaces the current live-provider placeholder with real turn submission. The selected Product Partner remains visible before and after the response, and assistant messages show the provider that actually answered.

If no live provider route is configured, the conversation remains usable for manual notes and the UI explains that a server-side provider credential is required.

V1 uses non-streaming responses. Streaming is deliberately deferred until the provider-neutral turn contract and persistence semantics are stable.

## Testing Strategy

Provider adapter tests use injected/mocked SDK clients and never consume real API credits in CI. Each adapter must prove request translation, text extraction, token usage mapping, and safe failure behaviour.

Gateway/runtime tests prove routes are registered only when credentials exist and explicit Product Partner preference wins over Auto routing when eligible.

API integration tests use fake adapters with real PostgreSQL and prove atomic two-message persistence, audit events, provider attribution, model switching, no-route 503, and rollback on model failure.

Web tests/build contracts prove the Product Studio submits through the live turn action and renders provider attribution. A local optional smoke script may call a real provider only when the developer explicitly supplies a key.

## Acceptance Criteria

- OpenAI, Anthropic, and Gemini each have a provider adapter behind `ModelGateway`.
- Missing credentials do not break startup and do not create eligible routes.
- A live discovery turn persists the user and assistant messages atomically after model success.
- Assistant messages persist the provider that actually answered.
- Changing Product Partner between turns preserves the same conversation and Product Knowledge context.
- Auto mode can choose any configured eligible provider according to gateway policy.
- Provider execution failures do not expose secrets or persist partial live turns.
- CI runs without real provider credentials or API spend.
- Strict TypeScript, PostgreSQL integration tests, Next production build, npm audit, and ECC compatibility remain green.
