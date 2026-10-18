import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageProvider } from '@holonet/storage';

/**
 * Dashboard HTML shell (GET /).
 *
 * In production the Function Compute app returns a minimal HTML shell that
 * loads the dashboard entry CSS and JS from the OSS public bucket
 * (OSS_PUBLIC_BASE_URL). The asset list comes from the manifest produced by
 * infra/scripts/upload-dashboard-assets.mjs, delivered through two paths:
 *
 *  1. Primary — a file baked into the function artifact by package-api.sh,
 *     read from DASHBOARD_ASSET_MANIFEST_PATH (default ./dashboard-assets.json).
 *  2. Fallback — fetched from the OSS public bucket key
 *     app/dashboard-assets.json (upload-dashboard-assets.mjs publishes the
 *     manifest alongside the assets), cached in memory for 5 minutes.
 *
 * When both sources fail, GET / returns a 503 maintenance page — never a
 * stack trace.
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

/** OSS public bucket key of the published manifest (fallback source). */
export const MANIFEST_STORAGE_KEY = 'app/dashboard-assets.json';

/** How long the storage-fetched manifest is cached in memory. */
export const MANIFEST_CACHE_TTL_MS = 5 * 60_000;

/**
 * Default manifest location: <repo>/infra/alibaba/dashboard-assets.json.
 *
 * Development-only fallback — production reads the baked ./dashboard-assets.json
 * (or the OSS copy). Under tsx/ESM the module dir locates the repo root; in the
 * CommonJS bundle (esbuild, import.meta is an empty shim) the repo root is
 * assumed to be process.cwd() and misses harmlessly on Function Compute.
 */
export function defaultDashboardManifestPath(): string {
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../..',
      'infra/alibaba/dashboard-assets.json',
    );
  }
  return resolve(process.cwd(), 'infra/alibaba/dashboard-assets.json');
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

/** In-memory cache for the storage-fetched manifest (TTL-bounded). */
let cachedManifest: { fetchedAt: number; manifest: DashboardManifest } | null = null;

/** Test hook: clears the manifest cache. */
export function clearDashboardManifestCache(): void {
  cachedManifest = null;
}

function manifestFromObject(parsed: Partial<DashboardManifest>): DashboardManifest | null {
  if (!Array.isArray(parsed.entryJs) || parsed.entryJs.length === 0) {
    return null;
  }
  return {
    entryCss: Array.isArray(parsed.entryCss) ? parsed.entryCss : [],
    entryJs: parsed.entryJs,
  };
}

export interface ManifestResolutionOptions {
  /** File paths to try in order (DASHBOARD_ASSET_MANIFEST_PATH first). */
  manifestPaths: string[];
  /** Public-bucket storage provider for the OSS fallback. */
  storage?: Pick<StorageProvider, 'getObject'> | null;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Resolves the dashboard asset manifest:
 *  - file sources (manifestPaths) in order;
 *  - then the OSS public bucket fallback, cached for 5 minutes;
 *  - null when everything fails (the caller renders the 503 page).
 */
export async function resolveDashboardManifest(
  options: ManifestResolutionOptions,
): Promise<DashboardManifest | null> {
  for (const path of options.manifestPaths) {
    const local = loadDashboardManifest(path);
    if (local) {
      return local;
    }
  }

  const now = options.now ?? Date.now();
  if (cachedManifest && now - cachedManifest.fetchedAt < MANIFEST_CACHE_TTL_MS) {
    return cachedManifest.manifest;
  }

  if (options.storage) {
    try {
      const object = await options.storage.getObject(MANIFEST_STORAGE_KEY);
      if (object) {
        const manifest = manifestFromObject(
          JSON.parse(object.body.toString('utf8')) as Partial<DashboardManifest>,
        );
        if (manifest) {
          cachedManifest = { fetchedAt: now, manifest };
          return manifest;
        }
      }
    } catch {
      // Storage unavailable — fall through to the 503 page.
    }
  }

  return null;
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

/** 503 page when neither manifest source is available (no stack traces). */
export function renderMaintenancePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Holonet — deploying</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem">
    <h1>Holonet is being deployed. Dashboard assets are not yet available.</h1>
    <p>Please retry in a minute.</p>
  </body>
</html>
`;
}

/** Minimal HTML shell loading the dashboard entry assets from OSS. */
export function renderDashboardShell(input: DashboardShellInput): string {
  const publicBaseUrl = escapeHtml(input.publicBaseUrl.replace(/\/+$/, ''));
  const ossBase = escapeHtml(input.ossBaseUrl.replace(/\/+$/, ''));

  if (!input.manifest) {
    return renderMaintenancePage();
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
