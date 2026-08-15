import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { ProviderExecutionError } from './provider-error.js';
import { normaliseUsage } from './usage.js';
import type { ModelAdapter, ModelRequest } from './types.js';

interface OpenRouterResponseLike {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface OpenRouterClientLike {
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<OpenRouterResponseLike>;
    };
  };
}

export interface OpenRouterAdapterOptions {
  apiKey: string;
  model: string;
  client?: OpenRouterClientLike;
}

const MAX_ROUTE_ID_LENGTH = 64;
const ROUTE_PREFIX = 'openrouter-';

function requireModel(model: string): string {
  const normalized = model.trim();
  if (!normalized) throw new TypeError('OpenRouter model must be non-blank');
  return normalized;
}

export function openRouterRouteId(model: string): string {
  const normalized = requireModel(model);
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'model';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 10);
  const payloadLength = MAX_ROUTE_ID_LENGTH - ROUTE_PREFIX.length - digest.length - 1;
  const payload = slug.slice(0, payloadLength).replace(/-$/g, '') || 'model';
  return `${ROUTE_PREFIX}${payload}-${digest}`;
}

function messages(request: ModelRequest) {
  if (request.messages.some((message) => message.role === 'tool')) {
    throw new ProviderExecutionError('openrouter');
  }
  return request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function createOpenRouterAdapter(options: OpenRouterAdapterOptions): ModelAdapter {
  const model = requireModel(options.model);
  const client = options.client ?? (new OpenAI({
    apiKey: options.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  }) as unknown as OpenRouterClientLike);

  return {
    route: {
      id: openRouterRouteId(model),
      provider: 'openrouter',
      model,
      executionMode: 'api',
      costType: 'metered_api',
      available: true,
      priority: 30,
      capabilities: {
        chat: true,
        tools: false,
        vision: false,
        files: false,
        mcp: false,
        localWorkspace: false,
        headless: true,
        structuredOutput: false,
      },
    },
    async execute(request: ModelRequest) {
      try {
        const result = await client.chat.completions.create({
          model,
          messages: messages(request),
        });
        const content = result.choices?.[0]?.message?.content?.trim();
        if (!content) throw new ProviderExecutionError('openrouter');
        const usage = normaliseUsage(result.usage?.prompt_tokens, result.usage?.completion_tokens);
        return usage ? { content, usage } : { content };
      } catch (error) {
        if (error instanceof ProviderExecutionError) throw error;
        throw new ProviderExecutionError('openrouter', error);
      }
    },
  };
}
