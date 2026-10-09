import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertSafePrefix, assertValidKey } from './keys.js';
import type { PutObjectOptions, StorageObject, StorageProvider } from './provider.js';

const META_SUFFIX = '.meta.json';

export interface FsStorageConfig {
  /** Root directory for local storage (default: .holonet-storage). */
  rootDir: string;
  /** Logical bucket name — stored as a subdirectory under rootDir. */
  bucket: string;
  /** Base URL used by getPublicUrl (default: http://localhost:3000). */
  publicBaseUrl?: string;
}

/**
 * Local filesystem storage provider for development (STORAGE_PROVIDER=fs).
 * Content type and cache control are kept in .meta.json sidecar files.
 */
export class FsStorageProvider implements StorageProvider {
  readonly kind = 'fs' as const;
  readonly bucket: string;

  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  constructor(config: FsStorageConfig) {
    this.bucket = config.bucket;
    this.rootDir = resolve(config.rootDir);
    this.publicBaseUrl = (config.publicBaseUrl ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  private filePath(key: string): string {
    assertValidKey(key);
    const bucketRoot = resolve(this.rootDir, this.bucket);
    const fullPath = resolve(bucketRoot, ...key.split('/'));
    if (!fullPath.startsWith(bucketRoot + sep)) {
      throw new Error(`storage key escapes the local root: ${key}`);
    }
    return fullPath;
  }

  async putObject(key: string, body: Buffer, options?: PutObjectOptions): Promise<void> {
    const target = this.filePath(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    await writeFile(target + META_SUFFIX, JSON.stringify(options ?? {}));
  }

  async getObject(key: string): Promise<StorageObject | null> {
    const target = this.filePath(key);
    try {
      const body = await readFile(target);
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await readFile(target + META_SUFFIX, 'utf8')) as {
          contentType?: unknown;
        };
        if (typeof meta.contentType === 'string') {
          contentType = meta.contentType;
        }
      } catch {
        // No sidecar metadata — fall back to the default content type.
      }
      return { key, body, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.filePath(key);
    await rm(target, { force: true });
    await rm(target + META_SUFFIX, { force: true });
  }

  async listObjects(prefix: string): Promise<string[]> {
    assertSafePrefix(prefix);
    const base = resolve(this.rootDir, this.bucket, ...prefix.split('/'));
    const keys: string[] = [];
    await this.collect(base, prefix, keys);
    return keys.sort();
  }

  private async collect(dir: string, prefix: string, keys: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(META_SUFFIX)) {
        continue;
      }
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.collect(resolve(dir, entry.name), relative, keys);
      } else {
        keys.push(relative);
      }
    }
  }

  getPublicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl}/storage/${this.bucket}/${key}`;
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    // Local filesystem has no signing — the public URL is returned.
    return this.getPublicUrl(key);
  }
}

export function createFsStorageProvider(config: FsStorageConfig): FsStorageProvider {
  return new FsStorageProvider(config);
}
