import {
  ModelGateway,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
} from '@engineering-os/model-gateway';

export interface ModelRuntimeEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

function value(environment: ModelRuntimeEnvironment, key: keyof ModelRuntimeEnvironment) {
  const raw = environment[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function createConfiguredModelGateway(environment: ModelRuntimeEnvironment): ModelGateway {
  const gateway = new ModelGateway();
  const openAIKey = value(environment, 'OPENAI_API_KEY');
  if (openAIKey) {
    const model = value(environment, 'OPENAI_MODEL');
    gateway.register(createOpenAIAdapter(model ? { apiKey: openAIKey, model } : { apiKey: openAIKey }));
  }

  const anthropicKey = value(environment, 'ANTHROPIC_API_KEY');
  if (anthropicKey) {
    const model = value(environment, 'ANTHROPIC_MODEL');
    gateway.register(createAnthropicAdapter(model ? { apiKey: anthropicKey, model } : { apiKey: anthropicKey }));
  }

  const geminiKey = value(environment, 'GEMINI_API_KEY');
  if (geminiKey) {
    const model = value(environment, 'GEMINI_MODEL');
    gateway.register(createGeminiAdapter(model ? { apiKey: geminiKey, model } : { apiKey: geminiKey }));
  }

  return gateway;
}
