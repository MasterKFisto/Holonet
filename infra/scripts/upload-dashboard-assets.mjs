#!/usr/bin/env node
/**
 * Production dashboard asset publisher.
 *
 * Builds apps/dashboard when needed, uploads the production build to the OSS
 * public bucket under app/, and writes an asset manifest consumed by the
 * API's GET / HTML shell (DASHBOARD_ASSET_MANIFEST_PATH).
 *
 * Usage:
 *   node infra/scripts/upload-dashboard-assets.mjs [--build]
 *
 * Environment (never committed — docs/PROJECT_RULES.md rule 10):
 *   OSS_REGION (or ALIBABA_CLOUD_REGION), OSS_PUBLIC_BUCKET,
 *   OSS_PUBLIC_BASE_URL, OSS_ENDPOINT (optional),
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET (deployment RAM user;
 *   on CI/managed runners the RAM role supplies credentials instead).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = join(ROOT_DIR, 'apps/dashboard/dist');
const MANIFEST_PATH = join(ROOT_DIR, 'infra/alibaba/dashboard-assets.json');
const PREFIX = 'app';

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const CACHE_HTML = 'no-cache';
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function extractEntries(indexHtml, pattern) {
  const entries = [];
  for (const match of indexHtml.matchAll(pattern)) {
    const src = match[1];
    if (src) {
      entries.push(src.replace(/^\.\//, ''));
    }
  }
  return entries;
}

async function main() {
  const rebuild = process.argv.includes('--build');
  if (rebuild || !existsSync(join(DIST_DIR, 'index.html'))) {
    console.log('[dashboard-assets] building apps/dashboard …');
    execSync('pnpm --filter dashboard build', { cwd: ROOT_DIR, stdio: 'inherit' });
  }

  const region = process.env.OSS_REGION ?? process.env.ALIBABA_CLOUD_REGION;
  const bucket = process.env.OSS_PUBLIC_BUCKET;
  const publicBaseUrl = process.env.OSS_PUBLIC_BASE_URL;
  if (!region || !bucket) {
    console.error(
      '[dashboard-assets] OSS_REGION (or ALIBABA_CLOUD_REGION) and OSS_PUBLIC_BUCKET are required.',
    );
    process.exit(1);
  }

  const client = new OSS({
    region,
    bucket,
    endpoint: process.env.OSS_ENDPOINT || undefined,
    secure: true,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
  });

  const indexHtml = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
  const entryJs = extractEntries(indexHtml, /<script[^>]+src="\.?\/?([^"]+\.js)"/g);
  const entryCss = extractEntries(
    indexHtml,
    /<link[^>]+rel="stylesheet"[^>]+href="\.?\/?([^"]+\.css)"/g,
  );

  const files = walkFiles(DIST_DIR);
  const uploaded = [];

  for (const file of files) {
    const relative = file.slice(DIST_DIR.length + 1);
    const key = `${PREFIX}/${relative}`;
    const ext = extname(file).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const cacheControl = ext === '.html' ? CACHE_HTML : CACHE_IMMUTABLE;
    const body = readFileSync(file);

    await client.put(key, body, {
      mime: contentType,
      headers: { 'Cache-Control': cacheControl },
    });
    uploaded.push({
      key,
      contentType,
      cacheControl,
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    });
    console.log(`[dashboard-assets] uploaded ${key} (${contentType}, ${cacheControl})`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    bucket,
    publicBaseUrl: publicBaseUrl ?? '',
    prefix: PREFIX,
    entryJs,
    entryCss,
    files: uploaded,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`[dashboard-assets] uploaded ${uploaded.length} files to oss://${bucket}/${PREFIX}/`);
  console.log(`[dashboard-assets] manifest written to infra/alibaba/dashboard-assets.json`);
}

main().catch((error) => {
  console.error('[dashboard-assets] upload failed:', error);
  process.exitCode = 1;
});
