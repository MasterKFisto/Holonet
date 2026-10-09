import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dashboard HTML shell (GET /).
 *
 * In production the Function Compute app returns a minimal HTML shell that
 * loads the dashboard entry CSS and JS from the OSS public bucket
 * (OSS_PUBLIC_BASE_URL). The asset list comes from the manifest produced by
 * infra/scripts/upload-dashboard-assets.mjs.
 */

export interface DashboardManifest {
  generatedAt?: string;
  bucket?: string;
  publicBaseUrl?: string;
  prefix?: string;
  entryCss: string[];
  entryJs: string[];
  files?: unknown[];
}

/** Default manifest location: <repo>/infra/alibaba/dashboard-assets.json. */
export function defaultDashboardManifestPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../..',
    'infra/alibaba/dashboard-assets.json',
  );
}

export function loadDashboardManifest(path: string): DashboardManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DashboardManifest>;
    if (!Array.isArray(parsed.entryJs) || parsed.entryJs.length === 0) {
      return null;
    }
    return {
      entryCss: Array.isArray(parsed.entryCss) ? parsed.entryCss : [],
      entryJs: parsed.entryJs,
    };
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export interface DashboardShellInput {
  /** PUBLIC_BASE_URL — the fixed platform hostname. */
  publicBaseUrl: string;
  /** OSS_PUBLIC_BASE_URL — origin of the dashboard assets. */
  ossBaseUrl: string;
  manifest: DashboardManifest | null;
}

/** Minimal HTML shell loading the dashboard entry assets from OSS. */
export function renderDashboardShell(input: DashboardShellInput): string {
  const publicBaseUrl = escapeHtml(input.publicBaseUrl.replace(/\/+$/, ''));
  const ossBase = escapeHtml(input.ossBaseUrl.replace(/\/+$/, ''));

  if (!input.manifest) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Holonet Dashboard</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem">
    <h1>Holonet Dashboard</h1>
    <p>The dashboard assets have not been published yet.</p>
    <p>Run <code>pnpm build</code> and
    <code>node infra/scripts/upload-dashboard-assets.mjs</code>, then reload.</p>
    <p>For local development, use the Vite dev server
    (<code>pnpm --filter dashboard dev</code> on http://localhost:5173).</p>
  </body>
</html>
`;
  }

  const css = input.manifest.entryCss
    .map((entry) => `    <link rel="stylesheet" href="${ossBase}/app/${escapeHtml(entry)}" />`)
    .join('\n');
  const js = input.manifest.entryJs
    .map((entry) => `    <script type="module" src="${ossBase}/app/${escapeHtml(entry)}"></script>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Holonet Dashboard</title>
    <base href="${publicBaseUrl}/" />
${css}
  </head>
  <body>
    <div id="root"></div>
${js}
  </body>
</html>
`;
}
