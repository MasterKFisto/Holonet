import { z } from 'zod';
import { validateBlock } from '@holonet/core';

/**
 * Holonet template manifests.
 *
 * A template manifest is the single source of truth for a template:
 * - identity (id, name, semver version, category);
 * - default pages (path, title, description, initial blocks);
 * - theme defaults (colors, fonts);
 * - SEO defaults (title template, description, author).
 *
 * Block content is always treated as untrusted input (rule 17); every block
 * is validated against the block type schemas in @holonet/core.
 */

/** Default pages every Holonet template ships with. */
export const DEFAULT_TEMPLATE_PAGES = [
  { path: '/', title: 'Home' },
  { path: '/about', title: 'About' },
  { path: '/services', title: 'Services' },
  { path: '/team', title: 'Team' },
  { path: '/contact', title: 'Contact' },
  { path: '/privacy-policy', title: 'Privacy Policy' },
  { path: '/terms-of-use', title: 'Terms of Use' },
] as const;

export const templateBlockSchema = z
  .object({
    type: z.string().min(1).max(64),
    props: z.record(z.unknown()).default({}),
  })
  .superRefine((block, ctx) => {
    const result = validateBlock(block.type, block.props);
    if (!result.ok) {
      for (const issue of result.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path.split('.'),
          message: issue.message,
        });
      }
    }
  });

export const templatePageSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(300)
    .refine(
      (value) =>
        value.startsWith('/') &&
        value
          .split('/')
          .filter(Boolean)
          .every((segment) => segment !== '.' && segment !== '..'),
      'page path must be absolute and traversal-safe',
    ),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  blocks: z.array(templateBlockSchema).default([]),
});

export const templateThemeSchema = z
  .object({
    colors: z.record(z.string()).default({}),
    fonts: z.record(z.string()).default({}),
  })
  .default({});

export const templateSeoSchema = z
  .object({
    /** e.g. '{title} | Firm Name' — {title} is replaced with the page title. */
    titleTemplate: z.string().max(200).optional(),
    defaultDescription: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
  })
  .default({});

export const templateManifestSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver (x.y.z)'),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  pages: z.array(templatePageSchema).min(1),
  theme: templateThemeSchema,
  seo: templateSeoSchema,
});

export type TemplateBlock = z.infer<typeof templateBlockSchema>;
export type TemplatePage = z.infer<typeof templatePageSchema>;
export type TemplateTheme = z.infer<typeof templateThemeSchema>;
export type TemplateSeo = z.infer<typeof templateSeoSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

/** Validates and normalizes a template manifest (fails loudly on bad input). */
export function parseTemplateManifest(input: unknown): TemplateManifest {
  return templateManifestSchema.parse(input);
}
