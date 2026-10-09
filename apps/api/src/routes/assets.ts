import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { assets } from '@holonet/db';
import { contentTypeFor, extensionOf, publicAssetKey } from '@holonet/storage';
import { requireDb, requireStorage } from '../lib/db.js';
import { AppError, errorBody } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { requireSiteAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

/**
 * Asset uploads (POST /api/sites/:siteId/assets).
 *
 * Accepts multipart uploads (field 'file'). Allowed file types:
 * jpg, jpeg, png, webp, svg, css, json. Max size: 5 MB.
 * Files land in the public bucket under
 * media/public/{workspaceId}/assets/{assetId}.{ext} (docs/infrastructure.md)
 * and are recorded in the assets table with a workspace-scoped audit entry.
 */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg', 'css', 'json']);
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function assetKindOf(ext: string): 'image' | 'css' | 'file' {
  if (ext === 'css') {
    return 'css';
  }
  if (ext === 'json') {
    return 'file';
  }
  return 'image';
}

const uploadAssetHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const user = c.get('user')!;
  const workspaceId = c.get('workspaceId')!;
  const siteId = c.get('siteId')!;
  const db = requireDb(c);
  const storage = requireStorage(c);

  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', "multipart field 'file' is required", 400);
  }

  const fileName = file.name || 'upload';
  const ext = extensionOf(fileName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `file type not allowed: .${ext || '(none)'} (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')})`,
      400,
    );
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw new AppError('VALIDATION_ERROR', 'file too large (max 5 MB)', 400);
  }

  const body = Buffer.from(await file.arrayBuffer());
  const assetId = randomUUID();
  const key = publicAssetKey(workspaceId, assetId, fileName);
  const contentType = contentTypeFor(fileName) ?? 'application/octet-stream';
  const cacheControl = ext === 'json' ? 'no-cache' : IMMUTABLE_CACHE_CONTROL;

  await storage.putObject(key, body, { contentType, cacheControl });

  const [asset] = await db
    .insert(assets)
    .values({
      id: assetId,
      workspaceId,
      siteId,
      kind: assetKindOf(ext),
      storageKey: key,
      originalName: fileName,
      contentType,
      sizeBytes: body.length,
    })
    .returning();
  if (!asset) {
    throw new AppError('INTERNAL_ERROR', 'failed to record asset', 500);
  }

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'asset_uploaded',
    targetType: 'asset',
    targetId: asset.id,
    metadata: { siteId, storageKey: key, contentType, sizeBytes: body.length },
    ipHash: ipHashOf(clientIp(c)),
  });

  return c.json({ asset: { ...asset, url: storage.getPublicUrl(key) } }, 201);
};

/**
 * Development-only static serving for the fs provider. In production the
 * public bucket is served by OSS/CDN directly, so this route 404s when the
 * provider is OSS.
 */
const serveLocalObjectHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const storage = requireStorage(c);
  const bucket = c.req.param('bucket');
  const key = c.req.param('key');
  if (!key) {
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  if (bucket !== 'public' || storage.kind !== 'fs') {
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  const object = await storage.getObject(key);
  if (!object) {
    return c.json(errorBody({ code: 'NOT_FOUND', message: 'not found' }, c.get('requestId')), 404);
  }
  return new Response(object.body, {
    headers: {
      'Content-Type': object.contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

export const assetRoutes = new Hono<AppEnv>()
  .post('/api/sites/:siteId/assets', requireUser, requireSiteAccess(), uploadAssetHandler)
  .get('/storage/:bucket/:key{.+}', serveLocalObjectHandler);
