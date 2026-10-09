/**
 * Content types for the file kinds Holonet handles, keyed by lowercase
 * extension. Used to set Content-Type on uploads and to validate uploads.
 */
export const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  css: 'text/css',
  js: 'text/javascript',
  html: 'text/html',
  json: 'application/json',
} as const;

/** Cache-Control values used across Holonet. */
export const CACHE_CONTROL = {
  /** Long-lived immutable assets (fingerprinted by asset id). */
  IMMUTABLE: 'public, max-age=31536000, immutable',
  /** Short-lived developer-friendly caching. */
  SHORT: 'public, max-age=3600',
  /** Never cached. */
  NONE: 'no-cache',
} as const;

/** Lowercase file extension without the dot ('' when absent). */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

/** Content type for a file name, or undefined when unknown. */
export function contentTypeFor(fileName: string): string | undefined {
  return CONTENT_TYPES[extensionOf(fileName)];
}
