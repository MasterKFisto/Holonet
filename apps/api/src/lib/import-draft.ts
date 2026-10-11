import { eq } from 'drizzle-orm';
import { BLOCK_TYPES, validateBlock } from '@holonet/core';
import { importAnalysisOutputSchema, type ImportAnalysisOutput } from '@holonet/ai';
import { getTemplate, holonetTemplates } from '@holonet/templates';
import {
  blocks,
  designTokens,
  pages,
  sites,
  templates,
  templateVersions,
  type HolonetDatabase,
  type TemplateManifestJson,
} from '@holonet/db';

/**
 * Draft creation from a validated AI import analysis.
 *
 * Rules enforced here (docs/security.md, "AI website import"):
 *  - the analysis is re-validated with Zod before anything is created
 *    (AI output is untrusted, rule 17);
 *  - only DRAFT pages and blocks are created — nothing is published and no
 *    deployment is touched;
 *  - the suggested template is used only when it matches a known manifest;
 *  - imported text is sanitized/limited by the output schema;
 *  - the import job is linked to the site via import_jobs.site_id.
 */

const KNOWN_TEMPLATE_IDS = new Set(holonetTemplates.map((template) => template.id));

export interface ImportDraftResult {
  pagesCreated: number;
  blocksCreated: number;
  templateVersionId: string | null;
  templateIdUsed: string | null;
}

/** Sanitizes an AI-supplied path into '/about' form. */
function pagePath(rawPath: string | undefined, fallbackTitle: string, index: number): string {
  const slug = (rawPath ?? fallbackTitle)
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^\/+|\/+$/g, '');
  if (slug === '' || index === 0) {
    return '/';
  }
  return `/${slug}`;
}

/** Maps an AI block suggestion to a validated Holonet block. */
function buildBlock(
  section: ImportAnalysisOutput['pages'][number]['sections'][number],
  fallbackHeading: string,
): { type: string; props: Record<string, unknown> } {
  const type = BLOCK_TYPES.includes(section.type as (typeof BLOCK_TYPES)[number])
    ? section.type
    : 'text_section';
  const heading = section.heading ?? fallbackHeading;
  const content = section.content ?? (section.items ?? []).join('\n\n');

  let props: Record<string, unknown> = { heading, content };
  switch (type) {
    case 'hero':
      props = { headline: heading, subheadline: content.slice(0, 500) };
      break;
    case 'cta_section':
      props = {
        headline: heading,
        description: content.slice(0, 1000),
        buttonLabel: section.buttonLabel,
        buttonLink: section.buttonLink,
      };
      break;
    case 'service_cards':
      props = {
        title: heading,
        items: (section.items ?? [heading]).slice(0, 12).map((item) => ({
          title: item.slice(0, 200),
          description: '',
        })),
      };
      break;
    case 'faq':
      props = {
        title: heading,
        items: (section.items ?? []).slice(0, 25).map((item) => ({
          question: item.slice(0, 500),
          answer: '',
        })),
      };
      break;
    case 'announcement_banner':
      props = { message: (heading || content).slice(0, 1000) };
      break;
    case 'contact_form':
      props = { title: heading };
      break;
    default:
      props = { heading, content };
  }

  const validation = validateBlock(type, props);
  if (!validation.ok) {
    // Never persist an invalid block — degrade to a plain text section.
    return { type: 'text_section', props: { heading, content } };
  }
  return { type: validation.type, props: validation.props };
}

/**
 * Applies a validated analysis to the site: template link, draft pages,
 * draft blocks, and theme tokens. Idempotent path uniqueness is handled by
 * suffixing; nothing here publishes.
 */
export async function applyImportAnalysis(input: {
  db: HolonetDatabase;
  workspaceId: string;
  siteId: string;
  analysis: unknown;
}): Promise<ImportDraftResult> {
  const { db, workspaceId, siteId } = input;
  // 1. AI output must be validated before creating a draft (rule 17).
  const analysis: ImportAnalysisOutput = importAnalysisOutputSchema.parse(input.analysis);

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) {
    throw new Error(`applyImportAnalysis: site not found: ${siteId}`);
  }

  // 2. Suggested template — only when it matches a known manifest.
  let templateVersionId: string | null = null;
  let templateIdUsed: string | null = null;
  const suggested = analysis.suggestedTemplate;
  if (suggested && KNOWN_TEMPLATE_IDS.has(suggested)) {
    const manifest = getTemplate(suggested);
    if (manifest) {
      // DB manifest shape keeps a flat blocks list (TemplateManifestJson).
      const manifestJson: TemplateManifestJson = {
        ...manifest,
        blocks: manifest.pages.flatMap((page) => page.blocks ?? []),
      };
      const existing = await db.query.templates.findFirst({
        where: eq(templates.name, manifest.name),
      });
      const template =
        existing ??
        (
          await db
            .insert(templates)
            .values({ workspaceId, name: manifest.name, status: 'published' })
            .returning()
        )[0];
      if (template) {
        const existingVersion = await db.query.templateVersions.findFirst({
          where: eq(templateVersions.templateId, template.id),
        });
        const version =
          existingVersion ??
          (
            await db
              .insert(templateVersions)
              .values({
                templateId: template.id,
                version: '1.0.0',
                manifest: manifestJson,
                isCurrent: true,
              })
              .returning()
          )[0];
        if (version) {
          templateVersionId = version.id;
          templateIdUsed = suggested;
          await db
            .update(sites)
            .set({ templateVersionId: version.id, updatedAt: new Date() })
            .where(eq(sites.id, siteId));
        }
      }
    }
  }

  // 3. Site stays a draft — a published site is never auto-unpublished, but
  //    every page created here is a draft either way.
  if (site.status !== 'published') {
    await db
      .update(sites)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(sites.id, siteId));
  }

  // 4. Theme tokens (analysis.designTokens → design_tokens row).
  const tokens = { ...(analysis.designTokens ?? {}) };
  if (Object.keys(tokens).length > 0) {
    await db
      .insert(designTokens)
      .values({ workspaceId, siteId, name: 'imported', tokens })
      .onConflictDoUpdate({
        target: [designTokens.workspaceId, designTokens.siteId, designTokens.name],
        set: { tokens, updatedAt: new Date() },
      });
  }

  // 5. Draft pages + blocks.
  const existingPaths = new Set(
    (await db.select().from(pages).where(eq(pages.siteId, siteId))).map((page) => page.path),
  );
  let pagesCreated = 0;
  let blocksCreated = 0;

  for (const [pageIndex, draft] of analysis.pages.entries()) {
    let path = pagePath(draft.path, draft.title, pageIndex);
    if (existingPaths.has(path)) {
      let suffix = 2;
      while (existingPaths.has(`${path}-${suffix}`)) {
        suffix += 1;
      }
      path = `${path}-${suffix}`;
    }
    existingPaths.add(path);

    const [page] = await db
      .insert(pages)
      .values({
        siteId,
        path,
        title: draft.title.slice(0, 300),
        status: 'draft',
        sortOrder: pageIndex,
        meta: {},
      })
      .returning();
    pagesCreated += 1;

    for (const [sectionIndex, section] of draft.sections.entries()) {
      const block = buildBlock(section, draft.title);
      await db.insert(blocks).values({
        pageId: page!.id,
        siteId,
        type: block.type,
        props: block.props,
        sortOrder: sectionIndex,
      });
      blocksCreated += 1;
    }
  }

  return { pagesCreated, blocksCreated, templateVersionId, templateIdUsed };
}
