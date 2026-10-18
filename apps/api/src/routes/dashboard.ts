import { Hono, type Context } from 'hono';
import {
  defaultDashboardManifestPath,
  renderDashboardShell,
  renderMaintenancePage,
  resolveDashboardManifest,
} from '../lib/dashboard-shell.js';
import type { AppEnv } from '../types.js';

/**
 * GET / — the production dashboard entrypoint.
 *
 * Returns a minimal HTML shell that loads the dashboard entry CSS and JS
 * from the OSS public bucket. The asset manifest is resolved through two
 * paths (see lib/dashboard-shell.ts):
 *  1. a file baked into the function artifact
 *     (DASHBOARD_ASSET_MANIFEST_PATH, default ./dashboard-assets.json);
 *  2. the OSS public bucket key app/dashboard-assets.json, cached 5 minutes.
 * When both fail, a 503 maintenance page is served — never a stack trace.
 */
const dashboardShellHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const env = c.get('env');

  const configuredPath = env.DASHBOARD_ASSET_MANIFEST_PATH ?? './dashboard-assets.json';
  const repoDefault = defaultDashboardManifestPath();
  const manifestPaths =
    configuredPath === repoDefault ? [configuredPath] : [configuredPath, repoDefault];

  const manifest = await resolveDashboardManifest({
    manifestPaths,
    storage: c.get('storage'),
  });
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  const ossBaseUrl = env.OSS_PUBLIC_BASE_URL ?? '';

  if (!manifest) {
    c.header('Cache-Control', 'no-store');
    return c.html(renderMaintenancePage(), 503);
  }

  const html = renderDashboardShell({ publicBaseUrl, ossBaseUrl, manifest });

  // Override the API-wide CSP: the dashboard must load scripts and styles
  // from the OSS origin and call back to the platform origin.
  if (ossBaseUrl) {
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' ${ossBaseUrl}; style-src 'self' 'unsafe-inline' ${ossBaseUrl}; img-src 'self' data: ${ossBaseUrl}; connect-src 'self' ${publicBaseUrl}; frame-ancestors 'none'`,
    );
  }

  return c.html(html);
};

export const dashboardShellRoutes = new Hono<AppEnv>().get('/', dashboardShellHandler);
