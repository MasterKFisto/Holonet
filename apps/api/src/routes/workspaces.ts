import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/**
 * Workspace routes — skeleton only (implemented in the workspaces phase).
 * Nested site listing/creation are scoped under /api/workspaces/:workspaceId
 * and will be guarded by requireWorkspaceAccess.
 */
export const workspaceRoutes = new Hono<AppEnv>()
  .get('/api/workspaces', (c) => notImplemented(c, 'GET /api/workspaces'))
  .post('/api/workspaces', (c) => notImplemented(c, 'POST /api/workspaces'))
  .get('/api/workspaces/:workspaceId', (c) => notImplemented(c, 'GET /api/workspaces/:workspaceId'))
  .patch('/api/workspaces/:workspaceId', (c) =>
    notImplemented(c, 'PATCH /api/workspaces/:workspaceId'),
  )
  .get('/api/workspaces/:workspaceId/sites', (c) =>
    notImplemented(c, 'GET /api/workspaces/:workspaceId/sites'),
  )
  .post('/api/workspaces/:workspaceId/sites', (c) =>
    notImplemented(c, 'POST /api/workspaces/:workspaceId/sites'),
  );
