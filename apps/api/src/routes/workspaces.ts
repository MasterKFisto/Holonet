import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { sites, templates, templateVersions, workspaceMembers, workspaces } from '@holonet/db';
import { z } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { slugify } from '../lib/slugs.js';
import { requireUser, requireWorkspaceAccess } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: z.record(z.unknown()).optional(),
});
const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  templateVersionId: z.string().uuid().optional(),
});

const listWorkspacesHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, user.id),
        eq(workspaceMembers.status, 'active'),
        eq(workspaces.status, 'active'),
      ),
    );
  return c.json({ workspaces: rows.map((row) => ({ ...row.workspace, role: row.role })) });
};

const createWorkspaceHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = createWorkspaceSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const slug = body.slug ?? slugify(body.name);

  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
  if (existing) {
    throw new AppError('CONFLICT', 'workspace slug already taken', 409);
  }

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id, name: body.name, slug });
    await tx.insert(workspaceMembers).values({ workspaceId: id, userId: user.id, role: 'owner' });
  });

  await recordAuditLog(db, {
    workspaceId: id,
    actorUserId: user.id,
    action: 'workspace_created',
    targetType: 'workspace',
    targetId: id,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json(
    { workspace: { id, name: body.name, slug, status: 'active' as const, settings: {} } },
    201,
  );
};

const getWorkspaceHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, c.get('workspaceId')!),
  });
  if (!workspace) {
    throw new AppError('NOT_FOUND', 'workspace not found', 404);
  }
  return c.json({ workspace });
};

const updateWorkspaceHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = updateWorkspaceSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const workspaceId = c.get('workspaceId')!;

  const [workspace] = await db
    .update(workspaces)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'workspace_updated',
    targetType: 'workspace',
    targetId: workspaceId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ workspace });
};

const listSitesHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const rows = await db.query.sites.findMany({
    where: eq(sites.workspaceId, c.get('workspaceId')!),
    orderBy: (sites, { asc }) => [asc(sites.createdAt)],
  });
  return c.json({ sites: rows });
};

const createSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = createSiteSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const workspaceId = c.get('workspaceId')!;

  const templateVersionId = body.templateVersionId;
  if (templateVersionId) {
    const version = await db.query.templateVersions.findFirst({
      where: eq(templateVersions.id, templateVersionId),
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

  const slug = body.slug ?? slugify(body.name);
  const existing = await db.query.sites.findFirst({
    where: and(eq(sites.workspaceId, workspaceId), eq(sites.slug, slug)),
  });
  if (existing) {
    throw new AppError('CONFLICT', 'site slug already taken in this workspace', 409);
  }

  const [site] = await db
    .insert(sites)
    .values({ workspaceId, name: body.name, slug, status: 'draft', templateVersionId })
    .returning();
  if (!site) {
    throw new AppError('INTERNAL_ERROR', 'failed to create site', 500);
  }

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_created',
    targetType: 'site',
    targetId: site.id,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ site }, 201);
};

export const workspaceRoutes = new Hono<AppEnv>()
  .get('/api/workspaces', requireUser, listWorkspacesHandler)
  .post('/api/workspaces', requireUser, createWorkspaceHandler)
  .get('/api/workspaces/:workspaceId', requireUser, requireWorkspaceAccess(), getWorkspaceHandler)
  .patch(
    '/api/workspaces/:workspaceId',
    requireUser,
    requireWorkspaceAccess(),
    updateWorkspaceHandler,
  )
  .get(
    '/api/workspaces/:workspaceId/sites',
    requireUser,
    requireWorkspaceAccess(),
    listSitesHandler,
  )
  .post(
    '/api/workspaces/:workspaceId/sites',
    requireUser,
    requireWorkspaceAccess(),
    createSiteHandler,
  );
