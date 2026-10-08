import type { WorkspaceId, SiteId } from '@holonet/core';
import type { TemplateManifest } from '@holonet/templates';

export interface SiteData {
  workspaceId: WorkspaceId;
  siteId: SiteId;
  template: TemplateManifest;
}

export interface GeneratedFile {
  path: string;
  body: Buffer;
  contentType: string;
}

/**
 * Generates static website files from Holonet site data.
 *
 * PLACEHOLDER: implementation arrives in a later phase (see
 * docs/architecture.md). Imported content and AI output are always treated
 * as untrusted input and sanitized at this boundary (rule 17).
 */
export async function generateSite(_site: SiteData): Promise<GeneratedFile[]> {
  return [];
}
