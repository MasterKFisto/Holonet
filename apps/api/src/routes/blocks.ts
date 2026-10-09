import { Hono, type Context } from 'hono';
import { eq, max } from 'drizzle-orm';
import { blocks } from '@holonet/db';
import { validateBlock } from '@holonet/core';
import { z } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { requireBlockAccess, requirePageAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const createBlockSchema = z.object({
  type: z.string().trim().min(1).max(64),
  props: z.record(z.unknown()).default({}),
  sortOrder: z.number().int().min(0).optional(),
});
const updateBlockSchema = z.object({
  type: z.string().trim().min(1).max(64).optional(),
  props: z.record(z.unknown()).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const listBlocksHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const rows = await db.query.blocks.findMany({
    where: eq(blocks.pageId, c.get('pageId')!),
    orderBy: (blocks, { asc }) => [asc(blocks.sortOrder), asc(blocks.createdAt)],
  });
  return c.json({ blocks: rows });
};

const createBlockHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = createBlockSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const pageId = c.get('pageId')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  // Props are validated against the block type schema (rule 17: untrusted).
  const props = body.props ?? {};
  const validation = validateBlock(body.type, props);
  if (!validation.ok) {
    throw new AppError('VALIDATION_ERROR', 'invalid block props', 400, validation.issues);
  }

  // Block ordering: append after the current maximum.
  const [maxRow] = await db
    .select({ max: max(blocks.sortOrder) })
    .from(blocks)
    .where(eq(blocks.pageId, pageId));
  const sortOrder = body.sortOrder ?? (maxRow?.max ?? 0) + 1;

  const [block] = await db
    .insert(blocks)
    .values({ pageId, siteId, type: validation.type, props: validation.props, sortOrder })
    .returning();
  if (!block) {
    throw new AppError('INTERNAL_ERROR', 'failed to create block', 500);
  }

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'block_created',
    targetType: 'block',
    targetId: block.id,
    metadata: { pageId, siteId, type: block.type },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ block }, 201);
};

const updateBlockHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = updateBlockSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const blockId = c.get('blockId')!;
  const pageId = c.get('pageId')!;
  const workspaceId = c.get('workspaceId')!;

  const current = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!current) {
    throw new AppError('NOT_FOUND', 'block not found', 404);
  }

  let type = current.type;
  let props = current.props;
  if (body.type !== undefined || body.props !== undefined) {
    type = body.type ?? current.type;
    props = body.props ?? current.props;
    const validation = validateBlock(type, props);
    if (!validation.ok) {
      throw new AppError('VALIDATION_ERROR', 'invalid block props', 400, validation.issues);
    }
    type = validation.type;
    props = validation.props;
  }

  const [block] = await db
    .update(blocks)
    .set({ type, props, sortOrder: body.sortOrder, updatedAt: new Date() })
    .where(eq(blocks.id, blockId))
    .returning();

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'block_updated',
    targetType: 'block',
    targetId: blockId,
    metadata: { pageId, type: block?.type },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ block });
};

const deleteBlockHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const blockId = c.get('blockId')!;
  const workspaceId = c.get('workspaceId')!;

  await db.delete(blocks).where(eq(blocks.id, blockId));
  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'block_deleted',
    targetType: 'block',
    targetId: blockId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ ok: true });
};

export const blockRoutes = new Hono<AppEnv>()
  .get('/api/pages/:pageId/blocks', requireUser, requirePageAccess(), listBlocksHandler)
  .post('/api/pages/:pageId/blocks', requireUser, requirePageAccess(), createBlockHandler)
  .patch('/api/blocks/:blockId', requireUser, requireBlockAccess(), updateBlockHandler)
  .delete('/api/blocks/:blockId', requireUser, requireBlockAccess(), deleteBlockHandler);
