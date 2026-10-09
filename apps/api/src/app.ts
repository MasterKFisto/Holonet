import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDatabase, type HolonetDatabase } from '@holonet/db';
import { createStorageProviderFromEnv, type StorageProvider } from '@holonet/storage';
import { corsOriginList, loadEnv, type Env } from './config/env.js';
import { errorBody } from './lib/errors.js';
import { errorHandler } from './middleware/error-handler.js';
import { csrfProtection } from './middleware/csrf.js';
import { requestLogger } from './middleware/logging.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { mountRoutes } from './routes/index.js';
import type { AppEnv } from './types.js';

/**
 * Builds the Holonet API application.
 *
 * The same app serves local development (@hono/node-server in src/index.ts)
 * and Function Compute (HTTP-triggered handler in src/function.ts).
 * `db` and `storage` are injectable for tests; by default they are created
 * from DATABASE_URL and the storage environment variables (rules 10/11).
 */
export function createApp(
  env: Env = loadEnv(),
  db?: HolonetDatabase,
  storage?: StorageProvider,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const database = db ?? (env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : undefined);
  const storageProvider = storage ?? createStorageProviderFromEnv('public');

  // Typed environment, database, and storage access for every handler.
  app.use('*', async (c, next) => {
    c.set('env', env);
    if (database) {
      c.set('db', database);
    }
    c.set('storage', storageProvider);
    await next();
  });

  // Cross-cutting middleware (registration order = execution order).
  app.use('*', securityHeaders());
  app.use('*', cors({ origin: corsOriginList(env), credentials: true }));
  app.use('*', csrfProtection());
  app.use('*', requestId());
  app.use('*', requestLogger());
  app.use(
    '/api/*',
    rateLimit({
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    }),
  );

  mountRoutes(app);

  app.notFound((c) =>
    c.json(
      errorBody(
        { code: 'NOT_FOUND', message: `no route for ${c.req.method} ${c.req.path}` },
        c.get('requestId'),
      ),
      404,
    ),
  );
  app.onError(errorHandler);

  return app;
}
