import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';

/**
 * Security headers applied to every response.
 * HSTS is added only in production (TLS is guaranteed there via the custom
 * domain; local development runs over plain HTTP).
 */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (c.get('env').NODE_ENV === 'production') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    await next();
  };
}
