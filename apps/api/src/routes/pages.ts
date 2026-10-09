import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/** Page routes — skeleton only (implemented in the pages phase). */
export const pageRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId/pages', (c) => notImplemented(c, 'GET /api/sites/:siteId/pages'))
  .post('/api/sites/:siteId/pages', (c) => notImplemented(c, 'POST /api/sites/:siteId/pages'))
  .patch('/api/pages/:pageId', (c) => notImplemented(c, 'PATCH /api/pages/:pageId'))
  .delete('/api/pages/:pageId', (c) => notImplemented(c, 'DELETE /api/pages/:pageId'));
