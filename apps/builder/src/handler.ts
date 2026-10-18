import { z } from '@holonet/security';
import { setOssCredentialsProvider } from '@holonet/storage';
import { buildSite, createBuildDepsFromEnv, type BuildSiteResult } from './build.js';

/**
 * Alibaba Cloud Function Compute entrypoint (event function) for the Holonet
 * builder, invoked asynchronously by the API's FcBuilderInvoker with the JSON
 * payload `{ "siteId": "...", "deploymentId": "..." }`.
 *
 * FC3 event functions deliver the invoke payload as a Buffer (or JSON string);
 * plain objects are tolerated for console testing.
 */
const buildEventSchema = z.object({
  siteId: z.string().uuid(),
  deploymentId: z.string().uuid(),
});

export interface BuildEvent {
  siteId: string;
  deploymentId: string;
}

/** Parses the FC3 event-function payload (Buffer, JSON string, or object). */
export function parseBuildEvent(event: unknown): BuildEvent {
  let candidate: unknown = event;
  if (Buffer.isBuffer(candidate)) {
    candidate = candidate.toString('utf8');
  }
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      throw new Error('invalid build event: payload is not valid JSON');
    }
  }
  const parsed = buildEventSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`invalid build event: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * The builder runs on Function Compute without static AccessKeys: OSS
 * credentials come from the execution RAM role via the invocation context.
 * They are captured per invocation and exposed to @holonet/storage through
 * the process-wide credentials provider (registered once below).
 */
let currentCredentials:
  { accessKeyId?: string; accessKeySecret?: string; securityToken?: string } | undefined;

function storeFcCredentials(context: unknown): void {
  const record =
    typeof context === 'object' && context !== null ? (context as Record<string, unknown>) : {};
  const credentials =
    typeof record['credentials'] === 'object' && record['credentials'] !== null
      ? (record['credentials'] as Record<string, unknown>)
      : {};
  currentCredentials = {
    accessKeyId:
      typeof credentials['accessKeyId'] === 'string' ? credentials['accessKeyId'] : undefined,
    accessKeySecret:
      typeof credentials['accessKeySecret'] === 'string'
        ? credentials['accessKeySecret']
        : undefined,
    securityToken:
      typeof credentials['securityToken'] === 'string' ? credentials['securityToken'] : undefined,
  };
}

setOssCredentialsProvider(() =>
  currentCredentials?.accessKeyId && currentCredentials.accessKeySecret
    ? {
        accessKeyId: currentCredentials.accessKeyId,
        accessKeySecret: currentCredentials.accessKeySecret,
        securityToken: currentCredentials.securityToken,
      }
    : undefined,
);

export async function handler(event: unknown, context?: unknown): Promise<BuildSiteResult> {
  storeFcCredentials(context);
  return buildSite(parseBuildEvent(event), createBuildDepsFromEnv());
}
