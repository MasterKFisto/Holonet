import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  blocks,
  closeDatabase,
  createDatabase,
  pages,
  sites,
  users,
  workspaces,
  type HolonetDatabase,
} from '@holonet/db';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL_A = `crud-a-${unique}@holonet.local`;
const EMAIL_B = `crud-b-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG_A = `crud-a-${unique}`;
const SLUG_B = `crud-b-${unique}`;

type ErrorBody = { error: { code: string; message?: string }; requestId?: string };

async function errorBodyOf(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

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

let db: HolonetDatabase;
let app: ReturnType<typeof createApp>;
let csrf = '';
let sessionA = '';
let sessionB = '';
let workspaceAId = '';
let siteId = '';
let pageId = '';

async function registerUser(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(csrf),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  return sessionFrom(res);
}

async function api(
  method: string,
  path: string,
  opts: { session: string; body?: unknown },
): Promise<Response> {
  return app.request(path, {
    method,
    headers: jsonHeaders(csrf, opts.session),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe.skipIf(!hasDb).sequential('holonet-api CRUD (integration)', () => {
  beforeAll(async () => {
    db = createDatabase(dbUrl!);
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: dbUrl!,
      AUTH_SECRET,
      SESSION_MAX_AGE_SECONDS: '3600',
    });
    app = createApp(env, db);
    csrf = await csrfPair();
    sessionA = await registerUser(EMAIL_A);
    sessionB = await registerUser(EMAIL_B);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG_A));
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG_B));
    await db.delete(users).where(eq(users.email, EMAIL_A));
    await db.delete(users).where(eq(users.email, EMAIL_B));
    await closeDatabase(db);
  });

  it('creates a workspace and lists it with the owner role', async () => {
    const created = await api('POST', '/api/workspaces', {
      session: sessionA,
      body: { name: 'Workspace A', slug: SLUG_A },
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      workspace: { id: string; slug: string; status: string };
    };
    expect(createdBody.workspace.slug).toBe(SLUG_A);
    expect(createdBody.workspace.status).toBe('active');
    workspaceAId = createdBody.workspace.id;

    const list = await api('GET', '/api/workspaces', { session: sessionA });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { workspaces: Array<{ id: string; role: string }> };
    const mine = listBody.workspaces.find((row) => row.id === workspaceAId);
    expect(mine?.role).toBe('owner');
  });

  it('creates a site in the workspace', async () => {
    const created = await api('POST', `/api/workspaces/${workspaceAId}/sites`, {
      session: sessionA,
      body: { name: 'Pilot Site', slug: `site-${unique}` },
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { site: { id: string; status: string } };
    siteId = createdBody.site.id;
    expect(createdBody.site.status).toBe('draft');

    const list = await api('GET', `/api/workspaces/${workspaceAId}/sites`, { session: sessionA });
    const listBody = (await list.json()) as { sites: Array<{ id: string }> };
    expect(listBody.sites.some((row) => row.id === siteId)).toBe(true);
  });

  it('creates pages and maintains ordering', async () => {
    const home = await api('POST', `/api/sites/${siteId}/pages`, {
      session: sessionA,
      body: { path: '/', title: 'Home' },
    });
    expect(home.status).toBe(201);
    pageId = ((await home.json()) as { page: { id: string } }).page.id;

    const about = await api('POST', `/api/sites/${siteId}/pages`, {
      session: sessionA,
      body: { path: '/about', title: 'About' },
    });
    expect(about.status).toBe(201);

    const list = await api('GET', `/api/sites/${siteId}/pages`, { session: sessionA });
    const listBody = (await list.json()) as {
      pages: Array<{ path: string; sortOrder: number }>;
    };
    expect(listBody.pages.map((row) => row.path)).toEqual(['/', '/about']);
    expect(listBody.pages.map((row) => row.sortOrder)).toEqual([1, 2]);

    const duplicate = await api('POST', `/api/sites/${siteId}/pages`, {
      session: sessionA,
      body: { path: '/', title: 'Home Again' },
    });
    expect(duplicate.status).toBe(409);
  });

  it('creates valid blocks (JSONB props) and maintains ordering', async () => {
    const hero = await api('POST', `/api/pages/${pageId}/blocks`, {
      session: sessionA,
      body: { type: 'hero', props: { headline: 'Welcome', alignment: 'center' } },
    });
    expect(hero.status).toBe(201);
    const heroBlock = ((await hero.json()) as { block: { id: string; type: string } }).block;
    expect(heroBlock.type).toBe('hero');

    const text = await api('POST', `/api/pages/${pageId}/blocks`, {
      session: sessionA,
      body: { type: 'text_section', props: { content: 'Hello world' } },
    });
    expect(text.status).toBe(201);

    const list = await api('GET', `/api/pages/${pageId}/blocks`, { session: sessionA });
    const listBody = (await list.json()) as {
      blocks: Array<{ type: string; sortOrder: number; props: Record<string, unknown> }>;
    };
    expect(listBody.blocks.map((row) => row.type)).toEqual(['hero', 'text_section']);
    expect(listBody.blocks.map((row) => row.sortOrder)).toEqual([1, 2]);

    const stored = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
    const storedHero = stored.find((row) => row.type === 'hero');
    expect(storedHero?.props).toEqual({ headline: 'Welcome', alignment: 'center' });
  });

  it('rejects invalid block props', async () => {
    const missingHeadline = await api('POST', `/api/pages/${pageId}/blocks`, {
      session: sessionA,
      body: { type: 'hero', props: { subheadline: 'no headline here' } },
    });
    expect(missingHeadline.status).toBe(400);
    expect((await errorBodyOf(missingHeadline)).error.code).toBe('VALIDATION_ERROR');

    const unknownType = await api('POST', `/api/pages/${pageId}/blocks`, {
      session: sessionA,
      body: { type: 'rocket_ship', props: {} },
    });
    expect(unknownType.status).toBe(400);
    expect((await errorBodyOf(unknownType)).error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents cross-workspace access', async () => {
    // B creates its own workspace.
    const created = await api('POST', '/api/workspaces', {
      session: sessionB,
      body: { name: 'Workspace B', slug: SLUG_B },
    });
    expect(created.status).toBe(201);

    // B's list never contains A's workspace.
    const listB = await api('GET', '/api/workspaces', { session: sessionB });
    const listBody = (await listB.json()) as { workspaces: Array<{ id: string }> };
    expect(listBody.workspaces.some((row) => row.id === workspaceAId)).toBe(false);

    // Every attempt by B to reach A's resources returns 404 (no existence leak).
    const attempts: Array<[string, string]> = [
      ['GET', `/api/workspaces/${workspaceAId}`],
      ['PATCH', `/api/workspaces/${workspaceAId}`],
      ['POST', `/api/workspaces/${workspaceAId}/sites`],
      ['GET', `/api/sites/${siteId}`],
      ['PATCH', `/api/sites/${siteId}`],
      ['DELETE', `/api/sites/${siteId}`],
      ['GET', `/api/sites/${siteId}/pages`],
      ['POST', `/api/sites/${siteId}/pages`],
      ['GET', `/api/pages/${pageId}/blocks`],
      ['PATCH', `/api/pages/${pageId}`],
      ['DELETE', `/api/pages/${pageId}`],
    ];
    for (const [method, path] of attempts) {
      const res = await api(method, path, {
        session: sessionB,
        body: method !== 'GET' ? {} : undefined,
      });
      expect(res.status, `${method} ${path} by non-member`).toBe(404);
    }

    // A's resources are untouched.
    const stillThere = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
    expect(stillThere).toBeTruthy();
  });

  it('publishes a site, supports draft/published, and audits publish/rollback', async () => {
    const publish = await api('POST', `/api/sites/${siteId}/publish`, { session: sessionA });
    expect(publish.status).toBe(202);
    const deployment = ((await publish.json()) as { deployment: { id: string; status: string } })
      .deployment;
    expect(deployment.status).toBe('live');

    const siteRow = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
    expect(siteRow?.status).toBe('published');
    expect(siteRow?.publishedAt).toBeTruthy();

    // Draft/published status support via PATCH.
    const draft = await api('PATCH', `/api/sites/${siteId}`, {
      session: sessionA,
      body: { status: 'draft' },
    });
    expect(draft.status).toBe(200);
    const draftRow = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
    expect(draftRow?.status).toBe('draft');

    // Rollback enqueues a new deployment.
    const rollback = await api('POST', `/api/sites/${siteId}/rollback/${deployment.id}`, {
      session: sessionA,
    });
    expect(rollback.status).toBe(202);

    const deployments = await api('GET', `/api/sites/${siteId}/deployments`, {
      session: sessionA,
    });
    const deploymentList = (await deployments.json()) as {
      deployments: Array<{ note: string | null }>;
    };
    expect(deploymentList.deployments.length).toBe(2);
    expect(deploymentList.deployments.some((row) => row.note?.includes('rollback'))).toBe(true);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, workspaceAId));
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('workspace_created');
    expect(actions).toContain('site_created');
    expect(actions).toContain('page_created');
    expect(actions).toContain('block_created');
    expect(actions).toContain('site_published');
    expect(actions).toContain('site_updated');
    expect(actions).toContain('site_rollback');
  });

  it('updates and deletes with audit trails', async () => {
    const updated = await api('PATCH', `/api/workspaces/${workspaceAId}`, {
      session: sessionA,
      body: { name: 'Workspace A Renamed' },
    });
    expect(updated.status).toBe(200);

    const pageUpdated = await api('PATCH', `/api/pages/${pageId}`, {
      session: sessionA,
      body: { title: 'Home Updated' },
    });
    expect(pageUpdated.status).toBe(200);

    const blockList = await api('GET', `/api/pages/${pageId}/blocks`, { session: sessionA });
    const blockId = ((await blockList.json()) as { blocks: Array<{ id: string }> }).blocks[0]!.id;
    const blockDeleted = await api('DELETE', `/api/blocks/${blockId}`, { session: sessionA });
    expect(blockDeleted.status).toBe(200);

    const pageDeleted = await api('DELETE', `/api/pages/${pageId}`, { session: sessionA });
    expect(pageDeleted.status).toBe(200);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, workspaceAId));
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('workspace_updated');
    expect(actions).toContain('page_updated');
    expect(actions).toContain('block_deleted');
    expect(actions).toContain('page_deleted');
  });
});
