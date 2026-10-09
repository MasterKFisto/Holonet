import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { deployments, jobs, sites, templates, templateVersions } from '@holonet/db';
import { z } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { requireSiteAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  settings: z.record(z.unknown()).optional(),
  templateVersionId: z.string().uuid().nullable().optional(),
});

const getSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const site = await db.query.sites.findFirst({ where: eq(sites.id, c.get('siteId')!) });
  if (!site) {
    throw new AppError('NOT_FOUND', 'site not found', 404);
  }
  return c.json({ site });
};

const updateSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = updateSiteSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  const current = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!current) {
    throw new AppError('NOT_FOUND', 'site not found', 404);
  }

  if (body.slug) {
    const conflict = await db.query.sites.findFirst({
      where: and(eq(sites.workspaceId, workspaceId), eq(sites.slug, body.slug)),
    });
    if (conflict && conflict.id !== siteId) {
      throw new AppError('CONFLICT', 'site slug already taken in this workspace', 409);
    }
  }
  if (body.templateVersionId) {
    const version = await db.query.templateVersions.findFirst({
      where: eq(templateVersions.id, body.templateVersionId),
    });
    const template = version
      ? await db.query.templates.findFirst({ where: eq(templates.id, version.templateId) })
      : undefined;
    if (!version || !template || template.workspaceId !== workspaceId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'templateVersionId does not belong to this workspace',
        400,
      );
    }
  }

  // Status transitions maintain publishedAt (draft/published support).
  let publishedAt: Date | null | undefined;
  if (body.status !== undefined && body.status !== current.status) {
    publishedAt = body.status === 'published' ? new Date() : null;
  }

  const [site] = await db
    .update(sites)
    .set({ ...body, publishedAt, updatedAt: new Date() })
    .where(eq(sites.id, siteId))
    .returning();

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_updated',
    targetType: 'site',
    targetId: siteId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ site });
};

const deleteSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  // Hard delete; pages/blocks/deployments cascade.
  await db.delete(sites).where(eq(sites.id, siteId));
  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_deleted',
    targetType: 'site',
    targetId: siteId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ ok: true });
};

const publishSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  const deploymentId = randomUUID();
  const [deployment] = await db
    .insert(deployments)
    .values({
      id: deploymentId,
      siteId,
      workspaceId,
      status: 'queued',
      storagePrefix: `${workspaceId}/${siteId}/${deploymentId}`,
    })
    .returning();

  // The builder worker (apps/builder) consumes this job in a later phase.
  await db.insert(jobs).values({
    workspaceId,
    type: 'site_build',
    status: 'pending',
    payload: { siteId, deploymentId },
  });

  await db
    .update(sites)
    .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_published',
    targetType: 'deployment',
    targetId: deploymentId,
    metadata: { siteId },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ deployment }, 202);
};

const rollbackSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;
  const deploymentId = c.req.param('deploymentId');
  if (!deploymentId) {
    throw new AppError('NOT_FOUND', 'deployment not found', 404);
  }

  const target = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.siteId, siteId)),
  });
  if (!target) {
    throw new AppError('NOT_FOUND', 'deployment not found', 404);
  }

  const newId = randomUUID();
  const [deployment] = await db
    .insert(deployments)
    .values({
      id: newId,
      siteId,
      workspaceId,
      status: 'queued',
      storagePrefix: target.storagePrefix,
      note: `rollback to ${deploymentId}`,
    })
    .returning();

  await db.insert(jobs).values({
    workspaceId,
    type: 'site_build',
    status: 'pending',
    payload: { siteId, deploymentId: newId, rollbackTo: deploymentId },
  });

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_rollback',
    targetType: 'deployment',
    targetId: newId,
    metadata: { siteId, rollbackTo: deploymentId },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ deployment }, 202);
};

const listDeploymentsHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const rows = await db.query.deployments.findMany({
    where: eq(deployments.siteId, c.get('siteId')!),
    orderBy: [desc(deployments.createdAt)],
  });
  return c.json({ deployments: rows });
};

export const siteRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId', requireUser, requireSiteAccess(), getSiteHandler)
  .patch('/api/sites/:siteId', requireUser, requireSiteAccess(), updateSiteHandler)
  .delete('/api/sites/:siteId', requireUser, requireSiteAccess(), deleteSiteHandler)
  .post('/api/sites/:siteId/publish', requireUser, requireSiteAccess(), publishSiteHandler)
  .post(
    '/api/sites/:siteId/rollback/:deploymentId',
    requireUser,
    requireSiteAccess(),
    rollbackSiteHandler,
  )
  .get('/api/sites/:siteId/deployments', requireUser, requireSiteAccess(), listDeploymentsHandler);
