import { describe, expect, it } from 'vitest';
import {
  DomainPackRegistry,
  createDomainPackDescriptor,
  domainPackDiscoveredCapabilities,
} from '../src/domain-pack.js';

describe('Domain Pack descriptor boundary', () => {
  const input = {
    id: 'domain.research-tools',
    version: '1.2.0',
    publisher: 'aios-labs',
    source: 'registry.internal',
    governanceState: 'approved' as const,
    capabilities: [
      { id: 'workflow.literature-review', kind: 'workflow' as const, displayName: 'Literature Review' },
      { id: 'agent.research-reviewer', kind: 'agent' as const, displayName: 'Research Reviewer' },
    ],
    agentRoles: ['research_reviewer'],
    workflowTypes: ['literature_review'],
    artifactTypes: ['research_note'],
    evidenceTypes: ['source_citation'],
    reviewPolicies: ['independent_source_review'],
    toolRequirements: ['connector.scholar'],
    executionRequirements: ['network.research'],
    schemaContributions: ['research.claim.v1'],
    uiExtensions: [
      { surface: 'project' as const, slot: 'evidence', viewId: 'research-evidence', label: 'Research evidence' },
    ],
  };

  it('creates a bounded declarative versioned descriptor without executable or authority-bearing fields', () => {
    const descriptor = createDomainPackDescriptor({
      ...input,
      credentialId: 'must-not-survive',
      organisationId: 'must-not-survive',
      execute: () => 'must-not-survive',
    } as typeof input & Record<string, unknown>);

    expect(descriptor).toMatchObject({
      id: 'domain.research-tools',
      version: '1.2.0',
      publisher: 'aios-labs',
      source: 'registry.internal',
      governanceState: 'approved',
    });
    expect(descriptor.capabilities.map((capability) => capability.id)).toEqual([
      'workflow.literature-review', 'agent.research-reviewer',
    ]);
    expect(descriptor).not.toHaveProperty('credentialId');
    expect(descriptor).not.toHaveProperty('organisationId');
    expect(descriptor).not.toHaveProperty('execute');
  });

  it('projects contributions into Capability Estate discovery without implying approval, release or execution verification', () => {
    const descriptor = createDomainPackDescriptor(input);
    const capabilities = domainPackDiscoveredCapabilities(descriptor);

    expect(capabilities).toEqual([
      expect.objectContaining({
        id: 'workflow.literature-review',
        kind: 'workflow',
        source: 'domain_pack',
        sourceRef: 'domain.research-tools@1.2.0:workflow.literature-review',
        maturity: 'discovered',
        governanceState: 'discovered',
        executionVerification: 'unverified',
      }),
      expect.objectContaining({
        id: 'agent.research-reviewer',
        kind: 'agent',
        source: 'domain_pack',
        sourceRef: 'domain.research-tools@1.2.0:agent.research-reviewer',
        maturity: 'discovered',
        governanceState: 'discovered',
        executionVerification: 'unverified',
      }),
    ]);
  });

  it('fails closed for unstable identity, invalid versions, duplicate capability IDs and unsupported capability kinds', () => {
    expect(() => createDomainPackDescriptor({ ...input, id: 'not stable!' })).toThrow(/id/i);
    expect(() => createDomainPackDescriptor({ ...input, version: 'latest' })).toThrow(/version/i);
    const firstCapability = input.capabilities[0]!;
    expect(() => createDomainPackDescriptor({
      ...input,
      capabilities: [firstCapability, firstCapability],
    })).toThrow(/duplicate/i);
    expect(() => createDomainPackDescriptor({
      ...input,
      capabilities: [{ id: 'cap.bad', kind: 'arbitrary', displayName: 'Bad' }],
    } as unknown as typeof input)).toThrow(/kind/i);
  });

  it('registers exact immutable versions and refuses silent replacement', () => {
    const registry = new DomainPackRegistry();
    const first = registry.register(createDomainPackDescriptor(input));
    const second = registry.register(createDomainPackDescriptor({ ...input, version: '1.3.0' }));

    expect(registry.get(first.id, first.version)).toEqual(first);
    expect(registry.list().map((entry) => entry.version)).toEqual(['1.2.0', '1.3.0']);
    expect(() => registry.register(first)).toThrow(/already registered/i);
    expect(second.version).toBe('1.3.0');
  });
});
