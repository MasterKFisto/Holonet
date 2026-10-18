import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StorageProvider, StorageObject } from '@holonet/storage';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { clearDashboardManifestCache } from './lib/dashboard-shell.js';

const OSS_BASE = 'https://holonet-section-zero-public.oss-cn-hangzhou.aliyuncs.com';
const PUBLIC_BASE = 'https://holonet.section-zero.link';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'holonet-dashboard-shell-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(): string {
  const path = join(dir, 'dashboard-assets.json');
  writeFileSync(
    path,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      bucket: 'holonet-section-zero-public',
      publicBaseUrl: OSS_BASE,
      prefix: 'app',
      entryCss: ['assets/index-AbC123.css'],
      entryJs: ['assets/index-DeF456.js'],
      files: [],
    }),
  );
  return path;
}

function shellEnv(manifestPath: string) {
  return loadEnv({
    ...process.env,
    PUBLIC_BASE_URL: PUBLIC_BASE,
    OSS_PUBLIC_BASE_URL: OSS_BASE,
    DASHBOARD_ASSET_MANIFEST_PATH: manifestPath,
  });
}

/** Mock public-bucket storage serving a manifest object (or failing). */
function mockStorage(manifest: Record<string, unknown> | null): StorageProvider {
  const object: StorageObject | null = manifest
    ? {
        key: 'app/dashboard-assets.json',
        body: Buffer.from(JSON.stringify(manifest)),
        contentType: 'application/json',
      }
    : null;
  return {
    kind: 'fs',
    bucket: 'public',
    putObject: async () => {},
    getObject: async (key) => (key === 'app/dashboard-assets.json' ? object : null),
    deleteObject: async () => {},
    listObjects: async () => [],
    getPublicUrl: (key) => `http://fake-storage/${key}`,
    getSignedUrl: async (key) => `http://fake-storage/${key}`,
  };
}

const fallbackManifest = {
  entryCss: ['assets/fallback.css'],
  entryJs: ['assets/fallback.js'],
};

describe('holonet-api dashboard HTML shell (GET /)', () => {
  it('loads the dashboard entry CSS and JS from OSS', async () => {
    const app = createApp(shellEnv(writeManifest()));
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    // PUBLIC_BASE_URL anchors the shell.
    expect(html).toContain(`<base href="${PUBLIC_BASE}/" />`);
    // Asset URLs use OSS_PUBLIC_BASE_URL under app/.
    expect(html).toContain(`${OSS_BASE}/app/assets/index-AbC123.css`);
    expect(html).toContain(`${OSS_BASE}/app/assets/index-DeF456.js`);
    expect(html).toContain('<div id="root"></div>');
  });

  it('falls back to the OSS manifest when the file is absent', async () => {
    clearDashboardManifestCache();
    const app = createApp(
      shellEnv(join(dir, 'missing.json')),
      undefined,
      mockStorage(fallbackManifest),
    );
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain(`${OSS_BASE}/app/assets/fallback.css`);
    expect(html).toContain(`${OSS_BASE}/app/assets/fallback.js`);
  });

  it('caches the storage-fetched manifest (5-minute TTL)', async () => {
    clearDashboardManifestCache();
    const storage = mockStorage(fallbackManifest);
    const app = createApp(shellEnv(join(dir, 'missing.json')), undefined, storage);

    const first = await app.request('/');
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('assets/fallback.js');

    // The OSS copy disappears — the in-memory cache still serves the shell.
    const storage2 = mockStorage(null);
    const app2 = createApp(shellEnv(join(dir, 'missing.json')), undefined, storage2);
    const second = await app2.request('/');
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('assets/fallback.js');

    // After clearing the cache the storage miss is real.
    clearDashboardManifestCache();
    const third = await app2.request('/');
    expect(third.status).toBe(503);
  });

  it('returns a clear 503 page when both manifest sources fail', async () => {
    clearDashboardManifestCache();
    const app = createApp(shellEnv(join(dir, 'missing.json')), undefined, mockStorage(null));
    const res = await app.request('/');
    expect(res.status).toBe(503);

    const html = await res.text();
    expect(html).toContain('Holonet is being deployed. Dashboard assets are not yet available.');
    // Never a stack trace.
    expect(html).not.toContain('Error');
    expect(html).not.toContain('at ');
  });
});
