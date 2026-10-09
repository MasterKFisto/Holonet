/**
 * Holonet storage provider contract.
 *
 * Two implementations ship with the package:
 * - FsStorageProvider — local filesystem (development, STORAGE_PROVIDER=fs).
 * - AlibabaOssStorageProvider — Alibaba Cloud OSS (production,
 *   STORAGE_PROVIDER=oss).
 *
 * Keys follow strict path conventions per bucket scope — see keys.ts.
 */

export type StorageProviderKind = 'fs' | 'oss';

export interface PutObjectOptions {
  /** Content type of the object (e.g. 'image/jpeg'). */
  contentType?: string;
  /** Cache-Control header value (e.g. 'public, max-age=31536000, immutable'). */
  cacheControl?: string;
}

export interface StorageObject {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  /** Logical bucket this provider writes to ('public' or 'private'). */
  readonly bucket: string;
  putObject(key: string, body: Buffer, options?: PutObjectOptions): Promise<void>;
  /** Returns null when the key does not exist. */
  getObject(key: string): Promise<StorageObject | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<string[]>;
  /** Public, unsigned URL for the object. */
  getPublicUrl(key: string): string;
  /** Time-limited signed URL (fs returns the public URL — nothing to sign). */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
