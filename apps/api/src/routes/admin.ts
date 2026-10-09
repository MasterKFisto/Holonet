import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/**
 * Admin routes — skeleton only. Each route is guarded individually by
 * requireAdmin (placeholder until the auth phase); a group-level `use('*')`
 * would intercept unmatched paths before the app's 404 handler.
 */
export const adminRoutes = new Hono<AppEnv>()
  .get('/api/admin/workspaces', requireAdmin, (c) => notImplemented(c, 'GET /api/admin/workspaces'))
  .patch('/api/admin/workspaces/:workspaceId/status', requireAdmin, (c) =>
    notImplemented(c, 'PATCH /api/admin/workspaces/:workspaceId/status'),
  )
  .get('/api/admin/security-events', requireAdmin, (c) =>
    notImplemented(c, 'GET /api/admin/security-events'),
  )
  .get('/api/admin/audit-logs', requireAdmin, (c) =>
    notImplemented(c, 'GET /api/admin/audit-logs'),
  );
