import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { corsOriginList, loadEnv, type Env } from './config/env.js';
import { errorBody } from './lib/errors.js';
import { requireAdmin } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
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
 */
export function createApp(env: Env = loadEnv()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Typed environment access for every handler/middleware.
  app.use('*', async (c, next) => {
    c.set('env', env);
    await next();
  });

  // Cross-cutting middleware (registration order = execution order).
  app.use('*', securityHeaders());
  app.use('*', cors({ origin: corsOriginList(env), credentials: true }));
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

export { requireAdmin };
