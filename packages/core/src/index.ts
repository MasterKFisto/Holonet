/**
 * Shared constants, domain types, and utilities used across Holonet services.
 * Business logic arrives in later phases.
 */

export const SERVICE_NAME = 'holonet';

/** Fixed public hostname (docs/PROJECT_RULES.md rule 2). */
export const DEFAULT_PUBLIC_BASE_URL = 'https://holonet.section-zero.link';

export function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;
}

/** Identifier types keep tenant boundaries explicit in signatures. */
export type WorkspaceId = string;
export type SiteId = string;
