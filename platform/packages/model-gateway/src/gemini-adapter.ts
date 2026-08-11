import { GoogleGenAI } from '@google/genai';
import { ProviderExecutionError } from './provider-error.js';
import { normaliseUsage } from './usage.js';
import type { ModelAdapter, ModelMessage, ModelRequest } from './types.js';

interface GeminiInteractionLike {
  output_text?: string;
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
}

interface GeminiClientLike {
  interactions: {
    create(input: Record<string, unknown>): Promise<GeminiInteractionLike>;
  };
}

export interface GeminiAdapterOptions {
  apiKey: string;
  model?: string;
  client?: GeminiClientLike;
}

function systemInstruction(messages: ModelMessage[]): string | undefined {
  const value = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  return value || undefined;
}
function conversationTurns(messages: ModelMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      content: message.content,
    }));
}

export function createGeminiAdapter(options: GeminiAdapterOptions): ModelAdapter {
  const model = options.model?.trim() || 'gemini-3.6-flash';
  const client = options.client ?? (new GoogleGenAI({ apiKey: options.apiKey }) as unknown as GeminiClientLike);

  return {
    route: {
      id: 'google-api',
      provider: 'google',
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
        const result = await client.interactions.create({
          model,
          system_instruction: systemInstruction(request.messages),
          input: conversationTurns(request.messages),
        });
        const content = result.output_text?.trim();
        if (!content) throw new ProviderExecutionError('google');
        const usage = normaliseUsage(result.usage?.total_input_tokens, result.usage?.total_output_tokens);
        return usage ? { content, usage } : { content };
      } catch (error) {
        if (error instanceof ProviderExecutionError) throw error;
        throw new ProviderExecutionError('google', error);
      }
    },
  };
}
