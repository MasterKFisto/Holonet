import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

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

  it('falls back to a development notice without a manifest', async () => {
    const app = createApp(shellEnv(join(dir, 'missing.json')));
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('not been published yet');
    expect(html).not.toContain(`${OSS_BASE}/app/`);
  });
});
