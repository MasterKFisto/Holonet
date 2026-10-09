import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/**
 * Site routes — skeleton only (implemented in the sites phase).
 * publish/rollback/deployments are the builder/publishing surface.
 */
export const siteRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId', (c) => notImplemented(c, 'GET /api/sites/:siteId'))
  .patch('/api/sites/:siteId', (c) => notImplemented(c, 'PATCH /api/sites/:siteId'))
  .delete('/api/sites/:siteId', (c) => notImplemented(c, 'DELETE /api/sites/:siteId'))
  .post('/api/sites/:siteId/publish', (c) => notImplemented(c, 'POST /api/sites/:siteId/publish'))
  .post('/api/sites/:siteId/rollback/:deploymentId', (c) =>
    notImplemented(c, 'POST /api/sites/:siteId/rollback/:deploymentId'),
  )
  .get('/api/sites/:siteId/deployments', (c) =>
    notImplemented(c, 'GET /api/sites/:siteId/deployments'),
  );
