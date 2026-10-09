import { Hono, type Context } from 'hono';
import {
  defaultDashboardManifestPath,
  loadDashboardManifest,
  renderDashboardShell,
} from '../lib/dashboard-shell.js';
import type { AppEnv } from '../types.js';

/**
 * GET / — the production dashboard entrypoint.
 *
 * Returns a minimal HTML shell that loads the dashboard entry CSS and JS
 * from the OSS public bucket. Asset references come from the manifest
 * written by infra/scripts/upload-dashboard-assets.mjs
 * (DASHBOARD_ASSET_MANIFEST_PATH), asset URLs use OSS_PUBLIC_BASE_URL, and
 * the shell is anchored to PUBLIC_BASE_URL (https://holonet.section-zero.link).
 */
const dashboardShellHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const env = c.get('env');

  const manifestPath = env.DASHBOARD_ASSET_MANIFEST_PATH ?? defaultDashboardManifestPath();
  const manifest = loadDashboardManifest(manifestPath);
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  const ossBaseUrl = env.OSS_PUBLIC_BASE_URL ?? '';

  const html = renderDashboardShell({ publicBaseUrl, ossBaseUrl, manifest });

  // Override the API-wide CSP: the dashboard must load scripts and styles
  // from the OSS origin and call back to the platform origin.
  if (manifest && ossBaseUrl) {
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' ${ossBaseUrl}; style-src 'self' 'unsafe-inline' ${ossBaseUrl}; img-src 'self' data: ${ossBaseUrl}; connect-src 'self' ${publicBaseUrl}; frame-ancestors 'none'`,
    );
  }

  return c.html(html);
};

export const dashboardShellRoutes = new Hono<AppEnv>().get('/', dashboardShellHandler);
