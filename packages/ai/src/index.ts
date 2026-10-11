import type { WorkspaceId } from '@holonet/core';
import {
  DEFAULT_FETCH_LIMITS,
  fetchSitePages,
  robotsDisallows,
  type FetchDeps,
  type FetchedPage,
  type FetchLimits,
  type FetchSiteResult,
  type ResponseLike,
  type RobotsCheck,
} from './fetcher.js';
import {
  ImportError,
  isPublicIpAddress,
  validateImportUrl,
  type ImportErrorCode,
  type ImportUrlValidation,
} from './url-guard.js';
import {
  AiProviderError,
  HttpAIProvider,
  ManualProvider,
  OllamaProvider,
  PROMPT_TEMPLATE_VERSION,
  analyzeWithFallback,
  buildAnalysisPrompt,
  createAiProvider,
  extractMessageContent,
  importAnalysisOutputSchema,
  sanitizeText,
  type AIProvider,
  type AiProviderConfig,
  type AnalysisOutcome,
  type HttpAIProviderOptions,
  type ImportAnalysisInput,
  type ImportAnalysisOutput,
  type OllamaProviderOptions,
} from './provider.js';

export {
  DEFAULT_FETCH_LIMITS,
  fetchSitePages,
  ImportError,
  isPublicIpAddress,
  robotsDisallows,
  validateImportUrl,
  AiProviderError,
  HttpAIProvider,
  ManualProvider,
  OllamaProvider,
  PROMPT_TEMPLATE_VERSION,
  analyzeWithFallback,
  buildAnalysisPrompt,
  createAiProvider,
  extractMessageContent,
  importAnalysisOutputSchema,
  sanitizeText,
};
export type {
  FetchDeps,
  FetchedPage,
  FetchLimits,
  FetchSiteResult,
  ImportErrorCode,
  ImportUrlValidation,
  ResponseLike,
  RobotsCheck,
  AIProvider,
  AiProviderConfig,
  AnalysisOutcome,
  HttpAIProviderOptions,
  ImportAnalysisInput,
  ImportAnalysisOutput,
  OllamaProviderOptions,
};

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

export interface ImportResult {
  pages: FetchedPage[];
  robots: RobotsCheck;
  analysis: ImportAnalysisOutput;
  providerUsed: string;
  model: string;
  promptTemplateVersion: string;
  fallbackFrom?: string;
}

/**
 * Runs the full import pipeline: SSRF-safe URL validation → bounded fetch
 * (robots.txt respected) → provider analysis (with manual fallback). Errors
 * are typed so the API can map them to `rejected` vs `failed` import jobs.
 */
export async function importWebsite(
  sourceUrl: string,
  deps: FetchDeps,
  limits: FetchLimits = DEFAULT_FETCH_LIMITS,
  provider?: AIProvider,
): Promise<ImportResult> {
  const { pages, robots } = await fetchSitePages(sourceUrl, deps, limits);
  const outcome = await analyzeWithFallback(provider ?? new ManualProvider(), {
    sourceUrl,
    pages,
    robots,
  });
  return {
    pages,
    robots,
    ...outcome,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
  };
}
