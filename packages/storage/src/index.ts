/**
 * Storage abstraction for Holonet.
 *
 * - `fs` provider: local filesystem for development (STORAGE_PROVIDER=fs),
 *   rooted at STORAGE_LOCAL_DIR (default .holonet-storage).
 * - `oss` provider: Alibaba Cloud OSS for production (STORAGE_PROVIDER=oss).
 *
 * See docs/infrastructure.md for the bucket path conventions.
 */

export * from './provider.js';
export * from './content-types.js';
export * from './keys.js';
export * from './fs.js';
export * from './oss.js';

import { createFsStorageProvider } from './fs.js';
import { createAlibabaOssStorageProvider, type OssCredentials } from './oss.js';
import type { StorageProvider } from './provider.js';

export type StorageScope = 'public' | 'private';

/**
 * Process-wide source of temporary (STS) OSS credentials, used when no static
 * OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET are configured. The API and builder
 * entrypoints register a provider that reads the Function Compute invocation
 * context (RAM-role credentials); locally it stays unregistered and static
 * env keys (or the SDK's environment fallback) are used instead.
 */
let ossCredentialsProvider: (() => OssCredentials | undefined) | undefined;

export function setOssCredentialsProvider(
  provider: (() => OssCredentials | undefined) | undefined,
): void {
  ossCredentialsProvider = provider;
}

export function getOssCredentialsProvider(): (() => OssCredentials | undefined) | undefined {
  return ossCredentialsProvider;
}

/**
 * Creates the storage provider for the given bucket scope from environment
 * variables (rules 10/11 — credentials are never hardcoded):
 *
 * - STORAGE_PROVIDER: 'fs' (default) or 'oss'
 * - fs:  STORAGE_LOCAL_DIR, PUBLIC_BASE_URL
 * - oss: OSS_REGION (fallback ALIBABA_CLOUD_REGION), OSS_ENDPOINT,
 *        OSS_PUBLIC_BUCKET / OSS_PRIVATE_BUCKET, OSS_ACCESS_KEY_ID /
 *        OSS_ACCESS_KEY_SECRET (local testing), OSS_ROLE_ARN (informational),
 *        OSS_PUBLIC_BASE_URL. Without static keys, credentials come from the
 *        registered STS provider (setOssCredentialsProvider — FC RAM role).
 */
export function createStorageProviderFromEnv(scope: StorageScope): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER ?? 'fs';

  if (provider === 'fs') {
    return createFsStorageProvider({
      rootDir: process.env.STORAGE_LOCAL_DIR ?? '.holonet-storage',
      bucket: scope,
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
    });
  }

  if (provider === 'oss') {
    const region = process.env.OSS_REGION ?? process.env.ALIBABA_CLOUD_REGION;
    if (!region) {
      throw new Error('OSS storage requires OSS_REGION (or ALIBABA_CLOUD_REGION)');
    }
    const bucket =
      scope === 'public' ? process.env.OSS_PUBLIC_BUCKET : process.env.OSS_PRIVATE_BUCKET;
    if (!bucket) {
      throw new Error(`OSS storage requires OSS_${scope.toUpperCase()}_BUCKET`);
    }
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID || undefined;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || undefined;
    return createAlibabaOssStorageProvider({
      region,
      bucket,
      endpoint: process.env.OSS_ENDPOINT || undefined,
      accessKeyId,
      accessKeySecret,
      credentialsProvider: accessKeyId && accessKeySecret ? undefined : ossCredentialsProvider,
      roleArn: process.env.OSS_ROLE_ARN || undefined,
      publicBaseUrl: scope === 'public' ? process.env.OSS_PUBLIC_BASE_URL || undefined : undefined,
    });
  }

  throw new Error(`unknown STORAGE_PROVIDER: ${provider}`);
}
