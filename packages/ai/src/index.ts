import type { WorkspaceId } from '@holonet/core';

/**
 * AI import provider interfaces.
 *
 * Providers may call external AI services; endpoints and keys are configured
 * through environment variables only (AI_PROVIDER / AI_ENDPOINT / AI_API_KEY /
 * AI_MODEL in .env.example). `manual` is the default provider.
 */

export interface AiImportRequest {
  workspaceId: WorkspaceId;
  sourceUrl: string;
}

export interface AiImportResult {
  provider: string;
  content: string;
}

export interface AiImportProvider {
  readonly name: string;
  importSite(request: AiImportRequest): Promise<AiImportResult>;
}

/** Registered providers. Providers register themselves in later phases. */
export const aiImportProviders: AiImportProvider[] = [];
