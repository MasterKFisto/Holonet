import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  createDatabase,
  formSubmissions,
  forms,
  jobs,
  securityEvents,
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
const EMAIL_A = `forms-a-${unique}@holonet.local`;
const EMAIL_B = `forms-b-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG = `forms-${unique}`;

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

/** Public submission requests: no session or CSRF token (cross-origin visitors). */
function submitHeaders(
  contentType = 'application/json',
  ip = '203.0.113.10',
): Record<string, string> {
  return { 'content-type': contentType, 'x-forwarded-for': ip };
}

let db: HolonetDatabase;
let app: ReturnType<typeof createApp>;
let csrf = '';
let sessionA = '';
let sessionB = '';
let workspaceId = '';
let siteId = '';
let formId = '';
let formWithEmailId = '';

async function registerUser(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(csrf),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  return sessionFrom(res);
}

async function submissionCount(ofFormId: string): Promise<number> {
  const rows = await db.query.formSubmissions.findMany({
    where: eq(formSubmissions.formId, ofFormId),
  });
  return rows.length;
}

describe.skipIf(!hasDb)('holonet-api forms (integration)', () => {
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

    const workspaceRes = await app.request('/api/workspaces', {
      method: 'POST',
      headers: jsonHeaders(csrf, sessionA),
      body: JSON.stringify({ name: 'Forms Workspace', slug: SLUG }),
    });
    expect(workspaceRes.status).toBe(201);
    workspaceId = ((await workspaceRes.json()) as { workspace: { id: string } }).workspace.id;

    const siteRes = await app.request(`/api/workspaces/${workspaceId}/sites`, {
      method: 'POST',
      headers: jsonHeaders(csrf, sessionA),
      body: JSON.stringify({ name: 'Forms Site', slug: `${SLUG}-site` }),
    });
    expect(siteRes.status).toBe(201);
    siteId = ((await siteRes.json()) as { site: { id: string } }).site.id;

    const [plain] = await db
      .insert(forms)
      .values({ siteId, workspaceId, name: 'Contact' })
      .returning({ id: forms.id });
    const [withEmail] = await db
      .insert(forms)
      .values({ siteId, workspaceId, name: 'Callback', notificationEmail: 'owner@holonet.local' })
      .returning({ id: forms.id });
    formId = plain!.id;
    formWithEmailId = withEmail!.id;
  });

  afterAll(async () => {
    await db.delete(securityEvents).where(eq(securityEvents.eventType, 'form_spam_detected'));
    await db.delete(securityEvents).where(eq(securityEvents.eventType, 'form_rate_limited'));
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG));
    await db.delete(users).where(eq(users.email, EMAIL_A));
    await db.delete(users).where(eq(users.email, EMAIL_B));
    await closeDatabase(db);
  });

  it('stores a valid JSON submission and enqueues a notification job placeholder', async () => {
    const res = await app.request(`/forms/${formWithEmailId}`, {
      method: 'POST',
      headers: submitHeaders(),
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', message: 'Hello!' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await db.query.formSubmissions.findMany({
      where: eq(formSubmissions.formId, formWithEmailId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ name: 'Jane', email: 'jane@example.com', message: 'Hello!' });
    // Raw IPs are never stored — only their hash.
    expect(rows[0]!.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]!.ipHash).not.toContain('203.0.113');

    // Webhook placeholder: a pending notification job is enqueued.
    const job = await db.query.jobs.findFirst({ where: eq(jobs.type, 'form_notification') });
    expect(job).toBeTruthy();
    expect(job?.status).toBe('pending');
    expect((job?.payload as Record<string, unknown>).formId).toBe(formWithEmailId);
  });

  it('accepts form-encoded submissions', async () => {
    const res = await app.request(`/forms/${formId}`, {
      method: 'POST',
      headers: submitHeaders('application/x-www-form-urlencoded', '203.0.113.11'),
      body: 'name=John&email=john%40example.com&message=Hi+there',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await db.query.formSubmissions.findMany({
      where: eq(formSubmissions.formId, formId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ name: 'John', email: 'john@example.com', message: 'Hi there' });
  });

  it('silently discards honeypot submissions and logs a security event', async () => {
    const res = await app.request(`/forms/${formId}`, {
      method: 'POST',
      headers: submitHeaders('application/json', '203.0.113.12'),
      body: JSON.stringify({
        name: 'Bot',
        email: 'bot@spam.example',
        message: 'Buy now!',
        website: 'http://spam.example',
      }),
    });
    expect(res.status).toBe(200);
    // Generic success — identical to a real submission.
    expect(await res.json()).toEqual({ ok: true });
    // …but nothing was stored.
    expect(await submissionCount(formId)).toBe(1);

    const event = await db.query.securityEvents.findFirst({
      where: eq(securityEvents.eventType, 'form_spam_detected'),
    });
    expect(event).toBeTruthy();
    expect((event?.metadata as Record<string, unknown>).formId).toBe(formId);
  });

  it('rate limits repeated submissions per IP and escalates a security event', async () => {
    const [rateForm] = await db
      .insert(forms)
      .values({ siteId, workspaceId, name: 'Rate-limited' })
      .returning({ id: forms.id });
    const ip = '203.0.113.20';

    for (let i = 0; i < 10; i += 1) {
      const res = await app.request(`/forms/${rateForm!.id}`, {
        method: 'POST',
        headers: submitHeaders('application/json', ip),
        body: JSON.stringify({ name: `Visitor ${i}` }),
      });
      expect(res.status).toBe(200);
    }
    expect(await submissionCount(rateForm!.id)).toBe(10);

    // The 11th request trips the limiter: still a generic success…
    const blocked = await app.request(`/forms/${rateForm!.id}`, {
      method: 'POST',
      headers: submitHeaders('application/json', ip),
      body: JSON.stringify({ name: 'Over the limit' }),
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ ok: true });
    // …but nothing is stored and the abuse is logged.
    expect(await submissionCount(rateForm!.id)).toBe(10);
    const event = await db.query.securityEvents.findFirst({
      where: eq(securityEvents.eventType, 'form_rate_limited'),
    });
    expect(event).toBeTruthy();
    expect(event?.severity).toBe('warning');

    // Repeated abuse keeps getting silently discarded (no new rows).
    for (let i = 0; i < 4; i += 1) {
      const res = await app.request(`/forms/${rateForm!.id}`, {
        method: 'POST',
        headers: submitHeaders('application/json', ip),
        body: JSON.stringify({ name: 'Still over' }),
      });
      expect(res.status).toBe(200);
    }
    expect(await submissionCount(rateForm!.id)).toBe(10);
  });

  it('returns a safe generic response for invalid form ids', async () => {
    const res = await app.request('/forms/not-a-uuid', {
      method: 'POST',
      headers: submitHeaders('application/json', '203.0.113.30'),
      body: '{}',
    });
    expect(res.status).toBe(404);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('not found');

    // Well-formed but unknown form ids are silently discarded (no existence leak).
    const unknown = await app.request(`/forms/${randomUUID()}`, {
      method: 'POST',
      headers: submitHeaders('application/json', '203.0.113.30'),
      body: JSON.stringify({ name: 'Probe' }),
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true });
  });

  it('rejects oversized payloads with 413', async () => {
    const res = await app.request(`/forms/${formId}`, {
      method: 'POST',
      headers: submitHeaders('application/json', '203.0.113.31'),
      body: JSON.stringify({ message: 'x'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await submissionCount(formId)).toBe(1);
  });

  it('exposes submissions only to workspace members', async () => {
    // Unauthenticated → 401.
    const anon = await app.request(`/api/forms/${formId}/submissions`);
    expect(anon.status).toBe(401);

    // Workspace member sees the stored submission.
    const member = await app.request(`/api/forms/${formId}/submissions`, {
      headers: jsonHeaders(csrf, sessionA),
    });
    expect(member.status).toBe(200);
    const memberBody = (await member.json()) as { submissions: Array<Record<string, unknown>> };
    expect(memberBody.submissions).toHaveLength(1);
    expect(memberBody.submissions[0]!.data).toEqual({
      name: 'John',
      email: 'john@example.com',
      message: 'Hi there',
    });

    // Outsider → 404 (no existence leak).
    const outsider = await app.request(`/api/forms/${formId}/submissions`, {
      headers: jsonHeaders(csrf, sessionB),
    });
    expect(outsider.status).toBe(404);
  });

  it('lists forms for a site only to members', async () => {
    const member = await app.request(`/api/sites/${siteId}/forms`, {
      headers: jsonHeaders(csrf, sessionA),
    });
    expect(member.status).toBe(200);
    const body = (await member.json()) as { forms: Array<{ id: string; name: string }> };
    expect(body.forms.map((form) => form.name)).toContain('Contact');

    const outsider = await app.request(`/api/sites/${siteId}/forms`, {
      headers: jsonHeaders(csrf, sessionB),
    });
    expect(outsider.status).toBe(404);
  });
});
