import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDatabase, type HolonetDatabase } from '@holonet/db';
import {
  createStorageProviderFromEnv,
  setOssCredentialsProvider,
  type StorageProvider,
} from '@holonet/storage';
import { createBuilderInvoker, type BuilderInvoker } from './lib/builder-invoker.js';
import { corsOriginList, loadEnv, type Env } from './config/env.js';
import { errorBody } from './lib/errors.js';
import { getFcContext } from './lib/fc-context.js';
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
 * `db`, `storage`, and `builder` are injectable for tests; by default they
 * are created from DATABASE_URL, the storage environment variables, and
 * BUILDER_INVOKER (rules 10/11).
 */
export function createApp(
  env: Env = loadEnv(),
  db?: HolonetDatabase,
  storage?: StorageProvider,
  builder?: BuilderInvoker,
  privateStorage?: StorageProvider,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // On Function Compute, OSS credentials come from the execution RAM role's
  // STS credentials captured from the invocation context (no static keys).
  // Locally the provider returns undefined and env credentials are used.
  setOssCredentialsProvider(() => {
    const credentials = getFcContext()?.credentials;
    return credentials?.accessKeyId && credentials.accessKeySecret
      ? {
          accessKeyId: credentials.accessKeyId,
          accessKeySecret: credentials.accessKeySecret,
          securityToken: credentials.securityToken,
        }
      : undefined;
  });
  const database = db ?? (env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : undefined);
  const storageProvider = storage ?? createStorageProviderFromEnv('public');
  // Raw imported website content is private by design — never in the
  // public bucket (rule 19, docs/security.md).
  const privateStorageProvider = privateStorage ?? createStorageProviderFromEnv('private');
  const builderInvoker =
    builder ??
    createBuilderInvoker(env.BUILDER_INVOKER, {
      db: database,
      storage: storageProvider,
      publicBaseUrl: env.PUBLIC_BASE_URL,
    });

  // Typed environment, database, storage, and builder access for every handler.
  app.use('*', async (c, next) => {
    c.set('env', env);
    if (database) {
      c.set('db', database);
    }
    c.set('storage', storageProvider);
    c.set('privateStorage', privateStorageProvider);
    c.set('builder', builderInvoker);
    await next();
  });

  // Cross-cutting middleware (registration order = execution order).
  app.use('*', securityHeaders());
  app.use('*', cors({ origin: corsOriginList(env), credentials: true }));
  // Public form submission endpoints are CSRF-exempt (protected by
  // honeypot + IP/form rate limiting instead) — see docs/security.md.
  app.use('*', csrfProtection({ exclude: ['/forms'] }));
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
