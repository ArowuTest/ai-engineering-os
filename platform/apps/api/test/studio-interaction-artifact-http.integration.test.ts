import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityRecord, createCapabilityReleasePolicy } from '@engineering-os/domain';
import {
  AuditRepository, CapabilityEstateRepository, ConversationRepository, DatabaseUnitOfWork,
  KnowledgeRepository, MembershipRepository, PlatformMembershipRepository, ProjectRepository,
  StudioInteractionArtifactRepository, UserRepository,
} from '@engineering-os/database';
import { ModelGateway, type ModelAdapter, type ModelRequest, type ModelRoute } from '@engineering-os/model-gateway';
import { buildApp } from '../src/app.js';
import { CapabilityEstateService } from '../src/capability-estate-service.js';
import type { StudioArtifactSemanticNormalizer } from '../src/studio-artifact-context.js';
import { closeDatabase, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const organisationId = 'org-001';
const now = new Date('2026-08-20T04:00:00.000Z');
let actorUserId = '';
let storedPayloads: Buffer[] = [];
let deletedReferences: string[] = [];
let semanticCalls: Array<{ kind: string; source: string; mediaType: string; data: Buffer }> = [];

const semanticNormalizer: StudioArtifactSemanticNormalizer = {
  async normalize(input) {
    semanticCalls.push({
      kind: input.kind,
      source: input.source,
      mediaType: input.mediaType,
      data: Buffer.from(input.data),
    });
    return input.kind === 'audio'
      ? 'Please review the payment retry flow.'
      : `normalized ${input.kind} context`;
  },
};

const objectStorage = {
  async put(input: { data: Uint8Array }) {
    storedPayloads.push(Buffer.from(input.data));
    return {
      reference: 'objects/aaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb/11111111-1111-4111-8111-111111111111',
      digestSha256: 'c'.repeat(64),
      byteSize: input.data.byteLength,
    };
  },
  async read() { return Buffer.from('audio-bytes'); },
  async delete(reference: string) { deletedReferences.push(reference); return true; },
};

function route(): ModelRoute {
  return { id: 'openai-studio-api', provider: 'openai', model: 'openai-studio', executionMode: 'api',
    costType: 'metered_api', available: true, priority: 1,
    capabilities: { chat: true, tools: false, vision: false, files: false, mcp: false,
      localWorkspace: false, headless: true, structuredOutput: true } };
}
function adapter(requests: ModelRequest[]): ModelAdapter {
  return { route: route(), async execute(request) {
    requests.push(request); return { content: JSON.stringify({ answer: 'ok', candidates: [] }) };
  } };
}

async function seedActor() {
  actorUserId = randomUUID();
  await new UserRepository(pool).create({ id: actorUserId, userId: 'studio.artifact.actor',
    passwordHash: 'test-hash', status: 'active', createdAt: now, updatedAt: now });
  await new MembershipRepository(pool).grantOrganisation({
    organisationId, userId: actorUserId, role: 'owner', createdBy: 'test', now,
  });
}

function appWith(
  gateway: ModelGateway,
  options: { semanticNormalizer?: StudioArtifactSemanticNormalizer | null } = {},
) {
  const unitOfWork = new DatabaseUnitOfWork(pool);
  const capabilityEstateService = new CapabilityEstateService({
    unitOfWork, capabilities: new CapabilityEstateRepository(pool),
    memberships: new MembershipRepository(pool), platformMemberships: new PlatformMembershipRepository(pool),
    projects: new ProjectRepository(pool), modelGateway: gateway,
  });
  return buildApp({
    projects: new ProjectRepository(pool), knowledge: new KnowledgeRepository(pool),
    conversations: new ConversationRepository(pool), unitOfWork, modelGateway: gateway,
    capabilityEstateService, studioInteractionArtifacts: new StudioInteractionArtifactRepository(pool),
    objectStorage,
    ...(options.semanticNormalizer === null
      ? {}
      : { studioArtifactSemanticNormalizer: options.semanticNormalizer ?? semanticNormalizer }),
  });
}

async function createProject(app: ReturnType<typeof appWith>, name: string) {
  const headers = { 'x-organisation-id': organisationId, 'x-user-id': actorUserId };
  const response = await app.inject({ method: 'POST', url: '/projects', headers,
    payload: { name, preferredProductPartner: 'auto' } });
  expect(response.statusCode).toBe(201);
  return { id: (response.json() as { id: string }).id, headers };
}

async function releaseDefaults(projectId: string) {
  const store = new CapabilityEstateRepository(pool);
  const capabilities = [
    ['agent.lead', 'agent', 'agents/lead.md'],
    ['harness.codex', 'harness', 'harness:codex'],
    ['model.openai-studio', 'model_route', 'openai-studio-api'],
  ] as const;
  for (const [id, kind, sourceRef] of capabilities) {
    await store.createCapability(createCapabilityRecord({
      id, kind, source: kind === 'model_route' ? 'model_gateway' : 'ecc', sourceRef,
      displayName: id, maturity: 'supported', governanceState: 'approved',
      executionVerification: 'verified', createdBy: 'test', createdAt: now,
    }));
    await store.createRelease(createCapabilityReleasePolicy({
      id: `release.${id}.${projectId.slice(0, 8)}`, capabilityId: id, scope: 'project',
      organisationId, projectId, createdBy: 'test', createdAt: now,
    }));
  }
}

async function registerAudioArtifact(app: ReturnType<typeof appWith>, project: { id: string; headers: Record<string, string> }) {
  const response = await app.inject({
    method: 'POST', url: `/projects/${project.id}/interaction-artifacts`,
    headers: { ...project.headers, 'content-type': 'application/octet-stream',
      'x-studio-artifact-kind': 'audio', 'x-studio-artifact-source': 'microphone',
      'x-studio-artifact-media-type': 'audio/webm',
      'x-studio-artifact-context-text': 'FORGED CLIENT TRANSCRIPT MUST NOT WIN' },
    payload: Buffer.from('audio-bytes'),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

beforeEach(async () => {
  storedPayloads = [];
  deletedReferences = [];
  semanticCalls = [];
  await resetDatabase();
  await seedActor();
});
afterAll(async () => closeDatabase());

describe('Studio interaction artifact HTTP boundary', () => {
  it('registers metadata atomically with audit and never stores media bytes in the row contract', async () => {
    const gateway = new ModelGateway(); gateway.register(adapter([]));
    const app = appWith(gateway); const project = await createProject(app, 'Artifact Project');
    const created = await registerAudioArtifact(app, project);
    const stored = await new StudioInteractionArtifactRepository(pool)
      .getById(organisationId, project.id, created.id);
    expect(stored).toMatchObject({
      id: created.id, kind: 'audio', source: 'microphone', mediaType: 'audio/webm',
      digestSha256: 'c'.repeat(64), contextText: 'Please review the payment retry flow.',
      createdBy: actorUserId,
    });
    expect(stored).not.toHaveProperty('bytes');
    expect(stored?.storageReference).toMatch(/^objects\//);
    expect(storedPayloads).toEqual([Buffer.from('audio-bytes')]);
    expect(semanticCalls).toEqual([{
      kind: 'audio', source: 'microphone', mediaType: 'audio/webm', data: Buffer.from('audio-bytes'),
    }]);
    const events = await new AuditRepository(pool).listByProject(organisationId, project.id);
    expect(events.some((event) => event.eventType === 'studio.interaction_artifact.created')).toBe(true);
    await app.close();
  });

  it('passes only safe governed artifact references into the Product Partner request', async () => {
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway(); gateway.register(adapter(requests));
    const app = appWith(gateway); const project = await createProject(app, 'Artifact Turn');
    await releaseDefaults(project.id);
    const artifact = await registerAudioArtifact(app, project);
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/product-partner-turn`, headers: project.headers,
      payload: { content: 'Continue from the voice instruction.', artifactIds: [artifact.id] },
    });
    expect(response.statusCode).toBe(201);
    const inputArtifacts = (requests[0] as ModelRequest & { inputArtifacts?: Array<Record<string, unknown>> })
      .inputArtifacts;
    expect(inputArtifacts).toEqual([{ artifactId: artifact.id, kind: 'audio', mediaType: 'audio/webm',
      digestSha256: 'c'.repeat(64), contextText: 'Please review the payment retry flow.' }]);
    expect(inputArtifacts?.[0]).not.toHaveProperty('storageReference');
    const modelContext = requests[0]?.messages.map((message) => message.content).join('\\n') ?? '';
    expect(modelContext).toContain('Please review the payment retry flow.');
    expect(modelContext).toMatch(/untrusted user-provided data/i);
    expect(modelContext).not.toContain('storageReference');
    expect(modelContext).not.toContain('objects/aaaaaaaaaaaaaaaa');
    expect(requests[0]?.messages.at(-1)).toEqual({
      role: 'user', content: 'Continue from the voice instruction.',
    });
    await app.close();
  });

  it('materializes text locally and does not require a semantic normalizer', async () => {
    const gateway = new ModelGateway(); gateway.register(adapter([]));
    const app = appWith(gateway, { semanticNormalizer: null });
    const project = await createProject(app, 'Text Artifact');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/interaction-artifacts`,
      headers: { ...project.headers, 'content-type': 'application/octet-stream',
        'x-studio-artifact-kind': 'document', 'x-studio-artifact-source': 'upload',
        'x-studio-artifact-media-type': 'text/plain' },
      payload: Buffer.from('  governed checkout rules  ', 'utf8'),
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { contextText?: string }).contextText).toBe('governed checkout rules');
    expect(semanticCalls).toEqual([]);
    await app.close();
  });

  it('fails closed before storage when semantic normalization is unavailable', async () => {
    const gateway = new ModelGateway(); gateway.register(adapter([]));
    const app = appWith(gateway, { semanticNormalizer: null });
    const project = await createProject(app, 'No Voice Normalizer');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/interaction-artifacts`,
      headers: { ...project.headers, 'content-type': 'application/octet-stream',
        'x-studio-artifact-kind': 'audio', 'x-studio-artifact-source': 'microphone',
        'x-studio-artifact-media-type': 'audio/webm' },
      payload: Buffer.from('voice-bytes'),
    });
    expect(response.statusCode).toBe(503);
    expect(storedPayloads).toEqual([]);
    await app.close();
  });

  it('fails closed before provider execution when an artifact belongs to another project', async () => {
    const requests: ModelRequest[] = [];
    const gateway = new ModelGateway(); gateway.register(adapter(requests));
    const app = appWith(gateway);
    const first = await createProject(app, 'Artifact Source');
    const second = await createProject(app, 'Artifact Target');
    await releaseDefaults(first.id);
    const artifact = await registerAudioArtifact(app, first);
    const response = await app.inject({
      method: 'POST', url: `/projects/${second.id}/product-partner-turn`, headers: second.headers,
      payload: { content: 'This must not cross project boundaries.', artifactIds: [artifact.id] },
    });
    expect(response.statusCode).toBe(404);
    expect(requests).toEqual([]);
    const conversations = new ConversationRepository(pool);
    const conversation = await conversations.getByProject(organisationId, second.id);
    expect(conversation).not.toBeNull();
    expect(await conversations.listMessages(organisationId, second.id, conversation!.id)).toEqual([]);
    await app.close();
  });

  it('rejects invalid artifact declaration before normalization or storage', async () => {
    const gateway = new ModelGateway(); gateway.register(adapter([]));
    const app = appWith(gateway); const project = await createProject(app, 'Invalid Media');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/interaction-artifacts`,
      headers: { ...project.headers, 'content-type': 'application/octet-stream',
        'x-studio-artifact-kind': 'image', 'x-studio-artifact-source': 'upload',
        'x-studio-artifact-media-type': 'audio/webm' },
      payload: Buffer.from('invalid-image-bytes'),
    });
    expect(response.statusCode).toBe(400);
    expect(semanticCalls).toEqual([]);
    expect(storedPayloads).toEqual([]);
    expect(deletedReferences).toEqual([]);
    await app.close();
  });

  it('rejects browser-supplied storage references instead of trusting client object authority', async () => {
    const gateway = new ModelGateway(); gateway.register(adapter([]));
    const app = appWith(gateway); const project = await createProject(app, 'Unsafe Reference');
    const response = await app.inject({
      method: 'POST', url: `/projects/${project.id}/interaction-artifacts`, headers: project.headers,
      payload: { kind: 'audio', source: 'microphone', storageReference: '../../secret',
        digestSha256: 'd'.repeat(64), mediaType: 'audio/webm', byteSize: 10,
        visibility: 'project', retentionPolicy: 'project_default' },
    });
    expect(response.statusCode).toBe(415);
    expect(storedPayloads).toEqual([]);
    await app.close();
  });
});