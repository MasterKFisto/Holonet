import type { Context } from 'hono';
import { z } from '@holonet/security';
import { AppError, errorBody } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/**
 * Central error handler: every error becomes a stable JSON body
 * ({ error: { code, message, details? }, requestId? }).
 */
export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  const requestId = c.get('requestId');

  if (err instanceof AppError) {
    return c.json(
      errorBody({ code: err.code, message: err.message, details: err.details }, requestId),
      err.status,
    );
  }

  if (err instanceof z.ZodError) {
    return c.json(
      errorBody(
        { code: 'VALIDATION_ERROR', message: 'invalid request', details: err.flatten() },
        requestId,
      ),
      400,
    );
  }

  console.error(`[holonet-api] unhandled error request_id=${requestId}:`, err);
  return c.json(
    errorBody({ code: 'INTERNAL_ERROR', message: 'internal server error' }, requestId),
    500,
  );
}
