import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  assets,
  closeDatabase,
  createDatabase,
  users,
  workspaces,
  type HolonetDatabase,
} from '@holonet/db';
import type { PutObjectOptions, StorageProvider } from '@holonet/storage';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL_A = `assets-a-${unique}@holonet.local`;
const EMAIL_B = `assets-b-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG_A = `assets-a-${unique}`;

/** In-memory mocked storage provider — no filesystem, no network. */
class MockStorageProvider implements StorageProvider {
  readonly kind = 'fs' as const;
  readonly bucket = 'public';
  readonly objects = new Map<
    string,
    { body: Buffer; contentType?: string; cacheControl?: string }
  >();
  readonly putCalls: Array<{ key: string; options?: PutObjectOptions }> = [];

  async putObject(key: string, body: Buffer, options?: PutObjectOptions): Promise<void> {
    this.objects.set(key, {
      body,
      contentType: options?.contentType,
      cacheControl: options?.cacheControl,
    });
    this.putCalls.push({ key, options });
  }

  async getObject(key: string) {
    const object = this.objects.get(key);
    return object
      ? { key, body: object.body, contentType: object.contentType ?? 'application/octet-stream' }
      : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  getPublicUrl(key: string): string {
    return `http://mock-storage/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `http://mock-storage/${key}?expires=${expiresInSeconds}`;
  }
}

let db: HolonetDatabase;
let app: ReturnType<typeof createApp>;
let storage: MockStorageProvider;
let csrf = '';
let sessionA = '';
let sessionB = '';
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

function multipartHeaders(token: string, session: string): Record<string, string> {
  return { 'x-csrf-token': token, cookie: `holonet_csrf=${token}; holonet_session=${session}` };
}

function uploadForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

async function registerUser(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(csrf),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  return sessionFrom(res);
}

describe.skipIf(!hasDb)('holonet-api asset uploads (mocked storage)', () => {
  beforeAll(async () => {
    db = createDatabase(dbUrl!);
    storage = new MockStorageProvider();
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: dbUrl!,
      AUTH_SECRET,
      SESSION_MAX_AGE_SECONDS: '3600',
    });
    app = createApp(env, db, storage);
    csrf = await csrfPair();
    sessionA = await registerUser(EMAIL_A);
    sessionB = await registerUser(EMAIL_B);

    const workspace = await app.request('/api/workspaces', {
      method: 'POST',
      headers: jsonHeaders(csrf, sessionA),
      body: JSON.stringify({ name: 'Assets WS', slug: SLUG_A }),
    });
    expect(workspace.status).toBe(201);
    workspaceId = ((await workspace.json()) as { workspace: { id: string } }).workspace.id;

    const site = await app.request(`/api/workspaces/${workspaceId}/sites`, {
      method: 'POST',
      headers: jsonHeaders(csrf, sessionA),
      body: JSON.stringify({ name: 'Assets Site', slug: `assets-site-${unique}` }),
    });
    expect(site.status).toBe(201);
    siteId = ((await site.json()) as { site: { id: string } }).site.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG_A));
    await db.delete(users).where(eq(users.email, EMAIL_A));
    await db.delete(users).where(eq(users.email, EMAIL_B));
    await closeDatabase(db);
  });

  it('uploads an image asset to the public bucket', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.jpg', { type: 'image/jpeg' });
    const res = await app.request(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      headers: multipartHeaders(csrf, sessionA),
      body: uploadForm(file),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      asset: {
        id: string;
        storageKey: string;
        contentType: string;
        sizeBytes: number;
        url: string;
      };
    };

    expect(body.asset.storageKey).toBe(`media/public/${workspaceId}/assets/${body.asset.id}.jpg`);
    expect(body.asset.contentType).toBe('image/jpeg');
    expect(body.asset.sizeBytes).toBe(4);
    expect(body.asset.url).toBe(`http://mock-storage/${body.asset.storageKey}`);

    // Storage provider received the object with content type + cache control.
    expect(storage.putCalls).toHaveLength(1);
    expect(storage.putCalls[0]).toMatchObject({
      key: body.asset.storageKey,
      options: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
    });
    expect(storage.objects.get(body.asset.storageKey)?.body).toEqual(Buffer.from([1, 2, 3, 4]));

    // Asset row recorded in the database.
    const row = await db.query.assets.findFirst({ where: eq(assets.id, body.asset.id) });
    expect(row).toBeTruthy();
    expect(row?.kind).toBe('image');
  });

  it('uploads a css asset with the css kind', async () => {
    const file = new File([new TextEncoder().encode('body { color: red }')], 'app.css', {
      type: 'text/css',
    });
    const res = await app.request(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      headers: multipartHeaders(csrf, sessionA),
      body: uploadForm(file),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { asset: { contentType: string; storageKey: string } };
    expect(body.asset.contentType).toBe('text/css');
    const row = await db.select().from(assets).where(eq(assets.storageKey, body.asset.storageKey));
    expect(row[0]?.kind).toBe('css');
  });

  it('rejects unsupported file types', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'evil.exe', {
      type: 'application/octet-stream',
    });
    const res = await app.request(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      headers: multipartHeaders(csrf, sessionA),
      body: uploadForm(file),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized files', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([big], 'huge.png', { type: 'image/png' });
    const res = await app.request(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      headers: multipartHeaders(csrf, sessionA),
      body: uploadForm(file),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents cross-workspace uploads', async () => {
    const file = new File([new Uint8Array([1])], 'sneaky.png', { type: 'image/png' });
    const res = await app.request(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      headers: multipartHeaders(csrf, sessionB),
      body: uploadForm(file),
    });
    expect(res.status).toBe(404);
  });

  it('serves local objects through the dev /storage route', async () => {
    await storage.putObject('media/public/ws-dev/serve.txt', Buffer.from('hello'), {
      contentType: 'text/plain',
    });
    const res = await app.request('/storage/public/media/public/ws-dev/serve.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('hello');

    const missing = await app.request('/storage/public/media/public/ws-dev/missing.txt');
    expect(missing.status).toBe(404);

    // The private bucket is never served by the dev route.
    const privateBucket = await app.request('/storage/private/media/public/ws-dev/serve.txt');
    expect(privateBucket.status).toBe(404);
  });
});
