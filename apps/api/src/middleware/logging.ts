import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';

/**
 * Structured request logging. Every request logs one line:
 *   [holonet-api] request_id=... method=GET path=/api/health status=200 duration_ms=3
 * Quiet in tests to keep test output readable.
 */
export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('env').NODE_ENV === 'test') {
      await next();
      return;
    }
    const started = Date.now();
    await next();
    const durationMs = Date.now() - started;
    console.log(
      `[holonet-api] request_id=${c.get('requestId')} method=${c.req.method} ` +
        `path=${c.req.path} status=${c.res.status} duration_ms=${durationMs}`,
    );
  };
}
