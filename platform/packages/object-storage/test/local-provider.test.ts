import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalObjectStorageProvider } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function provider(maxObjectBytes = 1024) {
  const root = await mkdtemp(path.join(tmpdir(), 'aios-object-store-'));
  roots.push(root);
  return { root, store: createLocalObjectStorageProvider({ rootPath: root, maxObjectBytes }) };
}

describe('Local object storage provider', () => {
  it('stores bytes under a platform-generated scoped reference and verifies digest on read', async () => {
    const { root, store } = await provider();
    const data = Buffer.from('governed studio artifact');
    const stored = await store.put({ organisationId: 'org-001', projectId: '11111111-1111-4111-8111-111111111111', data });
    expect(stored.reference).toMatch(/^objects\/[a-f0-9]{16}\/[a-f0-9]{16}\/[0-9a-f-]{36}$/);
    expect(stored.byteSize).toBe(data.byteLength);
    expect(stored.digestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(await store.read(stored.reference))).toEqual(data);
    expect(await readFile(path.join(root, ...stored.reference.split('/')))).toEqual(data);
  });

  it('rejects oversized objects before writing them', async () => {
    const { store } = await provider(4);
    await expect(store.put({
      organisationId: 'org-001', projectId: '11111111-1111-4111-8111-111111111111',
      data: Buffer.from('12345'),
    })).rejects.toThrow(/maxObjectBytes/i);
  });

  it('deletes stored objects for compensating transaction cleanup', async () => {
    const { store } = await provider();
    const stored = await store.put({
      organisationId: 'org-001', projectId: '11111111-1111-4111-8111-111111111111',
      data: Buffer.from('cleanup'),
    });
    expect(await store.delete(stored.reference)).toBe(true);
    await expect(store.read(stored.reference)).rejects.toThrow();
    expect(await store.delete(stored.reference)).toBe(false);
  });

  it('does not derive storage paths from tenant input and rejects unsafe references', async () => {
    const { store } = await provider();
    const stored = await store.put({
      organisationId: '../../secret', projectId: '..\\..\\project', data: Buffer.from('safe'),
    });
    expect(stored.reference).not.toContain('..');
    expect(stored.reference).not.toContain('secret');
    await expect(store.read('../outside')).rejects.toThrow(/reference/i);
    await expect(store.read('C:\\outside')).rejects.toThrow(/reference/i);
  });
});
