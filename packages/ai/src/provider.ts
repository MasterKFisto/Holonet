import { z } from 'zod';
import type { FetchedPage, RobotsCheck } from './fetcher.js';

/**
 * AI analysis provider system (docs/architecture.md).
 *
 * Providers turn fetched website content into a validated, structured draft
 * (ImportAnalysisOutput). The output is ALWAYS validated with Zod before any
 * draft is created, and when a configured provider fails the pipeline falls
 * back to the offline ManualProvider. Nothing here publishes anything.
 */

/** Version of the structured prompt sent to HTTP providers. */
export const PROMPT_TEMPLATE_VERSION = 'holonet-import-v1';

/** Maximum total prompt text derived from fetched pages (safety cap). */
const MAX_PROMPT_TEXT_CHARS = 12_000;

/* ------------------------- output schema (Zod) ------------------------ */

const designTokensSchema = z.object({
  primaryColor: z.string().max(50).optional(),
  secondaryColor: z.string().max(50).optional(),
  backgroundColor: z.string().max(50).optional(),
  textColor: z.string().max(50).optional(),
  headingFont: z.string().max(200).optional(),
  bodyFont: z.string().max(200).optional(),
});

const navigationItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2000),
});

export const blockSuggestionSchema = z.object({
  type: z.string().trim().min(1).max(64),
  heading: z.string().trim().max(300).optional(),
  content: z.string().max(20_000).optional(),
  items: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  imageUrl: z.string().max(2000).optional(),
  imageAlt: z.string().max(300).optional(),
  buttonLabel: z.string().max(100).optional(),
  buttonLink: z.string().max(500).optional(),
});

const pageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  path: z.string().trim().max(500).optional(),
  sections: z.array(blockSuggestionSchema).min(1).max(20),
});

const contactSchema = z.object({
  email: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(100).optional(),
  address: z.string().max(500).optional(),
});

const socialLinkSchema = z.object({
  platform: z.string().trim().max(50).optional(),
  url: z.string().trim().min(1).max(2000),
});

/**
 * The validated import analysis output. This is the contract every provider
 * must satisfy; the draft creator consumes only schema-valid data.
 */
export const importAnalysisOutputSchema = z.object({
  businessName: z.string().trim().min(1).max(200).optional(),
  siteType: z.string().trim().min(1).max(100).optional(),
  suggestedTemplate: z.string().trim().min(1).max(100).optional(),
  designTokens: designTokensSchema,
  navigation: z.array(navigationItemSchema).max(50).default([]),
  pages: z.array(pageSchema).min(1).max(12),
  contact: contactSchema,
  socialLinks: z.array(socialLinkSchema).max(20).default([]),
  warnings: z.array(z.string().max(500)).max(20).default([]),
});

export type ImportAnalysisOutput = z.infer<typeof importAnalysisOutputSchema>;

/* ------------------------------ input type ---------------------------- */

export interface ImportAnalysisInput {
  sourceUrl: string;
  pages: FetchedPage[];
  robots: RobotsCheck;
}

/* ------------------------------ provider ------------------------------ */

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeWebsiteImport(input: ImportAnalysisInput): Promise<ImportAnalysisOutput>;
}

/** Typed provider failure — triggers the manual fallback upstream. */
export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/* ------------------------------ text tools ---------------------------- */

/** Removes control characters and collapses whitespace (sanitization). */
export function sanitizeText(text: string): string {
  const controlChars = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  return text.replace(controlChars, '').replace(/\s+/g, ' ').trim();
}

/** Sanitizes and truncates extracted text to a hard limit. */
export function cleanText(text: string, maxLength: number): string {
  return sanitizeText(text).slice(0, maxLength);
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

function pageTitleOf(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? cleanText(match[1], 300) : undefined;
}

function headingsOf(html: string, level: number): string[] {
  const headings: string[] = [];
  const pattern = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'gi');
  for (const match of html.matchAll(pattern)) {
    const text = cleanText(stripTags(match[1] ?? ''), 300);
    if (text.length > 0) {
      headings.push(text);
    }
  }
  return headings;
}

function paragraphsOf(html: string, limit = 6): string[] {
  const paragraphs: string[] = [];
  const pattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of html.matchAll(pattern)) {
    const text = cleanText(stripTags(match[1] ?? ''), 3000);
    if (text.length >= 20) {
      paragraphs.push(text);
      if (paragraphs.length >= limit) {
        break;
      }
    }
  }
  return paragraphs;
}

interface ExtractedLink {
  label: string;
  url: string;
}

function linksOf(html: string, baseUrl: string, limit = 50): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const pattern = /<a[^>]+href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    let url: string;
    try {
      url = new URL(match[1] ?? '', baseUrl).toString();
    } catch {
      continue;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      continue;
    }
    const label = cleanText(stripTags(match[2] ?? ''), 200);
    if (label === '') {
      continue;
    }
    links.push({ label, url: url.slice(0, 2000) });
    if (links.length >= limit) {
      break;
    }
  }
  return links;
}

function imageUrlsOf(html: string, baseUrl: string, limit = 10): string[] {
  const urls: string[] = [];
  const pattern = /<img[^>]+src\s*=\s*["']([^"'#]+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      urls.push(new URL(match[1] ?? '', baseUrl).toString().slice(0, 2000));
    } catch {
      continue;
    }
    if (urls.length >= limit) {
      break;
    }
  }
  return urls;
}

function emailsOf(html: string): string[] {
  const text = stripTags(html);
  const emails: string[] = [];
  const pattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const match of text.matchAll(pattern)) {
    if (!emails.includes(match[0].toLowerCase())) {
      emails.push(match[0].toLowerCase());
    }
  }
  return emails.slice(0, 5);
}

function phonesOf(html: string): string[] {
  const text = stripTags(html);
  const phones: string[] = [];
  // Common international/local phone shapes: +1 (555) 123-4567, 010-12345678…
  const pattern =
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{2,4}[\s.-]?\d{2,5}(?:[\s.-]?\d{2,5})?/g;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[0].trim();
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      phones.push(candidate.slice(0, 100));
    }
  }
  return phones.slice(0, 3);
}

const SOCIAL_DOMAINS: Record<string, string> = {
  'facebook.com': 'facebook',
  'x.com': 'x',
  'twitter.com': 'twitter',
  'linkedin.com': 'linkedin',
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'github.com': 'github',
  'weibo.com': 'weibo',
  'weixin.qq.com': 'wechat',
  'tiktok.com': 'tiktok',
};

/* --------------------------- ManualProvider --------------------------- */

/**
 * Offline provider: builds a conservative structured draft purely from the
 * fetched HTML. No external calls, no code execution (raw HTML is parsed as
 * text only), all extracted content is sanitized and length-limited.
 */
export class ManualProvider implements AIProvider {
  readonly name = 'manual';
  readonly model = 'holonet-manual';

  async analyzeWebsiteImport(input: ImportAnalysisInput): Promise<ImportAnalysisOutput> {
    const warnings: string[] = [];
    const firstPage = input.pages[0];
    if (!firstPage) {
      throw new AiProviderError('manual provider requires at least one fetched page');
    }
    const allText = input.pages.map((page) => stripTags(page.html)).join(' ');

    // Business name: first page <title>, falling back to the first h1.
    const businessName = cleanText(
      pageTitleOf(firstPage.html) ?? headingsOf(firstPage.html, 1)[0] ?? '',
      200,
    );

    // Site type + template heuristics (same vocabulary as before).
    const lowered = allText.toLowerCase();
    let siteType = 'professional-services';
    let suggestedTemplate = 'professional-services';
    if (/\blaw\b|\battorney\b|\blegal\b|\blitigation\b/.test(lowered)) {
      siteType = 'law-firm';
      suggestedTemplate = 'law-firm';
    } else if (/\baccountant\b|\baccounting\b|\btax\b|\bcpa\b|\bbookkeep|\baudit\b/.test(lowered)) {
      siteType = 'accounting-firm';
      suggestedTemplate = 'accounting-firm';
    }

    // Navigation from the first page's links.
    const seenUrls = new Set<string>();
    const navigation = linksOf(firstPage.html, input.sourceUrl, 30)
      .filter((link) => {
        if (seenUrls.has(link.url)) {
          return false;
        }
        seenUrls.add(link.url);
        return true;
      })
      .slice(0, 12);

    // Pages: one draft per fetched page.
    const pages = input.pages.map((page, pageIndex) => {
      const url = new URL(page.url);
      const title =
        pageTitleOf(page.html) ?? (pageIndex === 0 ? businessName || url.hostname : url.hostname);
      const h1s = headingsOf(page.html, 1);
      const h2s = headingsOf(page.html, 2).slice(0, 6);
      const paragraphs = paragraphsOf(page.html);
      const images = imageUrlsOf(page.html, page.url, 3);

      const sections: z.infer<typeof blockSuggestionSchema>[] = [];
      if (pageIndex === 0) {
        sections.push({
          type: 'hero',
          heading: cleanText(h1s[0] ?? title, 300),
          content: cleanText(paragraphs[0] ?? '', 1000),
          imageUrl: images[0],
          imageAlt: images[0] ? cleanText(title, 300) : undefined,
          buttonLabel: 'Contact us',
          buttonLink: navigation.find((link) => /contact/i.test(link.label))?.url,
        });
      }
      for (let i = 0; i < h2s.length; i += 1) {
        sections.push({
          type: 'text_section',
          heading: h2s[i],
          content: cleanText(paragraphs[i] ?? '', 3000),
        });
      }
      if (sections.length === 0) {
        sections.push({
          type: 'text_section',
          heading: cleanText(title, 300),
          content: cleanText(paragraphs.join(' '), 3000),
        });
      }
      return {
        title: cleanText(title, 300),
        path: url.pathname === '/' && pageIndex === 0 ? '/' : url.pathname,
        sections: sections.slice(0, 10),
      };
    });

    // Contact details + social links from all pages.
    const emails = input.pages.flatMap((page) => emailsOf(page.html));
    const phones = input.pages.flatMap((page) => phonesOf(page.html));
    const socialLinks = input.pages
      .flatMap((page) => linksOf(page.html, page.url, 40))
      .map((link) => {
        const host = new URL(link.url).hostname.replace(/^www\./, '');
        const platform = SOCIAL_DOMAINS[host];
        return platform ? { platform, url: link.url } : null;
      })
      .filter((link): link is { platform: string; url: string } => link !== null)
      .slice(0, 10);

    if (emails.length === 0 && phones.length === 0) {
      warnings.push('no contact details were found on the fetched pages');
    }
    warnings.push('draft generated offline by the manual provider (heuristics)');

    return {
      businessName: businessName === '' ? undefined : businessName,
      siteType,
      suggestedTemplate,
      designTokens: {},
      navigation,
      pages,
      contact: {
        email: emails[0],
        phone: phones[0],
      },
      socialLinks,
      warnings,
    };
  }
}

/* ---------------------------- HttpAIProvider -------------------------- */

export interface HttpAIProviderOptions {
  /** OpenAI- or Qwen-compatible chat completions endpoint. */
  endpoint: string;
  apiKey?: string;
  model: string;
  /** Optional fetch implementation (tests inject a fake). */
  fetchImpl?: typeof fetch;
  promptTemplateVersion?: string;
}

/**
 * Calls an OpenAI-compatible / Qwen-compatible chat-completions endpoint.
 * The response must be JSON matching ImportAnalysisOutput — anything else is
 * rejected (Zod), which triggers the manual fallback upstream.
 */
export class HttpAIProvider implements AIProvider {
  readonly name = 'http';
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly promptTemplateVersion: string;

  constructor(options: HttpAIProviderOptions) {
    if (!options.endpoint || !options.model) {
      throw new AiProviderError('HTTP AI provider requires an endpoint and a model');
    }
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.promptTemplateVersion = options.promptTemplateVersion ?? PROMPT_TEMPLATE_VERSION;
  }

  async analyzeWebsiteImport(input: ImportAnalysisInput): Promise<ImportAnalysisOutput> {
    const prompt = buildAnalysisPrompt(input, this.promptTemplateVersion);

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });
    } catch (error) {
      throw new AiProviderError(`AI endpoint request failed: ${String(error)}`);
    }
    if (!response.ok) {
      throw new AiProviderError(`AI endpoint responded ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiProviderError('AI endpoint did not return JSON');
    }

    const content = extractMessageContent(payload);
    if (!content) {
      throw new AiProviderError('AI response had no message content');
    }
    // The model may wrap JSON in code fences — unwrap before parsing.
    const unwrapped = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(unwrapped);
    } catch {
      throw new AiProviderError('AI response was not valid JSON');
    }
    // Invalid AI output is rejected here — never used for a draft.
    return importAnalysisOutputSchema.parse(parsed);
  }
}

/** Extracts `choices[0].message.content` from OpenAI/Qwen-shaped payloads. */
export function extractMessageContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record['choices']) ? (record['choices'] as unknown[]) : [];
  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    return undefined;
  }
  const message = (first as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : undefined;
}

const SYSTEM_PROMPT = [
  'You extract structured website data for a website import tool.',
  'Return a single JSON object with these keys:',
  'businessName (string, optional), siteType (string, optional),',
  'suggestedTemplate (one of "law-firm", "accounting-firm", "professional-services", optional),',
  'designTokens (object with optional primaryColor, secondaryColor, backgroundColor, textColor,',
  'headingFont, bodyFont),',
  'navigation (array of {label, url}),',
  'pages (array of {title, path, sections: array of {type, heading, content, items, imageUrl,',
  'imageAlt, buttonLabel, buttonLink}}),',
  'contact (object with optional email, phone, address),',
  'socialLinks (array of {platform, url}),',
  'warnings (array of strings).',
  'Do not invent content that is not present in the source pages.',
].join(' ');

/** Builds the structured, versioned prompt. Content is sanitized + capped. */
export function buildAnalysisPrompt(
  input: ImportAnalysisInput,
  version: string = PROMPT_TEMPLATE_VERSION,
): string {
  const excerpts = input.pages.map((page) => {
    const text = sanitizeText(
      page.html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    );
    return `URL: ${page.url}\n${text}`;
  });
  let combined = excerpts.join('\n\n');
  if (combined.length > MAX_PROMPT_TEXT_CHARS) {
    combined = `${combined.slice(0, MAX_PROMPT_TEXT_CHARS)}\n…(truncated)`;
  }
  return `prompt-template: ${version}\nsource-url: ${input.sourceUrl}\n\n${combined}`;
}

/* ----------------------- OllamaProvider placeholder ------------------- */

export interface OllamaProviderOptions {
  /** http://host.docker.internal:11434 or similar (future use). */
  endpoint?: string;
  model?: string;
}

/**
 * Placeholder for a local Docker-hosted Ollama model. Not implemented yet —
 * calling it fails fast and the pipeline falls back to ManualProvider, so
 * Ollama never needs to be installed to run the platform or its tests.
 */
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  readonly model: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.model = options.model ?? 'llama3.2';
    if (options.endpoint) {
      // Stored for the future implementation (PLACEHOLDER).
    }
  }

  async analyzeWebsiteImport(_input: ImportAnalysisInput): Promise<ImportAnalysisOutput> {
    throw new AiProviderError('Ollama provider is a placeholder — not yet implemented');
  }
}

/* --------------------------- provider factory ------------------------- */

export interface AiProviderConfig {
  AI_PROVIDER?: string;
  AI_ENDPOINT?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  OLLAMA_ENDPOINT?: string;
}

/** Builds the provider selected by configuration ('manual' by default). */
export function createAiProvider(config: AiProviderConfig): AIProvider {
  switch (config.AI_PROVIDER ?? 'manual') {
    case 'http':
      return new HttpAIProvider({
        endpoint: config.AI_ENDPOINT ?? '',
        apiKey: config.AI_API_KEY,
        model: config.AI_MODEL ?? '',
      });
    case 'ollama':
      return new OllamaProvider({
        endpoint: config.OLLAMA_ENDPOINT,
        model: config.AI_MODEL,
      });
    case 'manual':
    default:
      return new ManualProvider();
  }
}

/* ------------------------------ fallback ------------------------------ */

export interface AnalysisOutcome {
  analysis: ImportAnalysisOutput;
  providerUsed: string;
  model: string;
  fallbackFrom?: string;
}

/**
 * Runs the configured provider; when it fails (network, auth, invalid JSON
 * output, …) the analysis falls back to the offline ManualProvider so the
 * import never loses its fetched content. Only failures of the manual
 * provider itself propagate.
 */
export async function analyzeWithFallback(
  provider: AIProvider,
  input: ImportAnalysisInput,
): Promise<AnalysisOutcome> {
  try {
    const analysis = await provider.analyzeWebsiteImport(input);
    return { analysis, providerUsed: provider.name, model: provider.model };
  } catch (error) {
    if (provider.name === 'manual') {
      throw error;
    }
    const manual = new ManualProvider();
    const analysis = await manual.analyzeWebsiteImport(input);
    return {
      analysis,
      providerUsed: manual.name,
      model: manual.model,
      fallbackFrom: provider.name,
    };
  }
}
