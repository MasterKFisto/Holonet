import { Hono, type Context } from 'hono';
import { desc } from 'drizzle-orm';
import { importJobs } from '@holonet/db';
import { requireDb } from '../lib/db.js';
import { notImplemented } from '../lib/errors.js';
import { requireAdmin, requireUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/** Lists recent website import jobs across all workspaces (admin view). */
async function listImportJobsHandler(c: Context<AppEnv>): Promise<Response> {
  const db = requireDb(c);
  const rows = await db.query.importJobs.findMany({
    orderBy: [desc(importJobs.createdAt)],
    limit: 100,
  });
  return c.json({ importJobs: rows });
}

/**
 * Admin routes — mostly skeleton. Each route is guarded by requireUser +
 * requireAdmin; handlers exist for the final structure. Import jobs are
 * implemented (import phase).
 */
export const adminRoutes = new Hono<AppEnv>()
  .get('/api/admin/import-jobs', requireUser, requireAdmin, listImportJobsHandler)
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
