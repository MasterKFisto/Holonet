import { ImportError, isPublicIpAddress, validateImportUrl } from './url-guard.js';

/**
 * Bounded, credential-free HTML fetcher for the website importer.
 *
 * Safety limits (docs/security.md):
 *  - max 3 pages per import;
 *  - max 5 MiB per page;
 *  - 20 s per request (AbortSignal.timeout);
 *  - user agent `HolonetImporter/0.1`;
 *  - no credentials ever sent (no cookies, no Authorization headers);
 *  - no JavaScript execution — raw HTML is fetched only;
 *  - redirects are followed manually so every hop is re-validated
 *    (no redirect-based SSRF);
 *  - robots.txt is checked where practical and disallowed paths are refused.
 */

export interface FetchLimits {
  maxPages: number;
  maxPageBytes: number;
  timeoutMs: number;
  userAgent: string;
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  maxPages: 3,
  maxPageBytes: 5 * 1024 * 1024,
  timeoutMs: 20_000,
  userAgent: 'HolonetImporter/0.1',
};

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

export interface RobotsCheck {
  checked: boolean;
  disallowed: boolean;
  note?: string;
}

export interface FetchDeps {
  /**
   * Underlying HTTP fetch. Must be initialized without credentials —
   * the importer never attaches cookies or authorization headers.
   */
  fetchUrl(
    url: string,
    init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<ResponseLike>;
  /** Resolves a hostname to its addresses (used for the SSRF re-check). */
  resolveHost(hostname: string): Promise<string[]>;
}

export interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Final URL after redirects, when the transport followed them. */
  url: string;
}

/** Extensions that are never worth crawling. */
const SKIP_EXTENSIONS =
  /\.(css|js|mjs|json|xml|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp[34]|webm|avi|mov|docx?|xlsx?|pptx?)([?#].*)?$/i;

function originOf(url: URL): string {
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
}

/**
 * Minimal robots.txt parser for `User-agent: *` sections.
 * Returns true when the path is disallowed.
 */
export function robotsDisallows(robotsText: string, targetPath: string): boolean {
  let wildcardActive = false;
  const wildcardRules: string[] = [];
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      wildcardActive = value.toLowerCase() === '*';
      continue;
    }
    if (wildcardActive && field === 'disallow' && value !== '') {
      wildcardRules.push(value);
    }
  }
  return wildcardRules.some((rule) => rule === '/' || targetPath.startsWith(rule));
}

function requestInit(limits: FetchLimits): {
  signal: AbortSignal;
  headers: Record<string, string>;
} {
  return {
    signal: AbortSignal.timeout(limits.timeoutMs),
    headers: {
      'user-agent': limits.userAgent,
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  };
}

async function fetchWithRedirects(
  url: string,
  deps: FetchDeps,
  limits: FetchLimits,
  sourceOrigin: string,
): Promise<ResponseLike> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    // Every hop is validated before it is fetched — redirects cannot
    // smuggle requests to internal hosts (rule 4).
    const validation = validateImportUrl(current);
    if (!validation.ok) {
      throw new ImportError('blocked-host', `redirect target rejected: ${validation.reason}`);
    }
    const addresses = await deps.resolveHost(validation.hostname ?? '');
    if (addresses.length === 0) {
      throw new ImportError('unresolvable-host', `cannot resolve host: ${validation.hostname}`);
    }
    if (addresses.some((address) => !isPublicIpAddress(address))) {
      throw new ImportError('blocked-host', `host resolves to a non-public address: ${current}`);
    }

    const response = await deps.fetchUrl(current, requestInit(limits));
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      const next = new URL(location, current).toString();
      const nextOrigin = originOf(new URL(next));
      if (nextOrigin !== sourceOrigin) {
        throw new ImportError('cross-origin-redirect', `redirect to ${nextOrigin} refused`);
      }
      current = next;
      continue;
    }
    return response;
  }
  throw new ImportError('fetch-failed', 'too many redirects');
}

export interface FetchSiteResult {
  pages: FetchedPage[];
  robots: RobotsCheck;
}

/**
 * Fetches up to `limits.maxPages` HTML pages starting at sourceUrl,
 * crawling same-origin links. Robots.txt is respected where practical.
 */
export async function fetchSitePages(
  sourceUrl: string,
  deps: FetchDeps,
  limits: FetchLimits = DEFAULT_FETCH_LIMITS,
): Promise<FetchSiteResult> {
  const validation = validateImportUrl(sourceUrl);
  if (!validation.ok) {
    throw new ImportError('invalid-url', validation.reason ?? 'invalid URL');
  }
  const hostname = validation.hostname ?? '';

  const addresses = await deps.resolveHost(hostname);
  if (addresses.length === 0) {
    throw new ImportError('unresolvable-host', `cannot resolve host: ${hostname}`);
  }
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new ImportError('blocked-host', `host resolves to a non-public address: ${hostname}`);
  }

  const source = new URL(sourceUrl);
  const sourceOrigin = originOf(source);

  // robots.txt — checked where practical.
  let robots: RobotsCheck = { checked: false, disallowed: false };
  try {
    const robotsUrl = `${sourceOrigin}/robots.txt`;
    const robotsResponse = await deps.fetchUrl(robotsUrl, requestInit(limits));
    if (robotsResponse.status === 200) {
      const text = await robotsResponse.text();
      const targetPath = source.pathname === '' ? '/' : source.pathname;
      if (robotsDisallows(text, targetPath)) {
        robots = { checked: true, disallowed: true, note: 'robots.txt disallows the target path' };
        throw new ImportError('robots-disallowed', `robots.txt disallows ${targetPath}`);
      }
      robots = { checked: true, disallowed: false };
    }
  } catch (error) {
    if (error instanceof ImportError) {
      throw error;
    }
    // robots.txt lookup failed — continue without it ("where practical").
    robots = { checked: false, disallowed: false, note: 'robots.txt unavailable' };
  }

  const pages: FetchedPage[] = [];
  const visited = new Set<string>();
  const queue: string[] = [sourceUrl];

  while (queue.length > 0 && pages.length < limits.maxPages) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const response = await fetchWithRedirects(current, deps, limits, sourceOrigin);
    const status = response.status;

    if (status === 401 || status === 403) {
      // Never attempt to access authenticated pages.
      throw new ImportError(
        'auth-required',
        `page requires authentication (${status}): ${current}`,
      );
    }
    if (status === 402) {
      // Paywalls are not bypassed — no credentials are ever used.
      throw new ImportError('paywall', `page is paywalled (402): ${current}`);
    }
    if (status === 429) {
      throw new ImportError('rate-limited', `source rate-limited the importer (429): ${current}`);
    }
    if (status < 200 || status >= 300) {
      continue; // 404 and other failures: skip this page.
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      continue; // not an HTML page.
    }

    const declaredSize = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredSize) && declaredSize > limits.maxPageBytes) {
      continue; // page exceeds the size cap — skipped without reading.
    }

    let html: string;
    try {
      html = await response.text();
    } catch {
      throw new ImportError('fetch-failed', `failed reading response body: ${current}`);
    }

    // Crawl same-origin links breadth-first (no JavaScript, no assets) —
    // even from pages that are skipped due to size, so the cap on stored
    // content never limits discovery.
    const discovered: string[] = [];
    const linkPattern = /href\s*=\s*["']([^"'#]+)["']/gi;
    for (const match of html.matchAll(linkPattern)) {
      let next: URL;
      try {
        next = new URL(match[1] ?? '', current);
      } catch {
        continue;
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        continue;
      }
      if (originOf(next) !== sourceOrigin) {
        continue;
      }
      const nextString = next.toString();
      if (!SKIP_EXTENSIONS.test(next.pathname) && !visited.has(nextString)) {
        discovered.push(nextString);
      }
    }

    if (Buffer.byteLength(html, 'utf8') > limits.maxPageBytes) {
      for (const link of discovered) {
        if (queue.length + pages.length >= limits.maxPages) {
          break;
        }
        queue.push(link);
      }
      continue; // page exceeds the size cap after download — skipped.
    }

    pages.push({ url: current, status, contentType, html });
    for (const link of discovered) {
      if (queue.length + pages.length >= limits.maxPages) {
        break;
      }
      queue.push(link);
    }
  }

  return { pages, robots };
}
