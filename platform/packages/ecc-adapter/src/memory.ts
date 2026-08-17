import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  collaborativeMemoryTargetsAllow,
  createCollaborativeMemoryRecord,
  type CollaborativeMemoryRecord,
  type MemoryKind,
  type MemoryTrustState,
  type MemoryVisibility,
} from '@engineering-os/domain';

const require = createRequire(import.meta.url);

interface EccMemoryDocument {
  schema: 'ecc.memory.v1';
  id: string;
  title: string;
  kind: 'context' | 'decision' | 'fact' | 'handoff' | 'lesson' | 'note' | 'preference' | 'runbook';
  scope: 'project' | 'team' | 'user';
  trust: 'unreviewed';
  status: 'active' | 'rejected' | 'superseded';
  sourceHarness: string;
  targetHarnesses: string[];
  tags: string[];
  links: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
}

interface EccFormatRuntime {
  parseMemoryDocument(source: string, sourcePath?: string): EccMemoryDocument;
  serializeMemoryDocument(memory: EccMemoryDocument): string;
  findPotentialSecrets(value: string): string[];
}
interface EccVaultRuntime {
  resolveVaultRoots(options: {
    cwd: string;
    homeDir: string;
    env: Record<string, string>;
  }): { project: string; team: string; user: string };
  saveMemory(
    input: {
      id: string;
      title: string;
      body: string;
      kind: EccMemoryDocument['kind'];
      scope: EccMemoryDocument['scope'];
      sourceHarness: string;
      targetHarnesses: string[];
      tags?: string[];
      links?: string[];
    },
    options: {
      roots: { project: string; team: string; user: string };
      now: () => string;
      idFactory: () => string;
    },
  ): { memory: EccMemoryDocument; path: string };
}

interface PathSafetyRuntime {
  assertWithinTrustedRoot(target: string, root: string, action?: string): string;
}

const eccFormat = require('../../../../scripts/lib/memory-vault-format.js') as EccFormatRuntime;
const eccVault = require('../../../../scripts/lib/memory-vault.js') as EccVaultRuntime;
const pathSafety = require('../../../../scripts/lib/path-safety.js') as PathSafetyRuntime;

const ECC_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,127}$/;
const ECC_EXPORTABLE_KINDS = new Set<MemoryKind>([
  'context', 'decision', 'fact', 'handoff', 'lesson', 'note', 'preference', 'runbook',
]);
export interface ParseEccMemoryDocumentOptions {
  organisationId?: string;
  projectId?: string;
  ownerUserId?: string;
  createdBy: string;
  sourceReference?: string;
}

export interface EccMemoryImportCandidate {
  record: CollaborativeMemoryRecord;
  eccScope: EccMemoryDocument['scope'];
  eccStatus: EccMemoryDocument['status'];
  eccUpdatedAt: Date;
  linkedMemoryIds: string[];
  sourceDocumentDigest: string;
}

export type EccMemoryImportClassification = 'new' | 'idempotent' | 'conflict';

function canonicalDocumentDigest(memory: EccMemoryDocument): string {
  return createHash('sha256')
    .update(Buffer.from(eccFormat.serializeMemoryDocument(memory), 'utf8'))
    .digest('hex');
}

function requireProjectScope(options: ParseEccMemoryDocumentOptions): {
  organisationId: string;
  projectId: string;
} {
  if (!options.organisationId || !options.projectId) {
    throw new Error('ECC project/team memory import requires organisation and project identity');
  }
  return { organisationId: options.organisationId, projectId: options.projectId };
}

function importTrust(status: EccMemoryDocument['status']): MemoryTrustState {
  if (status === 'rejected') return 'rejected';
  if (status === 'superseded') return 'superseded';
  return 'unreviewed';
}
export function parseEccMemoryDocument(
  source: string,
  options: ParseEccMemoryDocumentOptions,
): EccMemoryImportCandidate {
  const sourceLabel = options.sourceReference ?? '<ecc-memory>';
  const parsed = eccFormat.parseMemoryDocument(source, sourceLabel);
  const secretKinds = eccFormat.findPotentialSecrets(JSON.stringify(parsed));
  if (secretKinds.length > 0) {
    throw new Error(`Refusing ECC memory containing suspected secret (${secretKinds.join(', ')})`);
  }
  const sourceDocumentDigest = canonicalDocumentDigest(parsed);
  const common = {
    id: parsed.id,
    kind: parsed.kind,
    trust: importTrust(parsed.status),
    title: parsed.title,
    content: parsed.body,
    createdBy: options.createdBy,
    sourceType: 'ecc_import' as const,
    sourceHarnessId: parsed.sourceHarness,
    sourceSchema: parsed.schema,
    sourceDocumentDigest,
    ...(options.sourceReference === undefined ? {} : { sourceReference: options.sourceReference }),
    tags: [...parsed.tags],
    targetHarnessIds: [...parsed.targetHarnesses],
    createdAt: new Date(parsed.createdAt),
  };

  const record = parsed.scope === 'user'
    ? createCollaborativeMemoryRecord({
        ...common,
        scope: 'user',
        visibility: 'user_private',
        ownerUserId: options.ownerUserId ?? (() => { throw new Error('ECC user memory import requires ownerUserId'); })(),
      })
    : createCollaborativeMemoryRecord({
        ...common,
        ...requireProjectScope(options),
        scope: 'project',
        visibility: 'project_shared',
      });

  return {
    record,
    eccScope: parsed.scope,
    eccStatus: parsed.status,
    eccUpdatedAt: new Date(parsed.updatedAt),
    linkedMemoryIds: [...parsed.links],
    sourceDocumentDigest,
  };
}
export function classifyEccMemoryImport(
  existing: CollaborativeMemoryRecord | null,
  candidate: EccMemoryImportCandidate,
): EccMemoryImportClassification {
  if (existing === null) return 'new';
  if (existing.id !== candidate.record.id) return 'conflict';
  return existing.sourceDocumentDigest === candidate.sourceDocumentDigest
    ? 'idempotent'
    : 'conflict';
}

export interface MaterializeCollaborativeMemoryOptions {
  approvedRoot: string;
  taskRoot: string;
  allowedVisibilities: MemoryVisibility[];
  sourceHarness: string;
  targetHarnesses: string[];
  agentId?: string;
  sessionId?: string;
  tags?: string[];
  linkedMemoryIds?: string[];
  now?: Date;
}

function exportKind(kind: MemoryKind): EccMemoryDocument['kind'] {
  if (ECC_EXPORTABLE_KINDS.has(kind)) return kind as EccMemoryDocument['kind'];
  if (kind === 'checkpoint') return 'context';
  return 'note';
}

function exportScope(record: CollaborativeMemoryRecord): EccMemoryDocument['scope'] {
  return record.visibility === 'user_private' ? 'user' : 'project';
}

export function materializeCollaborativeMemoryToEcc(
  input: CollaborativeMemoryRecord,
  options: MaterializeCollaborativeMemoryOptions,
): { path: string; eccMemory: EccMemoryDocument; sourceDocumentDigest: string } {
  const record = createCollaborativeMemoryRecord(input);
  if (!options.allowedVisibilities.includes(record.visibility)) {
    throw new Error(`memory visibility ${record.visibility} is not authorized for ECC materialization`);
  }
  if (record.trust === 'rejected' || record.trust === 'superseded') {
    throw new Error(`memory trust ${record.trust} is not active for ECC materialization`);
  }
  const materializationHarnesses = options.targetHarnesses.length > 0
    ? options.targetHarnesses
    : [undefined];
  for (const harnessId of materializationHarnesses) {
    if (!collaborativeMemoryTargetsAllow(record, {
      ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(harnessId === undefined ? {} : { harnessId }),
    })) {
      throw new Error('Collaborative Memory target restrictions do not authorize ECC materialization');
    }
  }
  if (!ECC_ID_PATTERN.test(record.id)) {
    throw new Error('Collaborative Memory id is not compatible with ecc.memory.v1');
  }
  pathSafety.assertWithinTrustedRoot(options.taskRoot, options.approvedRoot, 'materialize ECC memory');
  mkdirSync(options.taskRoot, { recursive: true });
  const projectVault = join(options.taskRoot, '.ecc', 'memory');
  const userVault = join(options.taskRoot, '.ecc', 'user-memory');
  const roots = eccVault.resolveVaultRoots({
    cwd: options.taskRoot,
    homeDir: options.taskRoot,
    env: {
      ECC_MEMORY_PROJECT_ROOT: projectVault,
      ECC_MEMORY_USER_ROOT: userVault,
    },
  });
  const timestamp = (options.now ?? record.createdAt).toISOString();
  const saved = eccVault.saveMemory({
    id: record.id,
    title: record.title,
    body: record.content,
    kind: exportKind(record.kind),
    scope: exportScope(record),
    sourceHarness: options.sourceHarness,
    targetHarnesses: [...options.targetHarnesses],
    tags: [...(options.tags ?? record.tags ?? [])],
    links: [...(options.linkedMemoryIds ?? [])],
  }, {
    roots,
    now: () => timestamp,
    idFactory: () => record.id,
  });

  pathSafety.assertWithinTrustedRoot(saved.path, options.taskRoot, 'return ECC memory materialization');
  return {
    path: saved.path,
    eccMemory: saved.memory,
    sourceDocumentDigest: canonicalDocumentDigest(saved.memory),
  };
}
