import type { TemplateManifest } from '@holonet/templates';

/**
 * Static site HTML rendering.
 *
 * Every value from block props, page titles, and template content is treated
 * as untrusted data and HTML-escaped (docs/PROJECT_RULES.md rule 17).
 */

export interface SnapshotPageBlock {
  type: string;
  props: Record<string, unknown>;
}

export interface SnapshotPage {
  path: string;
  title: string;
  description?: string;
  blocks: SnapshotPageBlock[];
}

export interface SiteShell {
  siteName: string;
  baseUrl: string;
  template: TemplateManifest;
  pages: SnapshotPage[];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Canonical URL for a page path ('/about' → 'https://…/about/'). */
export function pageUrl(baseUrl: string, path: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return path === '/' ? `${root}/` : `${root}${path}/`;
}

/**
 * The absolute submission endpoint for a published form.
 *
 * Generated static sites submit forms to `${baseUrl}/forms/${formId}` —
 * the public, abuse-protected API endpoint (see docs/security.md). When no
 * formId is known yet the helper falls back to the bare `/forms/` path.
 */
export function formActionUrl(baseUrl: string, formId?: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return formId ? `${root}/forms/${formId}` : `${root}/forms/`;
}

/** File key for a page ('/about' → 'about/index.html', '/' → 'index.html'). */
export function pageFileKey(path: string): string {
  return path === '/' ? 'index.html' : `${path.replace(/^\/+/, '')}/index.html`;
}

function cssPathFor(path: string): string {
  const depth = path.split('/').filter(Boolean).length;
  return `${'../'.repeat(depth)}assets/styles.css`;
}

function stringProp(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value : '';
}

function listProp(props: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = props[key];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function paragraphs(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
}

/* --------------------------- block renderers ------------------------- */

function renderHero(props: Record<string, unknown>): string {
  const alignment =
    props['alignment'] === 'center' || props['alignment'] === 'right' ? props['alignment'] : 'left';
  const hasButton =
    stringProp(props, 'primaryButtonLabel') !== '' || stringProp(props, 'primaryButtonLink') !== '';
  const button = hasButton
    ? `<p class="hero-actions"><a class="btn" href="${escapeHtml(stringProp(props, 'primaryButtonLink') || '#')}">${escapeHtml(stringProp(props, 'primaryButtonLabel'))}</a></p>`
    : '';
  return `<section class="hero hero-${escapeHtml(alignment)}">
  <h1>${escapeHtml(stringProp(props, 'headline'))}</h1>
  ${stringProp(props, 'subheadline') ? `<p class="hero-sub">${escapeHtml(stringProp(props, 'subheadline'))}</p>` : ''}
  ${button}
</section>`;
}

function renderTextSection(props: Record<string, unknown>): string {
  return `<section class="text-section">
  ${stringProp(props, 'heading') ? `<h2>${escapeHtml(stringProp(props, 'heading'))}</h2>` : ''}
  ${paragraphs(stringProp(props, 'content'))}
</section>`;
}

function renderServiceCards(props: Record<string, unknown>): string {
  const cards = listProp(props, 'items')
    .map(
      (item) => `<article class="card">
  <h3>${escapeHtml(item['title'])}</h3>
  ${typeof item['description'] === 'string' ? `<p>${escapeHtml(item['description'])}</p>` : ''}
</article>`,
    )
    .join('\n');
  return `<section class="service-cards">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <div class="card-grid">${cards}</div>
</section>`;
}

function renderTeamMembers(props: Record<string, unknown>): string {
  const members = listProp(props, 'members')
    .map(
      (member) => `<article class="card">
  <h3>${escapeHtml(member['name'])}</h3>
  ${typeof member['role'] === 'string' ? `<p class="role">${escapeHtml(member['role'])}</p>` : ''}
  ${typeof member['bio'] === 'string' ? `<p>${escapeHtml(member['bio'])}</p>` : ''}
</article>`,
    )
    .join('\n');
  return `<section class="team-members">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <div class="card-grid">${members}</div>
</section>`;
}

function renderTestimonials(props: Record<string, unknown>): string {
  const quotes = listProp(props, 'quotes')
    .map(
      (quote) => `<blockquote>
  <p>${escapeHtml(quote['quote'])}</p>
  <footer>${escapeHtml(quote['author'] ?? '')}${quote['role'] ? ` — ${escapeHtml(quote['role'])}` : ''}</footer>
</blockquote>`,
    )
    .join('\n');
  return `<section class="testimonials">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  ${quotes}
</section>`;
}

function renderFaq(props: Record<string, unknown>): string {
  const items = listProp(props, 'items')
    .map(
      (item) => `<div class="faq-item">
  <dt>${escapeHtml(item['question'])}</dt>
  <dd>${escapeHtml(item['answer'])}</dd>
</div>`,
    )
    .join('\n');
  return `<section class="faq">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <dl>${items}</dl>
</section>`;
}

function renderContactForm(props: Record<string, unknown>, baseUrl: string): string {
  const formId = stringProp(props, 'formId');
  return `<section class="contact-form">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <form method="post" action="${escapeHtml(formActionUrl(baseUrl, formId))}"${formId ? ` data-form-id="${escapeHtml(formId)}"` : ''}>
    <div class="hp-field" aria-hidden="true">
      <label>Leave this field empty <input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
    </div>
    <label>Name <input type="text" name="name" required /></label>
    <label>Email <input type="email" name="email" required /></label>
    <label>Message <textarea name="message" rows="5" required></textarea></label>
    <button type="submit" class="btn">${escapeHtml(stringProp(props, 'submitLabel') || 'Submit')}</button>
  </form>
</section>`;
}

function renderMapAddress(props: Record<string, unknown>): string {
  const zoom = typeof props['zoom'] === 'number' ? props['zoom'] : '';
  return `<section class="map-address">
  ${stringProp(props, 'address') ? `<h2>Visit us</h2><p class="address">${escapeHtml(stringProp(props, 'address'))}</p>` : ''}
  ${zoom ? `<p class="map-note">Map zoom: ${escapeHtml(zoom)}</p>` : ''}
</section>`;
}

function renderLogoStrip(props: Record<string, unknown>): string {
  const logos = listProp(props, 'logos')
    .map((logo) => `<li>${escapeHtml(logo['name'])}</li>`)
    .join('');
  return `<section class="logo-strip">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <ul>${logos}</ul>
</section>`;
}

function renderAnnouncementBanner(props: Record<string, unknown>): string {
  const variant =
    props['variant'] === 'warning' || props['variant'] === 'success' ? props['variant'] : 'info';
  return `<div class="banner banner-${escapeHtml(variant)}" role="status">${escapeHtml(stringProp(props, 'message'))}</div>`;
}

function renderImageGallery(props: Record<string, unknown>): string {
  const images = listProp(props, 'images')
    .map(
      (image) => `<figure>
  <img data-asset-id="${escapeHtml(image['imageAssetId'])}" alt="${escapeHtml(image['caption'] ?? '')}" loading="lazy" />
  ${typeof image['caption'] === 'string' ? `<figcaption>${escapeHtml(image['caption'])}</figcaption>` : ''}
</figure>`,
    )
    .join('\n');
  return `<section class="image-gallery">
  ${stringProp(props, 'title') ? `<h2>${escapeHtml(stringProp(props, 'title'))}</h2>` : ''}
  <div class="gallery">${images}</div>
</section>`;
}

function renderCtaSection(props: Record<string, unknown>): string {
  return `<section class="cta">
  <h2>${escapeHtml(stringProp(props, 'headline'))}</h2>
  ${stringProp(props, 'description') ? `<p>${escapeHtml(stringProp(props, 'description'))}</p>` : ''}
  ${stringProp(props, 'buttonLabel') ? `<p><a class="btn" href="${escapeHtml(stringProp(props, 'buttonLink') || '#')}">${escapeHtml(stringProp(props, 'buttonLabel'))}</a></p>` : ''}
</section>`;
}

/** Renders one block; unknown block types render nothing. */
export function renderBlock(block: SnapshotPageBlock, baseUrl: string): string {
  switch (block.type) {
    case 'hero':
      return renderHero(block.props);
    case 'text_section':
      return renderTextSection(block.props);
    case 'service_cards':
      return renderServiceCards(block.props);
    case 'team_members':
      return renderTeamMembers(block.props);
    case 'testimonials':
      return renderTestimonials(block.props);
    case 'faq':
      return renderFaq(block.props);
    case 'contact_form':
      return renderContactForm(block.props, baseUrl);
    case 'map_address':
      return renderMapAddress(block.props);
    case 'logo_strip':
      return renderLogoStrip(block.props);
    case 'announcement_banner':
      return renderAnnouncementBanner(block.props);
    case 'image_gallery':
      return renderImageGallery(block.props);
    case 'cta_section':
      return renderCtaSection(block.props);
    default:
      return '';
  }
}

/* --------------------------- page assembly --------------------------- */

function renderNav(pages: SnapshotPage[]): string {
  const links = pages
    .map(
      (page) =>
        `<li><a href="${escapeHtml(pageUrl('', page.path))}">${escapeHtml(page.title)}</a></li>`,
    )
    .join('\n');
  return `<nav aria-label="Main navigation"><ul>${links}</ul></nav>`;
}

function renderFooter(site: SiteShell): string {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <p>&copy; ${year} ${escapeHtml(site.siteName)}. All rights reserved.</p>
  <nav aria-label="Legal">
    <a href="/privacy-policy/">Privacy Policy</a>
    <a href="/terms-of-use/">Terms of Use</a>
  </nav>
</footer>`;
}

function applyTitleTemplate(seo: TemplateManifest['seo'], pageTitle: string): string {
  return seo.titleTemplate ? seo.titleTemplate.replaceAll('{title}', pageTitle) : pageTitle;
}

/** Renders a full HTML document for one page. */
export function renderPage(site: SiteShell, page: SnapshotPage): string {
  const title = applyTitleTemplate(site.template.seo, page.title);
  const description = page.description ?? site.template.seo.defaultDescription ?? '';
  const canonical = pageUrl(site.baseUrl, page.path);
  const cssPath = cssPathFor(page.path);
  const nav = renderNav(site.pages);
  const footer = renderFooter(site);
  const blocks = page.blocks.map((block) => renderBlock(block, site.baseUrl)).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(site.siteName)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="stylesheet" href="${cssPath}" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">${escapeHtml(site.siteName)}</a>
      ${nav}
    </header>
    <main>
${blocks}
    </main>
    ${footer}
  </body>
</html>
`;
}
