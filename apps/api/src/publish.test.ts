import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  createDatabase,
  deployments,
  jobs,
  sites,
  templates,
  templateVersions,
  users,
  workspaces,
  type HolonetDatabase,
  type TemplateManifestJson,
} from '@holonet/db';
import { createFsStorageProvider, type FsStorageProvider } from '@holonet/storage';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `publish-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG = `publish-${unique}`;
const PUBLIC_BASE = 'https://holonet.section-zero.link';

let db: HolonetDatabase;
let storage: FsStorageProvider;
let storageDir: string;
let app: ReturnType<typeof createApp>;
let csrf = '';
let session = '';
let workspaceId = '';
let siteId = '';

async function csrfPair(): Promise<string> {
  const res = await app.request('/health');
  const match = (res.headers.get('set-cookie') ?? '').match(/holonet_csrf=([^;]+)/);
  return match?.[1] ?? '';
}

function sessionFrom(res: Response): string {
  const match = (res.headers.get('set-cookie') ?? '').match(/holonet_session=([^;]+)/);
  return match?.[1] ?? '';
}

function jsonHeaders(token: string, session?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-csrf-token': token,
    cookie: `holonet_csrf=${token}${session ? `; holonet_session=${session}` : ''}`,
  };
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: jsonHeaders(csrf, session),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe.skipIf(!hasDb)('holonet publishing pipeline (integration)', () => {
  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'holonet-publish-'));
    storage = createFsStorageProvider({
      rootDir: storageDir,
      bucket: 'public',
      publicBaseUrl: 'http://localhost:3000',
    });
    db = createDatabase(dbUrl!);
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: dbUrl!,
      AUTH_SECRET,
      SESSION_MAX_AGE_SECONDS: '3600',
      PUBLIC_BASE_URL: PUBLIC_BASE,
    });
    app = createApp(env, db, storage);
    csrf = await csrfPair();

    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(register.status).toBe(201);
    session = sessionFrom(register);

    const workspace = await api('POST', '/api/workspaces', { name: 'Publish WS', slug: SLUG });
    expect(workspace.status).toBe(201);
    workspaceId = ((await workspace.json()) as { workspace: { id: string } }).workspace.id;

    const site = await api('POST', `/api/workspaces/${workspaceId}/sites`, {
      name: 'Publish Site',
      slug: `publish-site-${unique}`,
    });
    expect(site.status).toBe(201);
    siteId = ((await site.json()) as { site: { id: string } }).site.id;

    const home = await api('POST', `/api/sites/${siteId}/pages`, { path: '/', title: 'Home' });
    expect(home.status).toBe(201);
    const pageId = ((await home.json()) as { page: { id: string } }).page.id;
    const hero = await api('POST', `/api/pages/${pageId}/blocks`, {
      type: 'hero',
      props: { headline: 'Built by Holonet' },
    });
    expect(hero.status).toBe(201);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG));
    await db.delete(users).where(eq(users.email, EMAIL));
    await closeDatabase(db);
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('publish creates a deployment and the builder uploads generated files', async () => {
    const publish = await api('POST', `/api/sites/${siteId}/publish`);
    expect(publish.status).toBe(202);
    const deployment = ((await publish.json()) as { deployment: { id: string; status: string } })
      .deployment;
    expect(deployment.status).toBe('live');

    const prefix = `sites/${siteId}/releases/${deployment.id}`;
    const keys = await storage.listObjects(prefix);
    expect(keys).toContain(`${prefix}/index.html`);
    expect(keys).toContain(`${prefix}/sitemap.xml`);
    expect(keys).toContain(`${prefix}/robots.txt`);
    expect(keys).toContain(`${prefix}/assets/styles.css`);

    const index = await storage.getObject(`${prefix}/index.html`);
    expect(index?.body.toString('utf8')).toContain('<h1>Built by Holonet</h1>');

    const current = await storage.getObject(`sites/${siteId}/current.json`);
    const currentBody = JSON.parse(current!.body.toString('utf8')) as {
      deploymentId: string;
      storagePrefix: string;
    };
    expect(currentBody.deploymentId).toBe(deployment.id);
    expect(currentBody.storagePrefix).toBe(prefix);

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.workspaceId, workspaceId),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    });
    expect(job?.status).toBe('completed');
    const result = job?.result as { logs?: string[]; files?: number } | undefined;
    expect(result?.logs?.some((line) => line.includes('build started'))).toBe(true);
    expect(result?.files).toBeGreaterThan(0);
  });

  it('rollback updates the current release pointer to a previous deployment', async () => {
    const list = await api('GET', `/api/sites/${siteId}/deployments`);
    const deploymentsBody = (await list.json()) as { deployments: Array<{ id: string }> };
    const first = deploymentsBody.deployments[deploymentsBody.deployments.length - 1]!;

    const rollback = await api('POST', `/api/sites/${siteId}/rollback/${first.id}`);
    expect(rollback.status).toBe(202);
    const rollbackDeployment = ((await rollback.json()) as { deployment: { status: string } })
      .deployment;
    expect(rollbackDeployment.status).toBe('live');

    const current = await storage.getObject(`sites/${siteId}/current.json`);
    const currentBody = JSON.parse(current!.body.toString('utf8')) as {
      targetDeploymentId: string;
      storagePrefix: string;
    };
    expect(currentBody.targetDeploymentId).toBe(first.id);
    expect(currentBody.storagePrefix).toBe(`sites/${siteId}/releases/${first.id}`);
  });

  it('a failed build marks the deployment and job failed with logs', async () => {
    // Assign a template version whose manifest is invalid (untrusted data).
    const [template] = await db
      .insert(templates)
      .values({ workspaceId, name: 'Broken Template', status: 'published' })
      .returning();
    const [version] = await db
      .insert(templateVersions)
      .values({
        templateId: template!.id,
        version: '1.0.0',
        manifest: { id: 'broken' } as unknown as TemplateManifestJson,
        isCurrent: true,
      })
      .returning();
    await db.update(sites).set({ templateVersionId: version!.id }).where(eq(sites.id, siteId));

    const publish = await api('POST', `/api/sites/${siteId}/publish`);
    expect(publish.status).toBe(202);
    const deployment = ((await publish.json()) as { deployment: { id: string; status: string } })
      .deployment;
    expect(deployment.status).toBe('failed');

    const row = await db.query.deployments.findFirst({ where: eq(deployments.id, deployment.id) });
    expect(row?.status).toBe('failed');
    expect(row?.errorMessage).toBeTruthy();

    const job = await db.query.jobs.findFirst({
      where: eq(jobs.workspaceId, workspaceId),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    });
    expect(job?.status).toBe('failed');
    expect(job?.errorMessage).toBeTruthy();
  });
});
