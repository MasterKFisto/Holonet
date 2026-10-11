import type { FetchedPage } from './fetcher.js';

/**
 * Heuristic site analysis (no external AI yet — `AI_PROVIDER=manual`).
 *
 * The real AI provider plugs into the same output shape in a later phase.
 * All inputs are untrusted HTML (rule 17); extracted text is escaped by
 * whatever renders it downstream.
 */

export interface SiteAnalysis {
  provider: 'heuristics';
  model: 'holonet-heuristics';
  pageCount: number;
  titles: string[];
  headings: string[];
  /** Total text characters across all fetched pages. */
  totalTextChars: number;
  /** First 400 characters of readable text, for previews. */
  textSample: string;
  /** Suggested template id from @holonet/templates. */
  suggestedTemplate: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || undefined;
}

function pageHeadings(html: string): string[] {
  const headings: string[] = [];
  const pattern = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[1] ?? '');
    if (text.length > 0 && text.length <= 200) {
      headings.push(text);
    }
  }
  return headings;
}

export function analyzeSite(pages: FetchedPage[]): SiteAnalysis {
  const titles = pages
    .map((page) => pageTitle(page.html))
    .filter((title): title is string => Boolean(title));
  const headings = pages.flatMap((page) => pageHeadings(page.html));
  const text = pages.map((page) => stripTags(page.html)).join(' ');
  const lowered = text.toLowerCase();

  let suggestedTemplate = 'professional-services';
  if (/\blaw\b|\battorney\b|\blegal\b|\blitigation\b/.test(lowered)) {
    suggestedTemplate = 'law-firm';
  } else if (/\baccountant\b|\baccounting\b|\btax\b|\bcpa\b|\bbookkeep|\baudit\b/.test(lowered)) {
    suggestedTemplate = 'accounting-firm';
  }

  return {
    provider: 'heuristics',
    model: 'holonet-heuristics',
    pageCount: pages.length,
    titles,
    headings,
    totalTextChars: text.length,
    textSample: text.slice(0, 400),
    suggestedTemplate,
  };
}
