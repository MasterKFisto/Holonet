import { extensionOf } from './content-types.js';

/**
 * Storage key validation and bucket path conventions.
 *
 * Every key must be relative, traversal-safe, and must live under a
 * documented prefix for its bucket scope. The conventions are:
 *
 * Public bucket (OSS_PUBLIC_BUCKET):
 *   app/...
 *   sites/{siteId}/releases/{deploymentId}/...
 *   media/public/{workspaceId}/...
 *
 * Private bucket (OSS_PRIVATE_BUCKET):
 *   media/private/{workspaceId}/...
 *   imports/{workspaceId}/{importJobId}/...
 *   backups/...
 *   forms/{siteId}/{formId}/...
 */

export const PUBLIC_BUCKET_PREFIXES = ['app/', 'sites/', 'media/public/'] as const;
export const PRIVATE_BUCKET_PREFIXES = [
  'media/private/',
  'imports/',
  'backups/',
  'forms/',
] as const;

/** Validates a storage key: relative, traversal-safe, no empty segments. */
export function assertValidKey(key: string): void {
  if (key.includes('\0')) {
    throw new Error('storage key must not contain NUL bytes');
  }
  if (key.startsWith('/') || key.includes('\\')) {
    throw new Error(`storage keys must be relative, got: ${key}`);
  }
  const segments = key.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`storage key contains an empty or traversal segment, got: ${key}`);
  }
}

/** Lenient validation for list prefixes ('app' and 'app/assets' are legal). */
export function assertSafePrefix(prefix: string): void {
  if (prefix.includes('\0')) {
    throw new Error('storage prefix must not contain NUL bytes');
  }
  if (prefix.startsWith('/') || prefix.includes('\\')) {
    throw new Error(`storage prefixes must be relative, got: ${prefix}`);
  }
  const segments = prefix === '' ? [] : prefix.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`storage prefix contains an empty or traversal segment, got: ${prefix}`);
  }
}

/** Requires a key under one of the public bucket prefixes. */
export function assertPublicBucketKey(key: string): void {
  assertValidKey(key);
  if (!PUBLIC_BUCKET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw new Error(
      `public bucket key must start with ${PUBLIC_BUCKET_PREFIXES.join(', ')} — got: ${key}`,
    );
  }
}

/** Requires a key under one of the private bucket prefixes. */
export function assertPrivateBucketKey(key: string): void {
  assertValidKey(key);
  if (!PRIVATE_BUCKET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw new Error(
      `private bucket key must start with ${PRIVATE_BUCKET_PREFIXES.join(', ')} — got: ${key}`,
    );
  }
}

/* ----------------------- key builders (conventions) ------------------ */

/** media/public/{workspaceId}/assets/{assetId}.{ext} */
export function publicAssetKey(workspaceId: string, assetId: string, fileName: string): string {
  const ext = extensionOf(fileName);
  return `media/public/${workspaceId}/assets/${assetId}${ext ? `.${ext}` : ''}`;
}

/** sites/{siteId}/releases/{deploymentId}/{fileName} */
export function releaseKey(siteId: string, deploymentId: string, fileName: string): string {
  return `sites/${siteId}/releases/${deploymentId}/${fileName}`;
}

/** media/private/{workspaceId}/{fileName} */
export function privateMediaKey(workspaceId: string, fileName: string): string {
  return `media/private/${workspaceId}/${fileName}`;
}

/** imports/{workspaceId}/{importJobId}/{fileName} */
export function importKey(workspaceId: string, importJobId: string, fileName: string): string {
  return `imports/${workspaceId}/${importJobId}/${fileName}`;
}

/** backups/{fileName} */
export function backupKey(fileName: string): string {
  return `backups/${fileName}`;
}

/** forms/{siteId}/{formId}/{fileName} */
export function formSubmissionKey(siteId: string, formId: string, fileName: string): string {
  return `forms/${siteId}/${formId}/${fileName}`;
}
