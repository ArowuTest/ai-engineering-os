import OpenAI from 'openai';
import { ProviderExecutionError } from '@engineering-os/model-gateway';
import type { ModelAdapter, ModelRoute, ProviderCapabilities } from '@engineering-os/model-gateway';
import type {
  AIConnectionProviderAdapter,
  AIConnectionProviderContext,
  DiscoveredConnectionModel,
} from './ai-connection-provider-adapter.js';

export interface OpenAICompatibleModelsClient {
  models: {
    list(): Promise<{ data?: unknown[] }>;
  };
  chat?: {
    completions: {
      create(input: Record<string, unknown>): Promise<{
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      }>;
    };
  };
}

export interface OpenAICompatibleConnectionProviderOptions {
  id: string;
  baseURL: string;
  createClient?: (input: { apiKey: string; baseURL: string }) => OpenAICompatibleModelsClient;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NO_ASSUMED_CAPABILITIES: ProviderCapabilities = Object.freeze({
  chat: false, tools: false, vision: false, files: false,
  mcp: false, localWorkspace: false, headless: false, structuredOutput: false,
});
function requireAdapterId(value: string): string {
  if (!ID_PATTERN.test(value)) throw new Error('provider adapter id must be stable');
  return value;
}

function requireBaseURL(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('provider base URL must be valid'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('provider base URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('provider base URL must not embed credentials');
  }
  return parsed.toString().replace(/\/$/, '');
}

function requireCredential(context: AIConnectionProviderContext): string {
  const value = context.credential?.value?.trim();
  if (!value) throw new Error('provider credential is required');
  return value;
}

function createDefaultClient(input: { apiKey: string; baseURL: string }): OpenAICompatibleModelsClient {
  return new OpenAI(input) as unknown as OpenAICompatibleModelsClient;
}
function normalizeModel(value: unknown): DiscoveredConnectionModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('provider model entry must be an object');
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id || id.length > 512) throw new Error('provider model id must be non-blank');
  const model: DiscoveredConnectionModel = {
    providerModelId: id,
    available: true,
    capabilities: { ...NO_ASSUMED_CAPABILITIES },
  };
  if (typeof record.name === 'string' && record.name.trim()) {
    model.displayName = record.name.trim().slice(0, 512);
  }
  return model;
}

async function listModels(
  client: OpenAICompatibleModelsClient,
): Promise<DiscoveredConnectionModel[]> {
  let result: { data?: unknown[] };
  try {
    result = await client.models.list();
  } catch {
    throw new Error('provider connection unavailable');
  }
  if (!result || !Array.isArray(result.data)) {
    throw new Error('provider model catalogue must contain a data array');
  }
  return result.data.map(normalizeModel);
}

function executionRoute(route: ModelRoute, context: AIConnectionProviderContext): ModelRoute {
  if (route.provider !== context.connection.providerId) {
    throw new Error('model route provider does not match connection provider');
  }
  if (!route.connection || route.connection.id !== context.connection.id) {
    throw new Error('model route connection does not match connection authority');
  }
  return {
    ...route,
    capabilities: {
      chat: route.capabilities.chat,
      headless: route.capabilities.headless,
      tools: false,
      vision: false,
      files: false,
      mcp: false,
      localWorkspace: false,
      structuredOutput: false,
    },
  };
}

export function createOpenAICompatibleConnectionProviderAdapter(
  options: OpenAICompatibleConnectionProviderOptions,
): AIConnectionProviderAdapter {
  const id = requireAdapterId(options.id);
  const baseURL = requireBaseURL(options.baseURL);
  const createClient = options.createClient ?? createDefaultClient;

  const clientFor = (context: AIConnectionProviderContext) => createClient({
    apiKey: requireCredential(context),
    baseURL,
  });

  return Object.freeze({
    id,
    async validateConnection(context: AIConnectionProviderContext) {
      await listModels(clientFor(context));
      return { status: 'available' as const };
    },
    async discoverModels(context: AIConnectionProviderContext) {
      return listModels(clientFor(context));
    },
    createModelAdapter(input: { context: AIConnectionProviderContext; route: ModelRoute }): ModelAdapter {
      const route = executionRoute(input.route, input.context);
      const client = clientFor(input.context);
      return {
        route,
        async execute(request) {
          if (!client.chat || request.messages.some((message) => message.role === 'tool')) {
            throw new ProviderExecutionError(route.provider);
          }
          try {
            const response = await client.chat.completions.create({
              model: route.model,
              messages: request.messages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
            });
            const content = response.choices?.[0]?.message?.content?.trim();
            if (!content) throw new ProviderExecutionError(route.provider);
            const usage = response.usage;
            if (!usage) return { content };
            return {
              content,
              usage: {
                ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
                ...(typeof usage.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
              },
            };
          } catch (error) {
            if (error instanceof ProviderExecutionError) throw error;
            throw new ProviderExecutionError(route.provider, error);
          }
        },
      };
    },
  });
}
