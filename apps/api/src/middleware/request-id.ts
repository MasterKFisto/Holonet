import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Request ID middleware: accepts a client-supplied X-Request-Id when it is
 * safe (bounded charset/length), otherwise generates a UUID. The id is
 * available as c.get('requestId') and echoed in the response header.
 */
export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  };
}
