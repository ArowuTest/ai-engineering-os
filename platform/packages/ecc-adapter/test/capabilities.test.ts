import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as adapter from '../src/index.js';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

type InventoryItem = {
  id: string;
  kind: 'harness' | 'agent' | 'skill' | 'mcp_tool' | 'workflow';
  source: 'ecc';
  sourceRef: string;
  displayName: string;
  maturity: 'discovered' | 'experimental' | 'supported' | 'deprecated';
  governanceState: 'discovered';
  executionVerification: 'unverified';
};

function discover(): Promise<InventoryItem[]> {
  const fn = (adapter as unknown as {
    discoverEccCapabilityInventory?: (root: string) => Promise<InventoryItem[]>;
  }).discoverEccCapabilityInventory;
  expect(typeof fn).toBe('function');
  return fn!(repositoryRoot);
}

describe('ECC capability discovery adapter', () => {
  it('discovers the complete inherited agent and skill estates through stable capability records', async () => {
    const [inventory, agentFiles, skillEntries] = await Promise.all([
      discover(),
      readdir(path.join(repositoryRoot, 'agents'), { withFileTypes: true }),
      readdir(path.join(repositoryRoot, 'skills'), { withFileTypes: true }),
    ]);
    const expectedAgents = agentFiles.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
    const expectedSkills = skillEntries.filter((entry) => entry.isDirectory()).length;
    const agents = inventory.filter((item) => item.kind === 'agent');
    const skills = inventory.filter((item) => item.kind === 'skill');
    expect(agents).toHaveLength(expectedAgents);
    expect(skills).toHaveLength(expectedSkills);
    expect(agents).toContainEqual(expect.objectContaining({ sourceRef: 'agents/a11y-architect.md', displayName: 'a11y-architect' }));
    expect(skills).toContainEqual(expect.objectContaining({ sourceRef: 'skills/accessibility', displayName: 'accessibility' }));
  });

  it('reuses the canonical ECC harness catalogue and never treats inherited model hints as bindings', async () => {
    const inventory = await discover();
    const harnesses = inventory.filter((item) => item.kind === 'harness');
    expect(harnesses.map((item) => item.sourceRef)).toEqual(expect.arrayContaining([
      'harness:claude', 'harness:codex', 'harness:antigravity', 'harness:hermes', 'harness:opencode',
    ]));
    expect(new Set(harnesses.map((item) => item.sourceRef)).size).toBe(harnesses.length);
    for (const item of inventory) {
      expect(item.governanceState).toBe('discovered');
      expect(item.executionVerification).toBe('unverified');
      expect(item).not.toHaveProperty('modelRouteId');
      expect(item).not.toHaveProperty('model');
    }
  });

  it('discovers MCP and workflow metadata without copying credentials, env values or executable command bodies', async () => {
    const inventory = await discover();
    const github = inventory.find((item) => item.kind === 'mcp_tool' && item.sourceRef === 'mcp:github');
    expect(github).toEqual(expect.objectContaining({ source: 'ecc', displayName: 'github' }));
    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain('YOUR_GITHUB_PAT_HERE');
    expect(serialized).not.toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
    expect(serialized).not.toContain('@modelcontextprotocol/server-github');
    expect(inventory.some((item) => item.kind === 'workflow' && item.sourceRef === 'workflows/orch-review.workflow.js')).toBe(true);
  });

  it('returns deterministic stable ids with no duplicate logical capability', async () => {
    const first = await discover();
    const second = await discover();
    expect(second).toEqual(first);
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
    for (const item of first) expect(item.id).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
  });
});
