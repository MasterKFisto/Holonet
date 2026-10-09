import { Hono, type Context } from 'hono';
import { and, eq, max, ne } from 'drizzle-orm';
import { pages } from '@holonet/db';
import { z } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { requirePageAccess, requireSiteAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const pagePath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value.startsWith('/') &&
      value
        .split('/')
        .filter(Boolean)
        .every((segment) => segment !== '.' && segment !== '..'),
    'path must start with / and contain no dot segments',
  );

const createPageSchema = z.object({
  path: pagePath,
  title: z.string().trim().min(1).max(200),
  meta: z.record(z.unknown()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});
const updatePageSchema = z.object({
  path: pagePath.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  meta: z.record(z.unknown()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const listPagesHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const rows = await db.query.pages.findMany({
    where: eq(pages.siteId, c.get('siteId')!),
    orderBy: (pages, { asc }) => [asc(pages.sortOrder), asc(pages.createdAt)],
  });
  return c.json({ pages: rows });
};

const createPageHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = createPageSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  const existing = await db.query.pages.findFirst({
    where: and(eq(pages.siteId, siteId), eq(pages.path, body.path)),
  });
  if (existing) {
    throw new AppError('CONFLICT', 'page path already exists in this site', 409);
  }

  // Page ordering: append after the current maximum.
  const [maxRow] = await db
    .select({ max: max(pages.sortOrder) })
    .from(pages)
    .where(eq(pages.siteId, siteId));
  const sortOrder = (maxRow?.max ?? 0) + 1;

  const [page] = await db
    .insert(pages)
    .values({
      siteId,
      path: body.path,
      title: body.title,
      meta: body.meta ?? {},
      status: body.status ?? 'draft',
      sortOrder,
    })
    .returning();
  if (!page) {
    throw new AppError('INTERNAL_ERROR', 'failed to create page', 500);
  }

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'page_created',
    targetType: 'page',
    targetId: page.id,
    metadata: { siteId },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ page }, 201);
};

const updatePageHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = updatePageSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const pageId = c.get('pageId')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  if (body.path) {
    const conflict = await db.query.pages.findFirst({
      where: and(eq(pages.siteId, siteId), eq(pages.path, body.path), ne(pages.id, pageId)),
    });
    if (conflict) {
      throw new AppError('CONFLICT', 'page path already exists in this site', 409);
    }
  }

  const [page] = await db
    .update(pages)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(pages.id, pageId))
    .returning();

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'page_updated',
    targetType: 'page',
    targetId: pageId,
    metadata: { siteId },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ page });
};

const deletePageHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const pageId = c.get('pageId')!;
  const workspaceId = c.get('workspaceId')!;

  // Blocks cascade.
  await db.delete(pages).where(eq(pages.id, pageId));
  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'page_deleted',
    targetType: 'page',
    targetId: pageId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ ok: true });
};

export const pageRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId/pages', requireUser, requireSiteAccess(), listPagesHandler)
  .post('/api/sites/:siteId/pages', requireUser, requireSiteAccess(), createPageHandler)
  .patch('/api/pages/:pageId', requireUser, requirePageAccess(), updatePageHandler)
  .delete('/api/pages/:pageId', requireUser, requirePageAccess(), deletePageHandler);
