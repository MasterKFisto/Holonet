import { z } from '@holonet/security';
import { buildSite, createBuildDepsFromEnv, type BuildSiteResult } from './build.js';

/**
 * Alibaba Cloud Function Compute entrypoint (event function) for the Holonet
 * builder.
 *
 * Expected event payload: { siteId, deploymentId }.
 *
 * PLACEHOLDER — the exact FC event envelope is confirmed in the deployment
 * phase (docs/deployment.md); this handler consumes the payload directly.
 */
const buildEventSchema = z.object({
  siteId: z.string().uuid(),
  deploymentId: z.string().uuid(),
});

export interface BuildEvent {
  siteId: string;
  deploymentId: string;
}

export async function handler(event: unknown): Promise<BuildSiteResult> {
  const parsed = buildEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(`invalid build event: ${parsed.error.message}`);
  }
  return buildSite(parsed.data, createBuildDepsFromEnv());
}
