import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CapabilityKind, CapabilityMaturity } from '@engineering-os/domain';

export interface EccCapabilityInventoryItem {
  id: string;
  kind: Extract<CapabilityKind, 'harness' | 'agent' | 'skill' | 'mcp_tool' | 'workflow'>;
  source: 'ecc';
  sourceRef: string;
  displayName: string;
  maturity: CapabilityMaturity;
  governanceState: 'discovered';
  executionVerification: 'unverified';
}

interface EccHarnessRecord {
  id: string;
  label: string;
  availability?: string;
}

const require = createRequire(import.meta.url);
const STABLE_ID_LIMIT = 64;

function stableCapabilityId(kind: EccCapabilityInventoryItem['kind'], sourceIdentity: string): string {
  const slug = sourceIdentity.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'capability';
  const prefix = `ecc.${kind}.`;
  const raw = `${prefix}${slug}`;
  if (raw.length <= STABLE_ID_LIMIT) return raw;
  const digest = createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 10);
  const payloadLength = STABLE_ID_LIMIT - prefix.length - digest.length - 1;
  return `${prefix}${slug.slice(0, payloadLength).replace(/[-_.]+$/g, '')}-${digest}`;
}

function item(
  kind: EccCapabilityInventoryItem['kind'],
  sourceIdentity: string,
  sourceRef: string,
  displayName: string,
  maturity: CapabilityMaturity = 'discovered',
): EccCapabilityInventoryItem {
  return {
    id: stableCapabilityId(kind, sourceIdentity),
    kind,
    source: 'ecc',
    sourceRef,
    displayName,
    maturity,
    governanceState: 'discovered',
    executionVerification: 'unverified',
  };
}

async function discoverAgents(repositoryRoot: string): Promise<EccCapabilityInventoryItem[]> {
  const root = path.join(repositoryRoot, 'agents');
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const id = entry.name.slice(0, -3);
      return item('agent', id, `agents/${entry.name}`, id);
    });
}

async function discoverSkills(repositoryRoot: string): Promise<EccCapabilityInventoryItem[]> {
  const root = path.join(repositoryRoot, 'skills');
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => item('skill', entry.name, `skills/${entry.name}`, entry.name));
}

function discoverHarnesses(repositoryRoot: string): EccCapabilityInventoryItem[] {
  const modulePath = path.join(repositoryRoot, 'scripts', 'lib', 'harness-capabilities.js');
  const catalog = require(modulePath) as { listHarnessCapabilities(): EccHarnessRecord[] };
  return catalog.listHarnessCapabilities().map((harness) => item(
    'harness',
    harness.id,
    `harness:${harness.id}`,
    harness.label,
    harness.availability === 'guided' ? 'supported' : 'experimental',
  ));
}

async function discoverMcpTools(repositoryRoot: string): Promise<EccCapabilityInventoryItem[]> {
  const configPath = path.join(repositoryRoot, 'mcp-configs', 'mcp-servers.json');
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
  return Object.keys(raw.mcpServers ?? {})
    .sort()
    .map((name) => item('mcp_tool', name, `mcp:${name}`, name));
}

async function discoverWorkflows(repositoryRoot: string): Promise<EccCapabilityInventoryItem[]> {
  const root = path.join(repositoryRoot, 'workflows');
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.workflow.js'))
    .map((entry) => {
      const id = entry.name.slice(0, -'.workflow.js'.length);
      return item('workflow', id, `workflows/${entry.name}`, id);
    });
}

export async function discoverEccCapabilityInventory(
  repositoryRoot: string,
): Promise<EccCapabilityInventoryItem[]> {
  const [agents, skills, mcpTools, workflows] = await Promise.all([
    discoverAgents(repositoryRoot),
    discoverSkills(repositoryRoot),
    discoverMcpTools(repositoryRoot),
    discoverWorkflows(repositoryRoot),
  ]);
  const inventory = [
    ...discoverHarnesses(repositoryRoot),
    ...agents,
    ...skills,
    ...mcpTools,
    ...workflows,
  ].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(inventory.map((entry) => entry.id)).size !== inventory.length) {
    throw new Error('ECC capability inventory contains duplicate stable IDs');
  }
  return inventory;
}
