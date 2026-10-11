import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  createDatabase,
  importJobs,
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
    const workspaceId = ((await workspaceRes.json()) as { workspace: { id: string } }).workspace.id;

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
});
