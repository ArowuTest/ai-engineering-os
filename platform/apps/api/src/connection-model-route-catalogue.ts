import type { AIConnectionRepository } from '@engineering-os/database';
import type { AIConnectionRecord } from '@engineering-os/domain';
import type { ModelRoute, ProviderCapabilities } from '@engineering-os/model-gateway';
import type { ConnectionFamilyPolicyRegistry } from './ai-connection-policy.js';

export interface ConnectionModelRouteCatalogueDependencies {
  aiConnections: Pick<
    AIConnectionRepository,
    'listForUser' | 'listOrganisationConnections' | 'listModelRoutes'
  >;
  policy: ConnectionFamilyPolicyRegistry;
}

function connectionIsEligible(
  connection: AIConnectionRecord,
  organisationId: string,
  actorUserId: string,
  policy: ConnectionFamilyPolicyRegistry,
): boolean {
  if (connection.organisationId !== organisationId || connection.status !== 'available') return false;
  if (connection.ownership === 'personal' && connection.ownerUserId !== actorUserId) return false;
  const family = policy.get(connection.connectionFamilyId);
  return family !== null
    && family.providerId === connection.providerId
    && family.executionMode === 'api'
    && family.requiresRunner === false
    && family.providerAdapterId !== undefined
    && family.allowedOwnership.includes(connection.ownership)
    && family.credentialStrategies.includes(connection.credentialStrategy);
}

function providerCapabilitiesFromRecord(value: Record<string, boolean>): ProviderCapabilities {
  return {
    chat: value.chat === true,
    tools: value.tools === true,
    vision: value.vision === true,
    files: value.files === true,
    mcp: value.mcp === true,
    localWorkspace: value.localWorkspace === true,
    headless: value.headless === true,
    structuredOutput: value.structuredOutput === true,
  };
}
function toRoute(
  connection: AIConnectionRecord,
  record: Awaited<ReturnType<AIConnectionRepository['listModelRoutes']>>[number],
): ModelRoute | null {
  if (record.availability !== 'available' || record.providerId !== connection.providerId) return null;
  return {
    id: record.routeId,
    provider: record.providerId,
    model: record.providerModelId,
    connection: connection.ownership === 'personal'
      ? { id: connection.id, ownerType: 'user', ownerId: connection.ownerUserId! }
      : { id: connection.id, ownerType: 'organisation', ownerId: connection.organisationId },
    executionMode: 'api',
    costType: 'metered_api',
    available: true,
    priority: 1_000,
    capabilities: providerCapabilitiesFromRecord(record.capabilities),
  };
}

export function createConnectionModelRouteCatalogue(
  dependencies: ConnectionModelRouteCatalogueDependencies,
) {
  return Object.freeze({
    async listAvailableForProject(input: {
      organisationId: string;
      projectId: string;
      actorUserId: string;
    }): Promise<ModelRoute[]> {
      void input.projectId;
      const [personal, organisation] = await Promise.all([
        dependencies.aiConnections.listForUser(input.organisationId, input.actorUserId),
        dependencies.aiConnections.listOrganisationConnections(input.organisationId),
      ]);
      const connections = [...personal, ...organisation]
        .filter((connection) => connectionIsEligible(
          connection, input.organisationId, input.actorUserId, dependencies.policy,
        ));
      const routes: ModelRoute[] = [];
      const seen = new Set<string>();
      for (const connection of connections) {
        const records = await dependencies.aiConnections.listModelRoutes(input.organisationId, connection.id);
        for (const record of records) {
          const route = toRoute(connection, record);
          if (!route) continue;
          if (seen.has(route.id)) throw new Error(`connection model route identity collision: ${route.id}`);
          seen.add(route.id);
          routes.push(route);
        }
      }
      return routes.sort((left, right) => left.id.localeCompare(right.id));
    },
  });
}
