import { Hono } from 'hono';
import { notImplemented } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/**
 * Authentication routes — skeleton only.
 * register/login/logout/forgot-password/reset-password return structured
 * NOT_IMPLEMENTED responses; /api/me is guarded by requireUser (placeholder).
 */
export const authRoutes = new Hono<AppEnv>()
  .post('/api/auth/register', (c) => notImplemented(c, 'POST /api/auth/register'))
  .post('/api/auth/login', (c) => notImplemented(c, 'POST /api/auth/login'))
  .post('/api/auth/logout', (c) => notImplemented(c, 'POST /api/auth/logout'))
  .post('/api/auth/forgot-password', (c) => notImplemented(c, 'POST /api/auth/forgot-password'))
  .post('/api/auth/reset-password', (c) => notImplemented(c, 'POST /api/auth/reset-password'))
  .get('/api/me', requireUser, (c) => c.json({ user: c.get('user') }));
