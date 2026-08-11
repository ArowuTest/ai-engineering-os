export type ModelProvider = string;
export type ExecutionMode = 'subscription' | 'api' | 'manual';
export type CostType =
  | 'included_subscription'
  | 'provider_credit'
  | 'metered_api'
  | 'manual';

export interface ProviderCapabilities {
  chat: boolean;
  tools: boolean;
  vision: boolean;
  files: boolean;
  mcp: boolean;
  localWorkspace: boolean;
  headless: boolean;
  structuredOutput: boolean;
}

export type CapabilityName = keyof ProviderCapabilities;

export interface ModelRoute {
  id: string;
  provider: ModelProvider;
  model: string;
  executionMode: ExecutionMode;
  costType: CostType;
  available: boolean;
  priority: number;
  capabilities: ProviderCapabilities;
}

export type AgentRole =
  | 'product_partner'
  | 'engineer'
  | 'reviewer'
  | 'security_reviewer'
  | 'ui_reviewer';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface RoutingPolicy {
  subscriptionFirst: boolean;
  allowMeteredApi: boolean;
  preferredProvider?: ModelProvider;
}

export interface JsonSchemaResponseContract {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}

export interface ModelRequest {
  taskId: string;
  role: AgentRole;
  messages: ModelMessage[];
  requiredCapabilities: CapabilityName[];
  routing: RoutingPolicy;
  responseContract?: JsonSchemaResponseContract;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AdapterExecutionResult {
  content: string;
  usage?: ModelUsage;
}

export interface ModelAdapter {
  route: ModelRoute;
  execute(request: ModelRequest): Promise<AdapterExecutionResult>;
}

export interface ModelResponse extends AdapterExecutionResult {
  provider: ModelProvider;
  routeId: string;
  model: string;
  executionMode: ExecutionMode;
  costType: CostType;
}
