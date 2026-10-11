import { describe, expect, it } from 'vitest';
import { professionalServicesTemplate } from '@holonet/templates';
import { generateStaticSite, type HolonetSiteSnapshot, type SnapshotPage } from './index.js';

const BASE_URL = 'https://holonet.section-zero.link';

const samplePages: SnapshotPage[] = [
  {
    path: '/',
    title: 'Home',
    description: 'Home page description.',
    blocks: [
      {
        type: 'hero',
        props: {
          headline: 'Trusted expertise',
          alignment: 'center',
          primaryButtonLabel: 'Start',
          primaryButtonLink: '/contact/',
        },
      },
      {
        type: 'contact_form',
        props: { title: 'Send us a message', submitLabel: 'Send message', formId: 'form-123' },
      },
    ],
  },
  {
    path: '/about',
    title: 'About',
    blocks: [
      {
        type: 'text_section',
        props: { heading: 'Who we are', content: 'First paragraph.\n\nSecond paragraph.' },
      },
    ],
  },
];

function snapshot(overrides: Partial<HolonetSiteSnapshot> = {}): HolonetSiteSnapshot {
  return {
    workspaceId: 'ws-1',
    siteId: 'site-1',
    siteName: 'Example Firm',
    baseUrl: BASE_URL,
    template: professionalServicesTemplate,
    pages: samplePages,
    ...overrides,
  };
}

describe('@holonet/static-generator', () => {
  it('generates index.html, page files, sitemap, robots, css, and headers.json', async () => {
    const output = await generateStaticSite(snapshot());
    expect(output.files['index.html']).toBeTruthy();
    expect(output.files['about/index.html']).toBeTruthy();
    expect(output.files['sitemap.xml']).toBeTruthy();
    expect(output.files['robots.txt']).toBeTruthy();
    expect(output.files['assets/styles.css']).toBeTruthy();
    expect(output.files['headers.json']).toBeTruthy();
  });

  it('falls back to the template default pages when no pages are given', async () => {
    const output = await generateStaticSite(snapshot({ pages: [] }));
    for (const page of professionalServicesTemplate.pages) {
      expect(
        output.files[page.path === '/' ? 'index.html' : `${page.path.slice(1)}/index.html`],
      ).toBeTruthy();
    }
  });

  it('includes meta title, description, canonical, and Open Graph tags', async () => {
    const output = await generateStaticSite(snapshot());
    const html = output.files['index.html']!;
    expect(html).toContain('<meta name="description" content="Home page description." />');
    expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/" />`);
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/" />`);
    // SEO title template from the manifest.
    expect(html).toContain('<title>Home | Professional Services Firm</title>');
  });

  it('includes navigation and footer', async () => {
    const output = await generateStaticSite(snapshot());
    const html = output.files['index.html']!;
    expect(html).toContain('<nav aria-label="Main navigation">');
    expect(html).toContain('>About</a>');
    expect(html).toContain('class="site-footer"');
    expect(html).toContain('Privacy Policy');
  });

  it('renders blocks: hero, text section, and contact form markup', async () => {
    const output = await generateStaticSite(snapshot());
    const home = output.files['index.html']!;
    expect(home).toContain('<h1>Trusted expertise</h1>');
    expect(home).toContain('<a class="btn" href="/contact/">Start</a>');
    expect(home).toContain(
      '<form method="post" action="/api/forms/submit" data-form-id="form-123">',
    );
    expect(home).toContain('>Send message</button>');

    const about = output.files['about/index.html']!;
    expect(about).toContain('<h2>Who we are</h2>');
    expect(about).toContain('<p>First paragraph.</p>');
    expect(about).toContain('<p>Second paragraph.</p>');
  });

  it('escapes untrusted content (rule 17)', async () => {
    const output = await generateStaticSite(
      snapshot({
        pages: [
          {
            path: '/',
            title: '<script>alert(1)</script>',
            blocks: [{ type: 'text_section', props: { content: '<img src=x onerror=alert(1)>' } }],
          },
        ],
      }),
    );
    const html = output.files['index.html']!;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('generates a sitemap.xml with every page URL', async () => {
    const output = await generateStaticSite(snapshot());
    const sitemap = output.files['sitemap.xml']!;
    expect(sitemap).toContain(`<loc>${BASE_URL}/</loc>`);
    expect(sitemap).toContain(`<loc>${BASE_URL}/about/</loc>`);
    expect(sitemap.startsWith('<?xml version="1.0"')).toBe(true);
  });

  it('generates robots.txt pointing at the sitemap', async () => {
    const output = await generateStaticSite(snapshot());
    const robots = output.files['robots.txt']!;
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain(`Sitemap: ${BASE_URL}/sitemap.xml`);
  });

  it('generates the security headers recommendation file', async () => {
    const output = await generateStaticSite(snapshot());
    const headers = JSON.parse(output.files['headers.json']!) as {
      headers: Record<string, string>;
    };
    expect(headers.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('applies theme colors to the stylesheet', async () => {
    const output = await generateStaticSite(snapshot());
    expect(output.files['assets/styles.css']).toContain('--color-primary: #4f46e5');
    expect(output.files['assets/styles.css']).toContain('@media (max-width: 40rem)');
  });
});
