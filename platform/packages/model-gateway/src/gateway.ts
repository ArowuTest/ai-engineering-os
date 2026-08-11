import type {
  ModelAdapter,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRoute,
  RoutingPolicy,
} from './types.js';

const STABLE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class NoEligibleRouteError extends Error {
  constructor() {
    super('No eligible model execution route satisfies this request');
    this.name = 'NoEligibleRouteError';
  }
}

function requireStableIdentifier(value: string, field: string): void {
  if (!STABLE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a valid lower-case stable identifier`);
  }
}

function validateRoute(route: ModelRoute): void {
  requireStableIdentifier(route.id, 'route id');
  requireStableIdentifier(route.provider, 'provider');
  if (route.provider === 'auto') {
    throw new Error('provider cannot use the reserved auto routing sentinel');
  }
  if (route.model.trim().length === 0) {
    throw new Error('model must be a non-blank string');
  }
}

function isEligible(route: ModelRoute, request: ModelRequest): boolean {
  if (!route.available) return false;
  if (!request.routing.allowMeteredApi && route.costType === 'metered_api') return false;
  return request.requiredCapabilities.every((capability) => route.capabilities[capability]);
}

function compareRoutes(a: ModelRoute, b: ModelRoute, policy: RoutingPolicy): number {
  if (policy.subscriptionFirst) {
    const subscriptionRankA = a.executionMode === 'subscription' ? 0 : 1;
    const subscriptionRankB = b.executionMode === 'subscription' ? 0 : 1;
    if (subscriptionRankA !== subscriptionRankB) return subscriptionRankA - subscriptionRankB;
  }

  if (policy.preferredProvider) {
    const providerRankA = a.provider === policy.preferredProvider ? 0 : 1;
    const providerRankB = b.provider === policy.preferredProvider ? 0 : 1;
    if (providerRankA !== providerRankB) return providerRankA - providerRankB;
  }

  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id.localeCompare(b.id);
}

export class ModelGateway {
  private readonly adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    validateRoute(adapter.route);
    if (this.adapters.has(adapter.route.id)) {
      throw new Error(`model route already registered: ${adapter.route.id}`);
    }
    this.adapters.set(adapter.route.id, adapter);
  }

  listRoutes(provider?: ModelProvider): ModelRoute[] {
    return [...this.adapters.values()]
      .map((adapter) => adapter.route)
      .filter((route) => provider === undefined || route.provider === provider);
  }

  async execute(request: ModelRequest): Promise<ModelResponse> {
    const adapter = [...this.adapters.values()]
      .filter((candidate) => isEligible(candidate.route, request))
      .sort((left, right) => compareRoutes(left.route, right.route, request.routing))[0];

    if (!adapter) throw new NoEligibleRouteError();

    const result = await adapter.execute(request);
    return {
      ...result,
      provider: adapter.route.provider,
      routeId: adapter.route.id,
      model: adapter.route.model,
      executionMode: adapter.route.executionMode,
      costType: adapter.route.costType,
    };
  }
}
