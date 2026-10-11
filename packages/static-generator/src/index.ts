import { parseTemplateManifest, type TemplateManifest } from '@holonet/templates';
import {
  escapeHtml,
  pageFileKey,
  pageUrl,
  renderPage,
  type SiteShell,
  type SnapshotPage,
} from './html.js';
import { buildStylesheet } from './styles.js';

/**
 * Holonet static generator.
 *
 * Takes a site snapshot (site metadata + template + pages with blocks) and
 * produces a complete static site as key → text content pairs, suitable for
 * upload to OSS under sites/{siteId}/releases/{deploymentId}/…
 *
 * All block props, page titles, and template content are untrusted data and
 * are HTML-escaped during rendering (rule 17).
 */

export interface HolonetSiteSnapshot {
  workspaceId: string;
  siteId: string;
  siteName: string;
  /** Canonical base URL, e.g. https://holonet.section-zero.link. */
  baseUrl: string;
  template: TemplateManifest;
  /** Pages with their blocks; falls back to the template's default pages. */
  pages: SnapshotPage[];
}

export interface GeneratedFileEntry {
  key: string;
  contentType: string;
}

export interface GeneratedSiteOutput {
  /** Relative file paths → text content (key/content pairs for OSS upload). */
  files: Record<string, string>;
  /** Generated file manifest (key + content type). */
  manifest: GeneratedFileEntry[];
}

function renderSitemap(baseUrl: string, pages: SnapshotPage[]): string {
  const urls = pages
    .map((page) => `  <url><loc>${escapeHtml(pageUrl(baseUrl, page.path))}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderRobotsTxt(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl.replace(/\/+$/, '')}/sitemap.xml
`;
}

function renderHeadersJson(): string {
  return `${JSON.stringify(
    {
      description:
        'Recommended security headers for published Holonet sites (apply at the CDN/OSS layer).',
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'",
      },
      cacheControl: {
        '/*.html': 'no-cache',
        '/assets/*': 'public, max-age=31536000, immutable',
        '/sitemap.xml': 'public, max-age=3600',
        '/robots.txt': 'public, max-age=3600',
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Generates the static site:
 * - index.html + one directory-style index.html per page
 * - sitemap.xml, robots.txt
 * - assets/styles.css (responsive, theme-driven)
 * - headers.json (recommended security headers)
 */
export async function generateStaticSite(input: HolonetSiteSnapshot): Promise<GeneratedSiteOutput> {
  // Validate the template manifest (rule 17: untrusted input).
  const template = parseTemplateManifest(input.template);

  const effectivePages: SnapshotPage[] =
    input.pages.length > 0
      ? input.pages
      : template.pages.map((page) => ({
          path: page.path,
          title: page.title,
          description: page.description,
          blocks: page.blocks.map((block) => ({ type: block.type, props: block.props })),
        }));

  // index.html is always produced: alias the first page when '/' is missing.
  if (!effectivePages.some((page) => page.path === '/')) {
    const first = effectivePages[0];
    if (first) {
      effectivePages.unshift({ ...first, path: '/', title: first.title });
    }
  }

  const files: Record<string, string> = {};
  const manifest: GeneratedFileEntry[] = [];
  const addFile = (key: string, content: string, contentType: string): void => {
    files[key] = content;
    manifest.push({ key, contentType });
  };

  const shell: SiteShell = {
    siteName: input.siteName,
    baseUrl: input.baseUrl,
    template,
    pages: effectivePages,
  };

  for (const page of effectivePages) {
    addFile(pageFileKey(page.path), renderPage(shell, page), 'text/html');
  }

  addFile('assets/styles.css', buildStylesheet(template.theme), 'text/css');
  addFile('sitemap.xml', renderSitemap(input.baseUrl, effectivePages), 'application/xml');
  addFile('robots.txt', renderRobotsTxt(input.baseUrl), 'text/plain');
  addFile('headers.json', renderHeadersJson(), 'application/json');

  return { files, manifest };
}

export { escapeHtml, pageFileKey, pageUrl, renderPage };
export type { SiteShell, SnapshotPage, SnapshotPageBlock } from './html.js';
