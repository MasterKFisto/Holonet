import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { errorBody } from '../lib/errors.js';
import { requireDb } from '../lib/db.js';
import { recordSecurityEvent } from '../lib/security.js';
import { clientIp } from './rate-limit.js';
import type { AppEnv } from '../types.js';

/**
 * Login rate limiting: per IP+email, LOGIN_MAX_FAILURES failures within
 * LOGIN_WINDOW_SECONDS block further attempts (429).
 *
 * In-memory per instance — a Redis-backed limiter is a future upgrade path
 * (docs/architecture.md). Failed attempts are recorded by the login handler;
 * blocks are also recorded as security events.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

interface FailureBucket {
  count: number;
  windowStart: number;
}

const failures = new Map<string, FailureBucket>();

function loginKey(ip: string, email: string): string {
  const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  return `${ip}|${emailHash}`;
}

export function recordLoginFailure(ip: string, email: string): void {
  const key = loginKey(ip, email);
  const now = Date.now();
  const bucket = failures.get(key);
  if (!bucket || bucket.windowStart + LOGIN_WINDOW_SECONDS * 1000 < now) {
    failures.set(key, { count: 1, windowStart: now });
  } else {
    bucket.count += 1;
  }
}

export function clearLoginFailures(ip: string, email: string): void {
  failures.delete(loginKey(ip, email));
}

export function loginRateLimit(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email : '';
    if (!email) {
      await next();
      return;
    }

    const ip = clientIp(c);
    const key = loginKey(ip, email);
    const bucket = failures.get(key);
    const now = Date.now();
    const windowMs = LOGIN_WINDOW_SECONDS * 1000;

    if (bucket && bucket.windowStart + windowMs >= now && bucket.count >= LOGIN_MAX_FAILURES) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      await recordSecurityEvent(requireDb(c), {
        eventType: 'login_rate_limited',
        severity: 'warning',
        metadata: { email },
      });
      return c.json(
        errorBody(
          { code: 'RATE_LIMITED', message: 'too many failed login attempts — try again later' },
          c.get('requestId'),
        ),
        429,
      );
    }
    await next();
  };
}
