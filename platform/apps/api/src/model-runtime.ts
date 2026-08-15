import {
  ModelGateway,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
  createOpenRouterAdapter,
} from '@engineering-os/model-gateway';

export interface ModelRuntimeEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODELS?: string;
}

function value(environment: ModelRuntimeEnvironment, key: keyof ModelRuntimeEnvironment) {
  const raw = environment[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function configuredOpenRouterModels(environment: ModelRuntimeEnvironment): string[] {
  const models = (environment.OPENROUTER_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new Error(
      'OPENROUTER_MODELS must be a non-blank comma-separated list of model slugs when OPENROUTER_API_KEY is set',
    );
  }

  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model)) {
      throw new Error(`Duplicate OpenRouter model slug in OPENROUTER_MODELS: ${model}`);
    }
    seen.add(model);
  }
  return models;
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

  const openRouterKey = value(environment, 'OPENROUTER_API_KEY');
  if (openRouterKey) {
    for (const model of configuredOpenRouterModels(environment)) {
      gateway.register(createOpenRouterAdapter({ apiKey: openRouterKey, model }));
    }
  }

  return gateway;
}
