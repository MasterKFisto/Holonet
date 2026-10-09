import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/** Form routes — skeleton only (implemented in the forms phase). */
export const formRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId/forms', (c) => notImplemented(c, 'GET /api/sites/:siteId/forms'))
  .get('/api/forms/:formId/submissions', (c) =>
    notImplemented(c, 'GET /api/forms/:formId/submissions'),
  );
