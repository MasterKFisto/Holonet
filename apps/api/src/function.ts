import { createApp } from './app.js';
import { errorBody, type ErrorCode } from './lib/errors.js';
import { getFcContext, storeFcContext } from './lib/fc-context.js';

/**
 * Alibaba Cloud Function Compute 3.0 (component fc3) HTTP trigger adapter.
 *
 * Target runtime: Node.js 20 built-in runtime, HTTP trigger with
 * `authType: anonymous`, handler `index.handler` (the esbuild packaging in
 * infra/scripts/package-api.sh bundles this file to CommonJS, where
 * `export async function handler` becomes `exports.handler`).
 *
 * The FC3 HTTP trigger delivers an API-Gateway-style event (see
 * docs/assumptions.md for the exact shape and the console verification step):
 *
 *   {
 *     "version": "v1",
 *     "rawPath": "/api/health",
 *     "body": "<string>",
 *     "isBase64Encoded": true | false,
 *     "queryParameters": { ... },
 *     "headers": { ... },
 *     "requestContext": { "http": { "method": "GET", "path": "..." } }
 *   }
 *
 * This adapter converts the event into a Web standard Request, runs the
 * existing Hono app via app.fetch(request), and converts the Web Response
 * back into the FC3 response format:
 *
 *   { "statusCode": number, "headers": { ... }, "isBase64Encoded": boolean, "body": string }
 *
 * Binary bodies (non-text content types) are base64-encoded with
 * isBase64Encoded=true. Local development is unaffected — the Node server in
 * apps/api/src/index.ts never touches this file.
 */

export interface Fc3HttpRequestContext {
  http?: {
    method?: string;
    path?: string;
    sourceIp?: string;
    protocol?: string;
  };
  requestId?: string;
}

export interface Fc3HttpEvent {
  version?: string;
  rawPath: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  queryParameters?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  requestContext?: Fc3HttpRequestContext;
}

export interface Fc3HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  isBase64Encoded: boolean;
  body: string;
}

/**
 * FC context captured per invocation — other code (e.g. the FcBuilderInvoker)
 * reads temporary STS credentials from here at request time. The holder lives
 * in lib/fc-context.ts to avoid a module cycle with the builder invoker.
 */
export { storeFcContext, getFcContext, type FcContextInfo } from './lib/fc-context.js';

/** Parses the FC3 HTTP event from a JSON string, Buffer, or plain object. */
export function parseFcEvent(event: unknown): Fc3HttpEvent {
  let parsed: unknown = event;
  if (Buffer.isBuffer(event)) {
    parsed = JSON.parse(event.toString('utf8'));
  } else if (typeof event === 'string') {
    parsed = JSON.parse(event);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('FC3 HTTP event must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record['rawPath'] !== 'string' || record['rawPath'] === '') {
    throw new Error('FC3 HTTP event is missing rawPath');
  }
  return {
    version: typeof record['version'] === 'string' ? record['version'] : undefined,
    rawPath: record['rawPath'],
    body: typeof record['body'] === 'string' ? record['body'] : null,
    isBase64Encoded: record['isBase64Encoded'] === true,
    queryParameters:
      typeof record['queryParameters'] === 'object' && record['queryParameters'] !== null
        ? (record['queryParameters'] as Record<string, unknown>)
        : undefined,
    headers:
      typeof record['headers'] === 'object' && record['headers'] !== null
        ? (record['headers'] as Record<string, string | undefined>)
        : undefined,
    requestContext:
      typeof record['requestContext'] === 'object' && record['requestContext'] !== null
        ? (record['requestContext'] as Fc3HttpRequestContext)
        : undefined,
  };
}

function queryStringFrom(params?: Record<string, unknown>): string {
  if (!params) {
    return '';
  }
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      entries.push([key, item === null || item === undefined ? '' : String(item)]);
    }
  }
  if (entries.length === 0) {
    return '';
  }
  return `?${entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

/** Converts a parsed FC3 HTTP event into a Web standard Request. */
export function fcEventToRequest(event: Fc3HttpEvent): Request {
  const headers = event.headers ?? {};
  const host = headers['host'] ?? 'holonet.section-zero.link';
  const protocol = (headers['x-forwarded-proto'] ?? 'http') === 'https' ? 'https' : 'http';
  const rawPath = event.rawPath.startsWith('/') ? event.rawPath : `/${event.rawPath}`;
  const url = `${protocol}://${host}${rawPath}${queryStringFrom(event.queryParameters)}`;

  const method = event.requestContext?.http?.method ?? 'GET';

  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      requestHeaders.set(key, value);
    }
  }

  let body: Uint8Array | undefined;
  if (event.body !== null && event.body !== undefined && event.body !== '') {
    body = new Uint8Array(
      event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8'),
    );
  }

  return new Request(url, { method, headers: requestHeaders, body });
}

/** Content types that are transported as UTF-8 text in the FC3 response. */
const TEXT_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'image/svg+xml',
];

function isTextualContent(contentType: string): boolean {
  if (contentType === '') {
    return true; // fall back to a UTF-8-safe attempt below
  }
  return TEXT_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix));
}

/** Converts a Web Response into the FC3 HTTP response format. */
export async function responseToFc3(response: Response): Promise<Fc3HttpResponse> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing === undefined) {
      headers[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[key] = [existing, value];
    }
  });

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    return { statusCode: response.status, headers, isBase64Encoded: false, body: '' };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (isTextualContent(contentType)) {
    try {
      const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { statusCode: response.status, headers, isBase64Encoded: false, body };
    } catch {
      // Invalid UTF-8 despite a textual content type — transport as binary.
    }
  }
  return {
    statusCode: response.status,
    headers,
    isBase64Encoded: true,
    body: bytes.toString('base64'),
  };
}

function structuredError(status: number, code: ErrorCode, message: string): Fc3HttpResponse {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    isBase64Encoded: false,
    body: JSON.stringify(errorBody({ code, message })),
  };
}

/**
 * FC3 HTTP trigger entrypoint (`exports.handler` once bundled to CommonJS).
 * Accepts the event as a Buffer or JSON string (plain objects tolerated for
 * console testing); unparseable events get a structured 400 instead of a crash.
 */
export async function handler(event: unknown, context?: unknown): Promise<Fc3HttpResponse> {
  storeFcContext(context);

  let parsed: Fc3HttpEvent;
  try {
    parsed = parseFcEvent(event);
  } catch (error) {
    console.error('[holonet-fc] invalid FC3 HTTP event:', error);
    return structuredError(400, 'BAD_REQUEST', 'invalid Function Compute HTTP event');
  }

  // The request id may also arrive on the event context — surface it for
  // cross-function tracing.
  const storedContext = getFcContext();
  if (storedContext && !storedContext.requestId && parsed.requestContext?.requestId) {
    storedContext.requestId = parsed.requestContext.requestId;
  }

  try {
    const request = fcEventToRequest(parsed);
    const response = await createApp().fetch(request);
    return await responseToFc3(response);
  } catch (error) {
    console.error('[holonet-fc] unhandled error:', error);
    return structuredError(500, 'INTERNAL_ERROR', 'internal server error');
  }
}
