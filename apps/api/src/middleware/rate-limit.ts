import type { MiddlewareHandler } from 'hono';
import { errorBody } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Basic per-IP fixed-window rate limiting, applied to /api/*.
 *
 * In-memory buckets are per instance — fine for local development, but on
 * Function Compute (multiple instances) this must move to a shared store.
 * PLACEHOLDER: Redis-backed limiter is a future upgrade path
 * (docs/architecture.md).
 */
const buckets = new Map<string, Bucket>();

function clientIp(c: Parameters<MiddlewareHandler<AppEnv>>[0]): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || 'unknown';
}

function prune(now: number, windowMs: number): void {
  for (const [ip, bucket] of buckets) {
    if (bucket.windowStart + windowMs < now) {
      buckets.delete(ip);
    }
  }
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const windowMs = options.windowSeconds * 1000;
  return async (c, next) => {
    const ip = clientIp(c);
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || bucket.windowStart + windowMs < now) {
      buckets.set(ip, { count: 1, windowStart: now });
    } else {
      bucket.count += 1;
      if (bucket.count > options.maxRequests) {
        const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
        c.header('Retry-After', String(retryAfter));
        return c.json(
          errorBody(
            {
              code: 'RATE_LIMITED',
              message: `rate limit exceeded (${options.maxRequests} requests per ${options.windowSeconds}s)`,
            },
            c.get('requestId'),
          ),
          429,
        );
      }
    }

    if (buckets.size > 10_000) {
      prune(now, windowMs);
    }
    await next();
  };
}
