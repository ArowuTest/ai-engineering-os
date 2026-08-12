import Anthropic from '@anthropic-ai/sdk';
import { ProviderExecutionError } from './provider-error.js';
import { normaliseUsage } from './usage.js';
import type { ModelAdapter, ModelMessage, ModelRequest } from './types.js';

interface AnthropicResponseLike {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicClientLike {
  messages: {
    create(input: Record<string, unknown>): Promise<AnthropicResponseLike>;
  };
}

export interface AnthropicAdapterOptions {
  apiKey: string;
  model?: string;
  client?: AnthropicClientLike;
}

function systemInstruction(messages: ModelMessage[]): string | undefined {
  const value = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  return value || undefined;
}

function conversationMessages(messages: ModelMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }));
}

function messageRequest(model: string, request: ModelRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    system: systemInstruction(request.messages),
    messages: conversationMessages(request.messages),
  };

  if (request.responseContract) {
    input.output_config = {
      format: {
        type: 'json_schema',
        schema: request.responseContract.schema,
      },
    };
  }

  return input;
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions): ModelAdapter {
  const model = options.model?.trim() || 'claude-sonnet-5';
  const client = options.client ?? (new Anthropic({ apiKey: options.apiKey }) as unknown as AnthropicClientLike);

  return {
    route: {
      id: 'anthropic-api',
      provider: 'anthropic',
      model,
      executionMode: 'api',
      costType: 'metered_api',
      available: true,
      priority: 20,
      capabilities: {
        chat: true,
        tools: false,
        vision: false,
        files: false,
        mcp: false,
        localWorkspace: false,
        headless: true,
        structuredOutput: true,
      },
    },
    async execute(request: ModelRequest) {
      try {
        const result = await client.messages.create(messageRequest(model, request));
        const content = result.content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text?.trim() ?? '')
          .filter(Boolean)
          .join('\n\n');
        if (!content) throw new ProviderExecutionError('anthropic');
        const usage = normaliseUsage(result.usage?.input_tokens, result.usage?.output_tokens);
        return usage ? { content, usage } : { content };
      } catch (error) {
        if (error instanceof ProviderExecutionError) throw error;
        throw new ProviderExecutionError('anthropic', error);
      }
    },
  };
}
