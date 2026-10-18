import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { cookieSecure } from '../config/env.js';
import { errorBody } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

export const CSRF_COOKIE_NAME = 'holonet_csrf';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfProtectionOptions {
  /**
   * Path prefixes exempt from CSRF checks — public endpoints that
   * intentionally accept cross-origin traffic (e.g. '/forms' form
   * submissions from published static sites).
   */
  exclude?: string[];
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Double-submit CSRF protection:
 * - a readable `holonet_csrf` cookie is issued on every response;
 * - state-changing requests must echo it in the `X-CSRF-Token` header.
 *
 * Cross-origin attackers cannot read the victim's cookie, so they cannot
 * forge the header. Combined with SameSite=Lax on the session cookie, this
 * blocks CSRF for all state-changing API routes. Public endpoints can be
 * exempted via `exclude` (they carry their own abuse protection).
 */
export function csrfProtection(options: CsrfProtectionOptions = {}): MiddlewareHandler<AppEnv> {
  const exclude = options.exclude ?? [];
  return async (c, next) => {
    if (exclude.some((prefix) => c.req.path.startsWith(prefix))) {
      await next();
      return;
    }
    const secure = cookieSecure(c.get('env'));
    let token = getCookie(c, CSRF_COOKIE_NAME);
    if (!token) {
      token = randomBytes(32).toString('base64url');
      setCookie(c, CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: 'Lax',
        secure,
        path: '/',
      });
    }
    if (STATE_CHANGING_METHODS.has(c.req.method)) {
      const header = c.req.header('x-csrf-token') ?? '';
      if (!safeEqual(header, token)) {
        return c.json(
          errorBody(
            { code: 'FORBIDDEN', message: 'CSRF token missing or invalid' },
            c.get('requestId'),
          ),
          403,
        );
      }
    }
    await next();
  };
}
