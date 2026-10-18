/**
 * Module-scoped holder for the Function Compute invocation context.
 *
 * The fc3 HTTP trigger adapter (apps/api/src/function.ts) stores the context
 * (temporary STS credentials, region, accountId, requestId) here on every
 * request; other code — e.g. the FcBuilderInvoker — reads it at request time.
 *
 * Caveat: module scope is per warm instance on Function Compute. Concurrent
 * requests inside one instance share this holder, so treat it as best-effort;
 * a request-scoped handoff is the upgrade path.
 */
export interface FcContextInfo {
  requestId?: string;
  region?: string;
  accountId?: string;
  credentials?: {
    accessKeyId?: string;
    accessKeySecret?: string;
    securityToken?: string;
  };
  raw?: unknown;
}

let currentFcContext: FcContextInfo | undefined;

export function storeFcContext(context: unknown): void {
  const record =
    typeof context === 'object' && context !== null ? (context as Record<string, unknown>) : {};
  const credentials =
    typeof record['credentials'] === 'object' && record['credentials'] !== null
      ? (record['credentials'] as Record<string, unknown>)
      : {};
  currentFcContext = {
    requestId: typeof record['requestId'] === 'string' ? record['requestId'] : undefined,
    region: typeof record['region'] === 'string' ? record['region'] : undefined,
    accountId: typeof record['accountId'] === 'string' ? record['accountId'] : undefined,
    credentials: {
      accessKeyId:
        typeof credentials['accessKeyId'] === 'string' ? credentials['accessKeyId'] : undefined,
      accessKeySecret:
        typeof credentials['accessKeySecret'] === 'string'
          ? credentials['accessKeySecret']
          : undefined,
      securityToken:
        typeof credentials['securityToken'] === 'string' ? credentials['securityToken'] : undefined,
    },
    raw: context,
  };
}

export function getFcContext(): FcContextInfo | undefined {
  return currentFcContext;
}
