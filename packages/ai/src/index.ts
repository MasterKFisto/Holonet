import type { WorkspaceId } from '@holonet/core';
import { analyzeSite, type SiteAnalysis } from './analyze.js';
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

export {
  DEFAULT_FETCH_LIMITS,
  fetchSitePages,
  analyzeSite,
  ImportError,
  isPublicIpAddress,
  robotsDisallows,
  validateImportUrl,
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
  SiteAnalysis,
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
  analysis: SiteAnalysis;
}

/**
 * Runs the full import pipeline: SSRF-safe URL validation → bounded fetch
 * (robots.txt respected) → heuristic analysis. Errors are typed so the API
 * can map them to `rejected` vs `failed` import jobs.
 */
export async function importWebsite(
  sourceUrl: string,
  deps: FetchDeps,
  limits: FetchLimits = DEFAULT_FETCH_LIMITS,
): Promise<ImportResult> {
  const { pages, robots } = await fetchSitePages(sourceUrl, deps, limits);
  return { pages, robots, analysis: analyzeSite(pages) };
}
