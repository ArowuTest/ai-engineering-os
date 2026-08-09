# Live Product Partners V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Product Studio to live OpenAI, Anthropic, and Gemini APIs without making provider sessions the source of project memory.

**Architecture:** Keep `ModelGateway` provider-neutral and add three official-SDK adapters. Product Studio reconstructs each model request from PostgreSQL conversation history plus canonical Product Knowledge, executes one gateway turn, then atomically persists the user and assistant messages only after provider success.

**Tech Stack:** TypeScript 6, Fastify 5, PostgreSQL 17, Next.js 16.3, `openai@7.4.0`, `@anthropic-ai/sdk@0.116.0`, `@google/genai@2.16.0`, Vitest.

## Global Constraints

- The platform owns project state; provider conversation IDs are optional optimisation only.
- API keys remain server-side and must never be returned, logged, audited, or persisted in conversation metadata.
- Missing credentials make a provider route unavailable; they must not fail application startup.
- V1 live Product Partner execution is non-streaming and requires only the `chat` capability.
- Provider adapters advertise only capabilities actually implemented in this slice.
- CI must never call a real provider or consume API credits.
- Live-turn persistence is atomic after successful model execution.
- Existing organisation isolation and safe error responses remain unchanged.

---

### Task 1: Official provider adapters

**Files:**
- Create: `platform/packages/model-gateway/src/provider-error.ts`
- Create: `platform/packages/model-gateway/src/openai-adapter.ts`
- Create: `platform/packages/model-gateway/src/anthropic-adapter.ts`
- Create: `platform/packages/model-gateway/src/gemini-adapter.ts`
- Modify: `platform/packages/model-gateway/src/index.ts`
- Modify: `platform/packages/model-gateway/package.json`
- Test: `platform/packages/model-gateway/test/provider-adapters.test.ts`
**Interfaces:**
- Produces: `ProviderExecutionError`, `createOpenAIAdapter`, `createAnthropicAdapter`, `createGeminiAdapter`.
- Each factory accepts `{ apiKey, model?, client? }` and returns `ModelAdapter`.
- Default models: `gpt-5.6`, `claude-sonnet-5`, `gemini-3.6-flash`.

- [ ] **Step 1: Write failing adapter tests**

Test each injected fake SDK client with a `product_partner` `ModelRequest`. Assert the adapter translates system/user/assistant history, returns text, maps token usage where available, and rejects blank output with `ProviderExecutionError`.

```ts
const result = await adapter.execute(request);
expect(result.content).toBe('Clarify who pays for the livestream.');
expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm exec vitest run packages/model-gateway/test/provider-adapters.test.ts`
Expected: FAIL because provider adapter factories do not exist.

- [ ] **Step 3: Install exact SDK versions and implement minimal adapters**

Use the official provider SDK internally. Keep SDK-specific request/response types inside each adapter file. Route metadata must use `executionMode: 'api'`, `costType: 'metered_api'`, `available: true`, `chat: true`, `headless: true`, and false for capabilities not implemented by the adapter.

- [ ] **Step 4: Run adapter and existing gateway tests**

Run: `npm exec vitest run packages/model-gateway/test/provider-adapters.test.ts packages/model-gateway/test/gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add platform/packages/model-gateway platform/package-lock.json
git commit -m "feat: add live model provider adapters"
```

### Task 2: Runtime provider registration and safe status

**Files:**
- Create: `platform/apps/api/src/model-runtime.ts`
- Modify: `platform/apps/api/src/server.ts`
- Modify: `platform/apps/api/src/app.ts`
- Modify: `platform/.env.example`
- Test: `platform/apps/api/test/model-runtime.test.ts`
- Test: `platform/apps/api/test/runtime.integration.test.ts`
**Interfaces:**
- Produces: `createConfiguredModelGateway(environment)` and `GET /model-routes`.
- Environment: `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

- [ ] **Step 1: Write failing registration tests**

Assert no-key environment yields zero routes; one key yields exactly that provider; model overrides appear in route metadata; returned status never contains key values.

```ts
const gateway = createConfiguredModelGateway({ OPENAI_API_KEY: 'test-key' });
expect(gateway.listRoutes()).toHaveLength(1);
expect(gateway.listRoutes()[0]?.provider).toBe('openai');
```

- [ ] **Step 2: Verify RED**

Run: `npm exec vitest run apps/api/test/model-runtime.test.ts`
Expected: FAIL because runtime registration does not exist.

- [ ] **Step 3: Implement environment-driven registration**

Register only providers with nonblank keys. Pass model overrides into adapter factories. Replace `new ModelGateway()` in real runtime composition with `createConfiguredModelGateway(environment)`; tests may continue injecting explicit gateways.

- [ ] **Step 4: Add safe model-route endpoint and environment examples**

`GET /model-routes` returns `modelGateway.listRoutes()` only. Add model/key variable names to `.env.example` with blank secret values and current default model names.

- [ ] **Step 5: Run runtime/API tests and commit**

Run: `npm exec vitest run apps/api/test/model-runtime.test.ts apps/api/test/runtime.integration.test.ts apps/api/test/server.integration.test.ts`
Expected: PASS.

```bash
git add platform/apps/api platform/.env.example
git commit -m "feat: register configured model routes"
```

### Task 3: Product Partner prompt assembly

**Files:**
- Create: `platform/apps/api/src/product-partner-context.ts`
- Test: `platform/apps/api/test/product-partner-context.test.ts`

**Interfaces:**
- Produces: `buildProductPartnerRequest({ project, knowledge, messages, newUserContent }) : ModelRequest`.
- Input contains platform domain records only; no provider SDK types.
- Output requires `role: 'product_partner'` and `requiredCapabilities: ['chat']`.
- [ ] **Step 1: Write failing prompt-context tests**

Assert the system message contains project purpose, lifecycle constraints, canonical Product Knowledge with status/source, and instructions not to invent approved requirements. Assert durable message history is preserved in order and the new user content is appended once.

- [ ] **Step 2: Verify RED**

Run: `npm exec vitest run apps/api/test/product-partner-context.test.ts`
Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement the provider-neutral builder**

Use one stable system instruction and plain text serialisation of current Product Knowledge. Set routing to `subscriptionFirst: false`, `allowMeteredApi: true`, and map explicit project partners to `preferredProvider`; Auto leaves it undefined.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm exec vitest run apps/api/test/product-partner-context.test.ts`
Expected: PASS.

```bash
git add platform/apps/api/src/product-partner-context.ts platform/apps/api/test/product-partner-context.test.ts
git commit -m "feat: build canonical Product Partner context"
```

### Task 4: Atomic live Product Partner turn API

**Files:**
- Modify: `platform/apps/api/src/app.ts`
- Test: `platform/apps/api/test/live-product-partner.integration.test.ts`

**Interfaces:**
- Consumes: `buildProductPartnerRequest`, `ModelGateway.execute`, existing conversation/knowledge repositories and unit of work.
- Produces: `POST /projects/:id/product-partner-turn` returning `{ userMessage, assistantMessage, execution }`.

- [ ] **Step 1: Write failing PostgreSQL integration tests**

Use fake gateway adapters, never provider APIs. Cover success, explicit-provider switching, Auto routing, no-route 503, model failure 502, blank-response failure, and cross-organisation 404. Assert success persists two ordered messages and two audit events; failure persists neither live-turn message.

- [ ] **Step 2: Verify RED**

Run: `npm exec vitest run apps/api/test/live-product-partner.integration.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route and error mapping**

Create user message before execution only in memory. Execute the gateway with canonical context. Create the assistant message with `provider: response.provider`. Persist both messages and audit events together through `DatabaseUnitOfWork` after success.
Execution metadata returned to the client includes provider, model, route ID, execution mode, cost type, and token usage. Audit metadata may contain those normalised fields but never request headers, API keys, or raw provider error bodies.

- [ ] **Step 4: Run live-turn plus audit regression tests**

Run: `npm exec vitest run apps/api/test/live-product-partner.integration.test.ts apps/api/test/audit.integration.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add platform/apps/api/src/app.ts platform/apps/api/test/live-product-partner.integration.test.ts
git commit -m "feat: execute atomic live Product Partner turns"
```

### Task 5: Product Studio live-turn UI

**Files:**
- Modify: `platform/apps/web/lib/api.ts`
- Modify: `platform/apps/web/app/actions.ts`
- Modify: `platform/apps/web/app/projects/[id]/page.tsx`
- Modify: `platform/apps/web/app/globals.css`
- Test: `platform/test/web-workspace.test.mjs`

**Interfaces:**
- Produces: `sendProductPartnerTurn(projectId, content)` API client and `sendProductPartnerTurnAction(formData)` server action.
- Consumes: `GET /model-routes` for safe connection state.

- [ ] **Step 1: Extend web contract test and verify RED**

Assert the central API client contains the live-turn route and the Product Studio page/action references the live turn rather than the manual-message action for the main composer.

Run: `node --test test/web-workspace.test.mjs`
Expected: FAIL until the live action is wired.

- [ ] **Step 2: Implement live API client and server action**

The action posts the turn, then revalidates the project route. Do not place provider keys or provider SDK packages in the web workspace.

- [ ] **Step 3: Update Product Studio conversation UI**

Show configured/disconnected state for Auto/OpenAI/Claude/Gemini using safe route metadata. Render assistant provider attribution from persisted messages. Preserve manual note capture as a secondary action, not the primary composer.

- [ ] **Step 4: Run web contract, typecheck, and Next production build**

Run: `node --test test/web-workspace.test.mjs && npm run typecheck && npm run build --workspace @engineering-os/web`
Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add platform/apps/web platform/test/web-workspace.test.mjs
git commit -m "feat: connect Product Studio to live partners"
```
### Task 6: Full verification and remote checkpoint

**Files:**
- Modify only if verification exposes a defect.
- Review: `.github/workflows/ci.yml`, provider dependency lockfile changes, environment examples, and staged diff.

- [ ] **Step 1: Run the complete platform suite on PostgreSQL**

Run: `npm test`
Expected: all workspace, unit, gateway, API, migration, and PostgreSQL integration tests PASS with no provider API calls.

- [ ] **Step 2: Run strict typecheck and production web build**

Run: `npm run typecheck`
Run: `npm run build --workspace @engineering-os/web`
Expected: PASS.

- [ ] **Step 3: Run supply-chain and ECC compatibility checks**

Run the existing ECC agent/hook/command/skill/install/rule/workflow/catalog/registry/Unicode/path/IOC checks. Run `npm audit signatures` and `npm audit --omit=dev --audit-level=high` inside `platform`.

- [ ] **Step 4: Inspect staged changes**

Run `git diff --check`, scan for token/key patterns, confirm `.next` is absent, and confirm no API key value appears in tests, docs, audit fixtures, or committed environment files.

- [ ] **Step 5: Optional real-provider smoke**

Only when a developer intentionally provides a provider key locally, start API + web and submit one discovery turn. Never make this a CI requirement and never print the key.

- [ ] **Step 6: Push one reviewed implementation checkpoint and verify GitHub Actions**

Push only after all local gates are green. Confirm remote `Platform Verification` and `ECC Compatibility` complete successfully on the exact pushed SHA.

## Plan Self-review

- Spec coverage: provider adapters, runtime registration, canonical context, atomic persistence, switching, UI, safe failures, and CI are all mapped to tasks.
- Placeholder scan: no TBD/TODO or deferred implementation steps appear in task requirements.
- Type consistency: provider factories return existing `ModelAdapter`; runtime returns existing `ModelGateway`; API context builder returns existing `ModelRequest`; UI uses normalised API responses only.
- Scope remains one independently testable subsystem: live Product Partner conversation. Knowledge extraction and document generation remain separate future slices.
