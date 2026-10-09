import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../types.js';

/**
 * Stable, documented API error codes. Clients must rely on these strings,
 * never on messages (which may change).
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'INVALID_CONFIG',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Application error carrying a stable code and HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: ContentfulStatusCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Canonical JSON error body (optionally correlated with the request id). */
export function errorBody(
  error: { code: ErrorCode; message: string; details?: unknown },
  requestId?: string,
): { error: { code: ErrorCode; message: string; details?: unknown }; requestId?: string } {
  const body: { error: { code: ErrorCode; message: string; details?: unknown } } = {
    error: { code: error.code, message: error.message },
  };
  if (error.details !== undefined) {
    body.error.details = error.details;
  }
  return requestId ? { ...body, requestId } : body;
}

/**
 * Structured response for routes that exist but are not implemented yet.
 * The route structure is final; implementations land phase by phase.
 */
export function notImplemented(c: Context<AppEnv>, feature: string): Response {
  return c.json(
    errorBody(
      {
        code: 'NOT_IMPLEMENTED',
        message: `${feature} is not implemented yet (API skeleton phase)`,
      },
      c.get('requestId'),
    ),
    501,
  );
}
