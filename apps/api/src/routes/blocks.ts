import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/** Block routes — skeleton only (implemented in the pages phase). */
export const blockRoutes = new Hono<AppEnv>()
  .get('/api/pages/:pageId/blocks', (c) => notImplemented(c, 'GET /api/pages/:pageId/blocks'))
  .post('/api/pages/:pageId/blocks', (c) => notImplemented(c, 'POST /api/pages/:pageId/blocks'))
  .patch('/api/blocks/:blockId', (c) => notImplemented(c, 'PATCH /api/blocks/:blockId'))
  .delete('/api/blocks/:blockId', (c) => notImplemented(c, 'DELETE /api/blocks/:blockId'));
