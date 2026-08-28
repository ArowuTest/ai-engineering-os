import { describe, expect, it } from 'vitest';
import type { AIConnectionRecord } from '@engineering-os/domain';
import type { AIConnectionModelRouteRecord, AIConnectionRepository } from '@engineering-os/database';
import { createConnectionFamilyPolicyRegistry } from '../src/ai-connection-policy.js';
import { createConnectionModelRouteCatalogue } from '../src/connection-model-route-catalogue.js';

const now = new Date('2026-08-21T02:00:00Z');
const caps = {
  chat: true, tools: false, vision: false, files: false, mcp: false,
  localWorkspace: false, headless: true, structuredOutput: false,
};
function connection(input: Partial<AIConnectionRecord> & Pick<AIConnectionRecord, 'id' | 'ownership'>): AIConnectionRecord {
  return {
    id: input.id, organisationId: 'org-001', ownership: input.ownership,
    ...(input.ownership === 'personal' ? { ownerUserId: input.ownerUserId ?? 'user-001' } : {}),
    providerId: input.providerId ?? 'provider-a', connectionFamilyId: input.connectionFamilyId ?? 'provider-a-api',
    credentialStrategy: 'external_secret_ref', secretRefId: 'vault:hidden', status: input.status ?? 'available',
    createdBy: 'test', createdAt: now, updatedAt: now,
  };
}
function modelRoute(connectionId: string, routeId: string, availability: 'available' | 'unavailable' = 'available'): AIConnectionModelRouteRecord {
  return {
    organisationId: 'org-001', connectionId, routeId, capabilityId: `cap.${routeId}`,
    providerId: 'provider-a', providerModelId: `model/${routeId}`, displayName: routeId,
    availability, capabilities: caps, firstDiscoveredAt: now, lastSeenAt: now,
  };
}
const policy = createConnectionFamilyPolicyRegistry([{
  id: 'provider-a-api', providerId: 'provider-a', providerAdapterId: 'provider-a-compatible',
  displayName: 'Provider A', executionMode: 'api', allowedOwnership: ['personal', 'organisation'],
  credentialStrategies: ['external_secret_ref'], delegatable: false, requiresRunner: false, persistentSupported: false,
}]);

describe('connection model route catalogue', () => {
  it('returns only technically available routes from the actor personal and organisation connections', async () => {
    const connections = [
      connection({ id: 'own', ownership: 'personal', ownerUserId: 'user-001' }),
      connection({ id: 'wrong-owner', ownership: 'personal', ownerUserId: 'user-999' }),
      connection({ id: 'org', ownership: 'organisation' }),
      connection({ id: 'revoked', ownership: 'organisation', status: 'revoked' }),
    ];
    const routes = new Map([
      ['own', [modelRoute('own', 'route-own')]],
      ['wrong-owner', [modelRoute('wrong-owner', 'route-wrong')]],
      ['org', [modelRoute('org', 'route-org'), modelRoute('org', 'route-stale', 'unavailable')]],
      ['revoked', [modelRoute('revoked', 'route-revoked')]],
    ]);
    const repository = {
      async listForUser() { return connections.filter((c) => c.ownership === 'personal'); },
      async listOrganisationConnections() { return connections.filter((c) => c.ownership === 'organisation'); },
      async listModelRoutes(_org: string, id: string) { return routes.get(id) ?? []; },
    } as Pick<AIConnectionRepository, 'listForUser' | 'listOrganisationConnections' | 'listModelRoutes'>;
    const catalogue = createConnectionModelRouteCatalogue({ aiConnections: repository, policy });
    const result = await catalogue.listAvailableForProject({
      organisationId: 'org-001', projectId: 'project-001', actorUserId: 'user-001',
    });
    expect(result.map((route) => route.id)).toEqual(['route-org', 'route-own']);
    expect(result.find((route) => route.id === 'route-own')?.connection)
      .toEqual({ id: 'own', ownerType: 'user', ownerId: 'user-001' });
    expect(result.find((route) => route.id === 'route-org')?.connection)
      .toEqual({ id: 'org', ownerType: 'organisation', ownerId: 'org-001' });
    expect(JSON.stringify(result)).not.toContain('vault:hidden');
  });

  it('fails closed for family/provider mismatch instead of manufacturing a route', async () => {
    const mismatched = connection({ id: 'bad', ownership: 'personal', providerId: 'other-provider' });
    const repository = {
      async listForUser() { return [mismatched]; }, async listOrganisationConnections() { return []; },
      async listModelRoutes() { return [modelRoute('bad', 'route-bad')]; },
    } as Pick<AIConnectionRepository, 'listForUser' | 'listOrganisationConnections' | 'listModelRoutes'>;
    const catalogue = createConnectionModelRouteCatalogue({ aiConnections: repository, policy });
    expect(await catalogue.listAvailableForProject({
      organisationId: 'org-001', projectId: 'project-001', actorUserId: 'user-001',
    })).toEqual([]);
  });
});
