export interface ObjectStoragePutInput {
  organisationId: string;
  projectId: string;
  data: Uint8Array;
}

export interface StoredObject {
  reference: string;
  digestSha256: string;
  byteSize: number;
}

export interface ObjectStorageProvider {
  put(input: ObjectStoragePutInput): Promise<StoredObject>;
  read(reference: string): Promise<Uint8Array>;
  delete(reference: string): Promise<boolean>;
}

export interface LocalObjectStorageProviderOptions {
  rootPath: string;
  maxObjectBytes?: number;
}
