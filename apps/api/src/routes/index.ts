import type { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { adminRoutes } from './admin.js';
import { assetRoutes } from './assets.js';
import { authRoutes } from './auth.js';
import { blockRoutes } from './blocks.js';
import { dashboardShellRoutes } from './dashboard.js';
import { formRoutes } from './forms.js';
import { healthRoutes } from './health.js';
import { pageRoutes } from './pages.js';
import { siteRoutes } from './sites.js';
import { workspaceRoutes } from './workspaces.js';

/** Mounts every route group onto the app. */
export function mountRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.route('/', dashboardShellRoutes);
  app.route('/', healthRoutes);
  app.route('/', authRoutes);
  app.route('/', workspaceRoutes);
  app.route('/', siteRoutes);
  app.route('/', pageRoutes);
  app.route('/', blockRoutes);
  app.route('/', assetRoutes);
  app.route('/', formRoutes);
  app.route('/', adminRoutes);
  return app;
}
