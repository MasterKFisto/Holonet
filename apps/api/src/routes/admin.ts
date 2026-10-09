import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import { requireAdmin, requireUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/**
 * Admin routes — skeleton only. Each route is guarded by requireUser +
 * requireAdmin; handlers exist for the final structure.
 */
export const adminRoutes = new Hono<AppEnv>()
  .get('/api/admin/workspaces', requireUser, requireAdmin, (c) =>
    notImplemented(c, 'GET /api/admin/workspaces'),
  )
  .patch('/api/admin/workspaces/:workspaceId/status', requireUser, requireAdmin, (c) =>
    notImplemented(c, 'PATCH /api/admin/workspaces/:workspaceId/status'),
  )
  .get('/api/admin/security-events', requireUser, requireAdmin, (c) =>
    notImplemented(c, 'GET /api/admin/security-events'),
  )
  .get('/api/admin/audit-logs', requireUser, requireAdmin, (c) =>
    notImplemented(c, 'GET /api/admin/audit-logs'),
  );
