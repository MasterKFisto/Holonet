import { z } from 'zod';

/**
 * Holonet template manifests and block schemas.
 *
 * Real templates ship in a later phase; these schemas define the contract
 * that templates and the static generator agree on. Block content is always
 * treated as untrusted input (docs/PROJECT_RULES.md rule 17).
 */

export const blockSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.unknown(),
});

export type Block = z.infer<typeof blockSchema>;

export const templateManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  blocks: z.array(blockSchema),
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
