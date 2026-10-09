import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import { requireUser, requireWorkspaceAccess } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/**
 * Workspace routes — guarded; handlers are implemented in the workspaces
 * phase. requireUser + requireWorkspaceAccess enforce tenant isolation
 * (rule 18) already at the skeleton level.
 */
export const workspaceRoutes = new Hono<AppEnv>()
  .get('/api/workspaces', requireUser, (c) => notImplemented(c, 'GET /api/workspaces'))
  .post('/api/workspaces', requireUser, (c) => notImplemented(c, 'POST /api/workspaces'))
  .get('/api/workspaces/:workspaceId', requireUser, requireWorkspaceAccess(), (c) =>
    notImplemented(c, 'GET /api/workspaces/:workspaceId'),
  )
  .patch('/api/workspaces/:workspaceId', requireUser, requireWorkspaceAccess(), (c) =>
    notImplemented(c, 'PATCH /api/workspaces/:workspaceId'),
  )
  .get('/api/workspaces/:workspaceId/sites', requireUser, requireWorkspaceAccess(), (c) =>
    notImplemented(c, 'GET /api/workspaces/:workspaceId/sites'),
  )
  .post('/api/workspaces/:workspaceId/sites', requireUser, requireWorkspaceAccess(), (c) =>
    notImplemented(c, 'POST /api/workspaces/:workspaceId/sites'),
  );
