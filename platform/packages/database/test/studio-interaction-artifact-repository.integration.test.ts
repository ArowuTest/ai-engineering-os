import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as database from '../src/index.js';
import { createStudioInteractionArtifact } from '@engineering-os/domain';
import { closeDatabase, pool, resetDatabase } from './database-test-harness.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-20T03:45:00.000Z');

type Artifact = ReturnType<typeof createStudioInteractionArtifact>;
type Repo = {
  create(record: Artifact): Promise<void>;
  getById(organisationId: string, projectId: string, id: string): Promise<Artifact | null>;
  listByIds(organisationId: string, projectId: string, ids: string[]): Promise<Artifact[]>;
};

function repo(): Repo {
  const Ctor = (database as unknown as {
    StudioInteractionArtifactRepository?: new (db: typeof pool) => Repo;
  }).StudioInteractionArtifactRepository;
  expect(typeof Ctor).toBe('function');
  return new Ctor!(pool);
}

async function seedProjects() {
  await pool.query(
    `INSERT INTO projects
      (id, organisation_id, name, created_by, created_at, stage, preferred_product_partner, updated_at)
     VALUES ($1,'org-001','Artifact Project','test',$3,'discovery','auto',$3),
            ($2,'org-002','Other Project','test',$3,'discovery','auto',$3)`,
    [projectId, otherProjectId, now],
  );
}

function artifact(): Artifact {
  return createStudioInteractionArtifact({
    id: '44444444-4444-4444-8444-444444444444',
    organisationId: 'org-001', projectId,
    kind: 'image', source: 'screenshot',
    storageReference: 'objects/org-001/project/screenshot.png',
    digestSha256: 'b'.repeat(64), mediaType: 'image/png', byteSize: 2048,
    contextText: 'checkout error screenshot', visibility: 'project',
    retentionPolicy: 'project_default', createdBy: 'user-001', createdAt: now,
  });
}

beforeEach(async () => { await resetDatabase(); await seedProjects(); });
afterAll(async () => closeDatabase());

describe('StudioInteractionArtifactRepository', () => {
  it('round-trips governed metadata inside the owning project boundary', async () => {
    const store = repo();
    const record = artifact();
    await store.create(record);
    expect(await store.getById('org-001', projectId, record.id)).toEqual(record);
    expect(await store.getById('org-002', otherProjectId, record.id)).toBeNull();
    expect(await store.listByIds('org-001', projectId, [record.id])).toEqual([record]);
  });

  it('enforces media-family consistency at the database boundary as defence in depth', async () => {
    const invalid = {
      ...artifact(),
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'image' as const,
      source: 'upload' as const,
      mediaType: 'audio/webm',
    } as Artifact;
    await expect(repo().create(invalid)).rejects.toThrow();
  });

  it('is available transactionally through DatabaseUnitOfWork', async () => {
    const Uow = (database as unknown as {
      DatabaseUnitOfWork?: new (db: typeof pool) => {
        run<T>(work: (repos: { studioInteractionArtifacts?: Repo }) => Promise<T>): Promise<T>;
      };
    }).DatabaseUnitOfWork;
    expect(typeof Uow).toBe('function');
    const record = artifact();
    await new Uow!(pool).run(async ({ studioInteractionArtifacts }) => {
      expect(studioInteractionArtifacts).toBeDefined();
      await studioInteractionArtifacts!.create(record);
    });
    expect(await repo().getById('org-001', projectId, record.id)).toEqual(record);
  });
});