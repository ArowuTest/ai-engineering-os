import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  LocalObjectStorageProviderOptions,
  ObjectStorageProvider,
  ObjectStoragePutInput,
  StoredObject,
} from './types.js';

const REFERENCE_PATTERN = /^objects\/[a-f0-9]{16}\/[a-f0-9]{16}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scopeSegment(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function requireData(input: ObjectStoragePutInput, maxObjectBytes: number): Uint8Array {
  if (!(input.data instanceof Uint8Array)) throw new Error('Object data must be Uint8Array');
  if (input.data.byteLength <= 0) throw new Error('Object data must not be empty');
  if (input.data.byteLength > maxObjectBytes) {
    throw new Error(`Object exceeds maxObjectBytes (${maxObjectBytes})`);
  }
  return input.data;
}
function resolveReference(rootPath: string, reference: string): string {
  if (!REFERENCE_PATTERN.test(reference)) throw new Error('Invalid object storage reference');
  const target = path.resolve(rootPath, ...reference.split('/'));
  const relative = path.relative(rootPath, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid object storage reference');
  }
  return target;
}

export function createLocalObjectStorageProvider(
  options: LocalObjectStorageProviderOptions,
): ObjectStorageProvider {
  const rootPath = path.resolve(options.rootPath);
  const maxObjectBytes = options.maxObjectBytes ?? 25 * 1024 * 1024;
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes <= 0) {
    throw new Error('maxObjectBytes must be a positive safe integer');
  }

  return {
    async put(input): Promise<StoredObject> {
      const data = requireData(input, maxObjectBytes);
      const reference = `objects/${scopeSegment(input.organisationId)}/${scopeSegment(input.projectId)}/${randomUUID()}`;
      const target = resolveReference(rootPath, reference);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { flag: 'wx' });
      return { reference, digestSha256: digest(data), byteSize: data.byteLength };
    },
    async read(reference): Promise<Uint8Array> {
      return readFile(resolveReference(rootPath, reference));
    },
    async delete(reference): Promise<boolean> {
      const target = resolveReference(rootPath, reference);
      try {
        await unlink(target);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}
