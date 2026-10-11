import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  blocks,
  closeDatabase,
  createDatabase,
  deployments,
  designTokens,
  importJobs,
  pages,
  sites,
  users,
  workspaces,
  type HolonetDatabase,
} from '@holonet/db';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { applyImportAnalysis } from './lib/import-draft.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `import-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG = `import-${unique}`;

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
let session = '';
let siteId = '';
let workspaceId = '';

async function importRequest(body: unknown): Promise<Response> {
  return app.request(`/api/sites/${siteId}/import`, {
    method: 'POST',
    headers: jsonHeaders(csrf, session),
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)('holonet-api website import (integration)', () => {
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

    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(register.status).toBe(201);
    session = sessionFrom(register);

    const workspaceRes = await app.request('/api/workspaces', {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
      body: JSON.stringify({ name: 'Import Workspace', slug: SLUG }),
    });
    expect(workspaceRes.status).toBe(201);
    workspaceId = ((await workspaceRes.json()) as { workspace: { id: string } }).workspace.id;

    const siteRes = await app.request(`/api/workspaces/${workspaceId}/sites`, {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
      body: JSON.stringify({ name: 'Import Site', slug: `${SLUG}-site` }),
    });
    expect(siteRes.status).toBe(201);
    siteId = ((await siteRes.json()) as { site: { id: string } }).site.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG));
    await db.delete(users).where(eq(users.email, EMAIL));
    await closeDatabase(db);
  });

  it('requires ownership confirmation', async () => {
    const res = await importRequest({
      sourceUrl: 'https://example.com',
      ownershipConfirmed: false,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('ownership');
    // No job was created.
    expect(await db.select().from(importJobs)).toHaveLength(0);
  });

  it('creates an import job and rejects localhost sources safely', async () => {
    const res = await importRequest({
      sourceUrl: 'http://localhost:3000/admin',
      ownershipConfirmed: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      importJob: { id: string; status: string; errorMessage: string | null; sourceUrl: string };
    };
    expect(body.importJob.status).toBe('rejected');
    expect(body.importJob.sourceUrl).toBe('http://localhost:3000/admin');
    expect(body.importJob.errorMessage).toBeTruthy();

    const [row] = await db.select().from(importJobs).where(eq(importJobs.id, body.importJob.id));
    expect(row?.status).toBe('rejected');
    expect(row?.finishedAt).toBeTruthy();
  });

  it('creates an import job and rejects private IP sources safely', async () => {
    const res = await importRequest({
      sourceUrl: 'http://192.168.1.10/',
      ownershipConfirmed: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      importJob: { status: string; errorMessage: string | null };
    };
    expect(body.importJob.status).toBe('rejected');
    expect(body.importJob.errorMessage).toContain('non-public');
  });

  it('rejects link-local cloud metadata endpoints', async () => {
    const res = await importRequest({
      sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      ownershipConfirmed: true,
    });
    const body = (await res.json()) as {
      importJob: { status: string; errorMessage: string | null };
    };
    expect(res.status).toBe(200);
    expect(body.importJob.status).toBe('rejected');
  });

  it('stores fetch failures safely on the job (no crash, no partial publish)', async () => {
    const sourceUrl = `https://nonexistent-${unique}.invalid/`;
    const res = await importRequest({ sourceUrl, ownershipConfirmed: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      importJob: {
        status: string;
        errorMessage: string | null;
        stats: Record<string, unknown>;
      };
    };
    // DNS fails or the host is unreachable — either way the job ends failed.
    expect(['failed', 'rejected']).toContain(body.importJob.status);
    expect(body.importJob.errorMessage).toBeTruthy();
    expect(body.importJob.stats.errorCode).toBeTruthy();
  });

  it('validates the request body', async () => {
    const res = await importRequest({ sourceUrl: 'https://example.com' });
    expect(res.status).toBe(400);
    const missingUrl = await importRequest({ ownershipConfirmed: true });
    expect(missingUrl.status).toBe(400);
    const wrongTypes = await importRequest({ sourceUrl: 42, ownershipConfirmed: 'yes' });
    expect(wrongTypes.status).toBe(400);
  });

  it('creates a draft site structure from a valid analysis (draft creation logic)', async () => {
    const analysis = {
      businessName: 'Example LLP',
      suggestedTemplate: 'law-firm',
      designTokens: { primaryColor: '#1f2937', headingFont: 'Georgia' },
      navigation: [{ label: 'About', url: '/about' }],
      pages: [
        {
          title: 'Home',
          path: '/',
          sections: [
            { type: 'hero', heading: 'Example LLP', content: 'Trusted counsel.' },
            { type: 'text_section', heading: 'Services', content: 'Litigation and contracts.' },
          ],
        },
        {
          title: 'Contact',
          sections: [{ type: 'contact_form', heading: 'Get in touch' }],
        },
      ],
      contact: { email: 'hello@example-llp.example' },
      socialLinks: [],
      warnings: ['test draft'],
    };

    const result = await applyImportAnalysis({ db, workspaceId, siteId, analysis });
    expect(result.pagesCreated).toBe(2);
    expect(result.blocksCreated).toBe(3);
    expect(result.templateVersionId).toBeTruthy();
    expect(result.templateIdUsed).toBe('law-firm');

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    expect(site?.status).toBe('draft');
    expect(site?.templateVersionId).toBe(result.templateVersionId);

    const draftPages = await db.query.pages.findMany({
      where: eq(pages.siteId, siteId),
      orderBy: pages.sortOrder,
    });
    expect(draftPages).toHaveLength(2);
    expect(draftPages.every((page) => page.status === 'draft')).toBe(true);
    expect(draftPages[0]?.path).toBe('/');
    expect(draftPages[1]?.path).toBe('/contact');

    const draftBlocks = await db.select().from(blocks).where(eq(blocks.siteId, siteId));
    expect(draftBlocks).toHaveLength(3);
    expect(draftBlocks[0]?.type).toBe('hero');
    expect(draftBlocks[2]?.type).toBe('contact_form');

    const tokens = await db.query.designTokens.findFirst({
      where: eq(designTokens.siteId, siteId),
    });
    expect(tokens?.tokens).toMatchObject({ primaryColor: '#1f2937' });
  });

  it('rejects invalid AI output before creating any draft', async () => {
    const before = await db.query.pages.findMany({ where: eq(pages.siteId, siteId) });
    await expect(
      applyImportAnalysis({ db, workspaceId, siteId, analysis: { businessName: 12345 } }),
    ).rejects.toThrow();
    const after = await db.query.pages.findMany({ where: eq(pages.siteId, siteId) });
    expect(after).toHaveLength(before.length);
  });

  it('keeps the draft unpublished (no deployments, no publishedAt)', async () => {
    const deploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.siteId, siteId));
    expect(deploymentRows).toHaveLength(0);
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    expect(site?.publishedAt).toBeNull();
    const draftPages = await db.query.pages.findMany({ where: eq(pages.siteId, siteId) });
    expect(draftPages.every((page) => page.status === 'draft')).toBe(true);
  });
});
