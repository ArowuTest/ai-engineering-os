import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

type AgentApi = {
  createAgentRecord(input: Record<string, unknown>): Record<string, unknown>;
};
function api(): AgentApi {
  const candidate = domain as unknown as Partial<AgentApi>;
  expect(typeof candidate.createAgentRecord).toBe('function');
  return candidate as AgentApi;
}
const now = new Date('2026-08-19T18:50:00.000Z');

describe('governed agent estate', () => {
  it('keeps specialist agent identity separate from model and harness selection', () => {
    const agent = api().createAgentRecord({
      id: 'agent.backend', capabilityId: 'agent.backend',
      displayName: 'Backend', specialistRole: 'backend',
      description: 'Backend engineering specialist', createdBy: 'bootstrap', createdAt: now,
    });
    expect(agent).toMatchObject({
      id: 'agent.backend', capabilityId: 'agent.backend', displayName: 'Backend',
      specialistRole: 'backend', status: 'active',
    });
    expect(agent).not.toHaveProperty('modelRouteId');
    expect(agent).not.toHaveProperty('harnessId');
  });
  it('rejects fixed model or harness bindings on an agent record', () => {
    const base = {
      id: 'agent.security', capabilityId: 'agent.security',
      displayName: 'Security', specialistRole: 'security',
      description: 'Security specialist', createdBy: 'bootstrap', createdAt: now,
    };
    expect(() => api().createAgentRecord({ ...base, modelRouteId: 'openai.gpt' }))
      .toThrow(/model|binding|agent/i);
    expect(() => api().createAgentRecord({ ...base, harnessId: 'codex' }))
      .toThrow(/harness|binding|agent/i);
  });

  it('validates agent identity without hard-coding today’s specialist roster', () => {
    const agent = api().createAgentRecord({
      id: 'agent.principal_lead', capabilityId: 'agent.principal_lead',
      displayName: 'Principal Lead', specialistRole: 'principal_lead',
      description: 'Coordinates a governed engineering team', createdBy: 'bootstrap', createdAt: now,
    });
    expect(agent.specialistRole).toBe('principal_lead');
  });
});