import { describe, expect, it } from 'vitest';
import {
  AiProviderError,
  HttpAIProvider,
  ManualProvider,
  OllamaProvider,
  analyzeWithFallback,
  createAiProvider,
  importAnalysisOutputSchema,
  type FetchedPage,
  type ImportAnalysisInput,
} from './index.js';

const page = (url: string, html: string): FetchedPage => ({
  url,
  status: 200,
  contentType: 'text/html; charset=utf-8',
  html,
});

const sampleHtml = `
<html>
<head><title>Acme Law LLP | Attorneys</title></head>
<body>
<nav><a href="/about">About</a><a href="/team">Our Team</a><a href="/contact">Contact Us</a></nav>
<h1>Acme Law LLP</h1>
<p>Trusted legal counsel for businesses and families.</p>
<h2>Practice Areas</h2>
<p>We handle litigation, contracts, and corporate law.</p>
<img src="/images/office.jpg" alt="Our office" />
<a href="https://linkedin.com/company/acme-law">LinkedIn</a>
<p>Email <a href="mailto:contact@acme-law.example">contact@acme-law.example</a> or call +1 (555) 123-4567.</p>
<p>${'x'.repeat(4000)}</p>
</body>
</html>`;

const sampleInput: ImportAnalysisInput = {
  sourceUrl: 'https://acme-law.example/',
  pages: [page('https://acme-law.example/', sampleHtml)],
  robots: { checked: false, disallowed: false },
};

describe('@holonet/ai providers', () => {
  it('ManualProvider returns output that satisfies the Zod schema', async () => {
    const output = await new ManualProvider().analyzeWebsiteImport(sampleInput);
    const result = importAnalysisOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
    expect(output.businessName).toBe('Acme Law LLP | Attorneys');
    expect(output.suggestedTemplate).toBe('law-firm');
    expect(output.contact.email).toBe('contact@acme-law.example');
    expect(output.contact.phone).toContain('555');
    expect(output.navigation.map((item) => item.label)).toContain('About');
    expect(output.socialLinks.some((link) => link.platform === 'linkedin')).toBe(true);
    const firstPage = output.pages[0]!;
    expect(firstPage.sections[0]?.type).toBe('hero');
    expect(firstPage.sections.some((section) => section.heading === 'Practice Areas')).toBe(true);
    expect(firstPage.sections[0]?.imageUrl).toBe('https://acme-law.example/images/office.jpg');
  });

  it('HttpAIProvider sends a structured JSON prompt and parses valid output', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new HttpAIProvider({
      endpoint: 'https://ai.example/v1/chat/completions',
      apiKey: 'secret-key',
      model: 'qwen-plus',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const output = {
          businessName: 'Acme',
          designTokens: { primaryColor: '#111111' },
          navigation: [{ label: 'About', url: '/about' }],
          pages: [{ title: 'Home', path: '/', sections: [{ type: 'hero', heading: 'Acme' }] }],
          contact: { email: 'hi@acme.example' },
          socialLinks: [],
          warnings: [],
        };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const result = await provider.analyzeWebsiteImport(sampleInput);
    expect(result.businessName).toBe('Acme');

    const [call] = calls;
    expect(call?.url).toBe('https://ai.example/v1/chat/completions');
    const body = JSON.parse(String(call?.init?.body)) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('qwen-plus');
    expect(body.response_format.type).toBe('json_object');
    expect(body.messages[0]?.content).toContain('structured');
    expect(body.messages[1]?.content).toContain('prompt-template: holonet-import-v1');
    expect(body.messages[1]?.content).toContain('Acme Law LLP');
    expect((call?.init?.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
  });

  it('rejects invalid AI output instead of using it', async () => {
    const provider = new HttpAIProvider({
      endpoint: 'https://ai.example/v1/chat/completions',
      model: 'qwen-plus',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"foo": 1}' } }] }), {
          status: 200,
        })) as typeof fetch,
    });
    await expect(provider.analyzeWebsiteImport(sampleInput)).rejects.toThrow();
  });

  it('falls back to ManualProvider when the configured provider fails', async () => {
    const failing = new HttpAIProvider({
      endpoint: 'https://ai.example/v1/chat/completions',
      model: 'qwen-plus',
      fetchImpl: (async () => new Response('down', { status: 503 })) as typeof fetch,
    });
    const outcome = await analyzeWithFallback(failing, sampleInput);
    expect(outcome.providerUsed).toBe('manual');
    expect(outcome.fallbackFrom).toBe('http');
    expect(outcome.model).toBe('holonet-manual');
    expect(importAnalysisOutputSchema.safeParse(outcome.analysis).success).toBe(true);
  });

  it('OllamaProvider is a placeholder that fails fast (no Ollama required)', async () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe('ollama');
    await expect(provider.analyzeWebsiteImport(sampleInput)).rejects.toBeInstanceOf(
      AiProviderError,
    );
    // …and the failure falls back to manual.
    const outcome = await analyzeWithFallback(provider, sampleInput);
    expect(outcome.providerUsed).toBe('manual');
    expect(outcome.fallbackFrom).toBe('ollama');
  });

  it('createAiProvider maps configuration to providers', () => {
    expect(createAiProvider({}).name).toBe('manual');
    expect(createAiProvider({ AI_PROVIDER: 'manual' }).name).toBe('manual');
    expect(
      createAiProvider({ AI_PROVIDER: 'http', AI_ENDPOINT: 'https://ai', AI_MODEL: 'qwen' }).name,
    ).toBe('http');
    expect(createAiProvider({ AI_PROVIDER: 'ollama' }).name).toBe('ollama');
  });
});
