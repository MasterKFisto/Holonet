import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { cookieSecure, type Env } from '../config/env.js';
import type { AppEnv } from '../types.js';

/**
 * Session cookie (rule: HTTP-only, SameSite=Lax). The Secure flag derives
 * from the PUBLIC_BASE_URL scheme (https:// → Secure) — see cookieSecure.
 * The session token is a signed JWT (jose HS256) — see @holonet/security.
 */
export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const env = c.get('env');
  setCookie(c, env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(env),
    sameSite: 'Lax',
    path: '/',
    maxAge: env.SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, c.get('env').SESSION_COOKIE_NAME, { path: '/' });
}

export function sessionCookieName(env: Env): string {
  return env.SESSION_COOKIE_NAME;
}
