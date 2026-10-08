/**
 * Storage abstraction for Holonet.
 *
 * - `local` backend: development and tests (filesystem).
 * - `oss` backend: production static assets — Alibaba Cloud OSS
 *   (docs/PROJECT_RULES.md rule 19).
 *
 * Backend implementations arrive in a later phase; only the contract is
 * defined here. All keys MUST be workspace-prefixed (`<workspaceId>/…`) to
 * keep tenant data isolated (rule 18).
 */

export type StorageBackend = 'local' | 'oss';

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageBackendContract {
  readonly kind: StorageBackend;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export const STORAGE_BACKENDS: readonly StorageBackend[] = ['local', 'oss'] as const;
