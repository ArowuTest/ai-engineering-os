import OpenAI from 'openai';
import { ProviderExecutionError } from './provider-error.js';
import { normaliseUsage } from './usage.js';
import type { ModelAdapter, ModelMessage, ModelRequest } from './types.js';

interface OpenAIResponseLike {
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

interface OpenAIClientLike {
  responses: {
    create(input: Record<string, unknown>): Promise<OpenAIResponseLike>;
  };
}

export interface OpenAIAdapterOptions {
  apiKey: string;
  model?: string;
  client?: OpenAIClientLike;
}

function instructions(messages: ModelMessage[]): string | undefined {
  const content = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  return content || undefined;
}
function responseInput(messages: ModelMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }));
}

export function createOpenAIAdapter(options: OpenAIAdapterOptions): ModelAdapter {
  const model = options.model?.trim() || 'gpt-5.6';
  const client = options.client ?? (new OpenAI({ apiKey: options.apiKey }) as unknown as OpenAIClientLike);

  return {
    route: {
      id: 'openai-api',
      provider: 'openai',
      model,
      executionMode: 'api',
      costType: 'metered_api',
      available: true,
      priority: 10,
      capabilities: {
        chat: true,
        tools: false,
        vision: false,
        files: false,
        mcp: false,
        localWorkspace: false,
        headless: true,
      },
    },
    async execute(request: ModelRequest) {
      try {
        const result = await client.responses.create({
          model,
          instructions: instructions(request.messages),
          input: responseInput(request.messages),
        });
        const content = result.output_text?.trim();
        if (!content) throw new ProviderExecutionError('openai');
        const usage = normaliseUsage(result.usage?.input_tokens, result.usage?.output_tokens);
        return usage ? { content, usage } : { content };
      } catch (error) {
        if (error instanceof ProviderExecutionError) throw error;
        throw new ProviderExecutionError('openai', error);
      }
    },
  };
}
