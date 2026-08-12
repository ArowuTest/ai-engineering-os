import { describe, expect, it } from 'vitest';
import type {
  CapabilityName,
  JsonSchemaResponseContract,
  ModelRequest,
  ProviderCapabilities,
} from '../src/index.js';

const responseContract: JsonSchemaResponseContract = {
  type: 'json_schema',
  name: 'example_v1',
  schema: {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
};

const capabilities: ProviderCapabilities = {
  chat: true,
  tools: false,
  vision: false,
  files: false,
  mcp: false,
  localWorkspace: false,
  headless: true,
  structuredOutput: true,
};

const structuredCapability: CapabilityName = 'structuredOutput';

const request: ModelRequest = {
  taskId: 'structured-contract-test',
  role: 'product_partner',
  messages: [{ role: 'user', content: 'Return structured output.' }],
  requiredCapabilities: ['chat', structuredCapability],
  routing: { subscriptionFirst: false, allowMeteredApi: true },
  responseContract,
};

describe('structured output model contract', () => {
  it('exposes structured output as a typed route capability and request contract', () => {
    expect(capabilities.structuredOutput).toBe(true);
    expect(request.responseContract).toEqual(responseContract);
    expect(request.requiredCapabilities).toContain('structuredOutput');
  });
});
