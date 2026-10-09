import { z } from 'zod';

/**
 * Holonet block type definitions — the single source of truth for block
 * validation. Block props are stored as JSONB and are untrusted data
 * (docs/PROJECT_RULES.md rule 17); every create/update must pass through
 * validateBlock().
 */

export type BlockType =
  | 'hero'
  | 'text_section'
  | 'service_cards'
  | 'team_members'
  | 'testimonials'
  | 'faq'
  | 'contact_form'
  | 'map_address'
  | 'logo_strip'
  | 'announcement_banner'
  | 'image_gallery'
  | 'cta_section';

export type BlockProps = Record<string, unknown>;

const assetId = z.string().uuid();

export const heroBlockSchema = z.object({
  type: z.literal('hero'),
  props: z.object({
    headline: z.string().min(1).max(200),
    subheadline: z.string().max(500).optional(),
    backgroundImageAssetId: assetId.optional(),
    primaryButtonLabel: z.string().max(100).optional(),
    primaryButtonLink: z.string().max(500).optional(),
    alignment: z.enum(['left', 'center', 'right']).optional(),
  }),
});

export const textSectionBlockSchema = z.object({
  type: z.literal('text_section'),
  props: z.object({
    heading: z.string().max(200).optional(),
    content: z.string().min(1).max(20000),
  }),
});

export const serviceCardsBlockSchema = z.object({
  type: z.literal('service_cards'),
  props: z.object({
    title: z.string().max(200).optional(),
    items: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          iconAssetId: assetId.optional(),
        }),
      )
      .min(1)
      .max(12),
  }),
});

export const teamMembersBlockSchema = z.object({
  type: z.literal('team_members'),
  props: z.object({
    title: z.string().max(200).optional(),
    members: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          role: z.string().max(200).optional(),
          photoAssetId: assetId.optional(),
          bio: z.string().max(2000).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
});

export const testimonialsBlockSchema = z.object({
  type: z.literal('testimonials'),
  props: z.object({
    title: z.string().max(200).optional(),
    quotes: z
      .array(
        z.object({
          quote: z.string().min(1).max(2000),
          author: z.string().max(200).optional(),
          role: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
});

export const faqBlockSchema = z.object({
  type: z.literal('faq'),
  props: z.object({
    title: z.string().max(200).optional(),
    items: z
      .array(
        z.object({
          question: z.string().min(1).max(500),
          answer: z.string().min(1).max(5000),
        }),
      )
      .min(1)
      .max(50),
  }),
});

export const contactFormBlockSchema = z.object({
  type: z.literal('contact_form'),
  props: z.object({
    title: z.string().max(200).optional(),
    formId: z.string().uuid().optional(),
    submitLabel: z.string().max(100).optional(),
  }),
});

export const mapAddressBlockSchema = z.object({
  type: z.literal('map_address'),
  props: z.object({
    address: z.string().min(1).max(500),
    mapAssetId: assetId.optional(),
    zoom: z.number().int().min(1).max(20).optional(),
  }),
});

export const logoStripBlockSchema = z.object({
  type: z.literal('logo_strip'),
  props: z.object({
    title: z.string().max(200).optional(),
    logos: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          imageAssetId: assetId,
        }),
      )
      .min(1)
      .max(30),
  }),
});

export const announcementBannerBlockSchema = z.object({
  type: z.literal('announcement_banner'),
  props: z.object({
    message: z.string().min(1).max(1000),
    variant: z.enum(['info', 'warning', 'success']).optional(),
  }),
});

export const imageGalleryBlockSchema = z.object({
  type: z.literal('image_gallery'),
  props: z.object({
    title: z.string().max(200).optional(),
    images: z
      .array(
        z.object({
          imageAssetId: assetId,
          caption: z.string().max(500).optional(),
        }),
      )
      .min(1)
      .max(100),
    columns: z.number().int().min(1).max(6).optional(),
  }),
});

export const ctaSectionBlockSchema = z.object({
  type: z.literal('cta_section'),
  props: z.object({
    headline: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    buttonLabel: z.string().max(100).optional(),
    buttonLink: z.string().max(500).optional(),
  }),
});

/** Registry of every supported block type schema. */
export const blockSchemas = {
  hero: heroBlockSchema,
  text_section: textSectionBlockSchema,
  service_cards: serviceCardsBlockSchema,
  team_members: teamMembersBlockSchema,
  testimonials: testimonialsBlockSchema,
  faq: faqBlockSchema,
  contact_form: contactFormBlockSchema,
  map_address: mapAddressBlockSchema,
  logo_strip: logoStripBlockSchema,
  announcement_banner: announcementBannerBlockSchema,
  image_gallery: imageGalleryBlockSchema,
  cta_section: ctaSectionBlockSchema,
} as const;

export const BLOCK_TYPES = Object.keys(blockSchemas) as BlockType[];

export interface BlockValidationIssue {
  path: string;
  message: string;
}

export type BlockValidationResult =
  { ok: true; type: BlockType; props: BlockProps } | { ok: false; issues: BlockValidationIssue[] };

/**
 * Validates block props against the schema for the given type.
 * Unknown object keys are stripped by Zod (non-strict objects).
 */
export function validateBlock(type: string, props: unknown): BlockValidationResult {
  const schema = blockSchemas[type as BlockType];
  if (!schema) {
    return { ok: false, issues: [{ path: 'type', message: `unknown block type: ${type}` }] };
  }
  const result = schema.safeParse({ type, props });
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  return { ok: true, type: result.data.type, props: result.data.props };
}
