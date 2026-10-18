import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  closeDatabase,
  createDatabase,
  passwordResetTokens,
  securityEvents,
  users,
  workspaceMembers,
  workspaces,
  type HolonetDatabase,
} from '@holonet/db';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `auth-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const WS_SLUG = `test-ws-${unique}`;

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
let userId = '';
let activeSession = '';

describe.skipIf(!hasDb).sequential('holonet-api authentication (integration)', () => {
  beforeAll(async () => {
    db = createDatabase(dbUrl!);
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: dbUrl!,
      AUTH_SECRET,
      SESSION_MAX_AGE_SECONDS: '3600',
    });
    app = createApp(env, db);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, WS_SLUG));
    await db.delete(users).where(eq(users.email, EMAIL));
    await closeDatabase(db);
  });

  it('registers a user, sets an HTTP-only session, and audits the event', async () => {
    const token = await csrfPair();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.role).toBe('member');
    userId = body.user.id;

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('holonet_session=');
    expect(setCookie).toContain('HttpOnly');
    // The Secure flag derives from the PUBLIC_BASE_URL scheme (https://).
    expect(setCookie).toContain('Secure');
    activeSession = sessionFrom(res);
    expect(activeSession).toBeTruthy();

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'user_registered'));
    expect(audit.some((row) => row.actorUserId === userId)).toBe(true);
  });

  it('rejects duplicate registration with CONFLICT', async () => {
    const token = await csrfPair();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(409);
    expect((await errorBodyOf(res)).error.code).toBe('CONFLICT');
  });

  it('validates registration input with Zod', async () => {
    const token = await csrfPair();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
    });
    expect(res.status).toBe(400);
    expect((await errorBodyOf(res)).error.code).toBe('VALIDATION_ERROR');
  });

  it('serves /api/me for a valid session and rejects tampered tokens', async () => {
    const ok = await app.request('/api/me', {
      headers: { cookie: `holonet_session=${activeSession}` },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { user: { email: string } };
    expect(body.user.email).toBe(EMAIL);

    const tampered = await app.request('/api/me', {
      headers: { cookie: `holonet_session=${activeSession.slice(0, -4)}xxxx` },
    });
    expect(tampered.status).toBe(401);
  });

  it('logs in, logs out, and invalidates the session', async () => {
    const token = await csrfPair();

    const wrong = await app.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: 'wrong-password' }),
    });
    expect(wrong.status).toBe(401);
    expect((await errorBodyOf(wrong)).error.code).toBe('UNAUTHORIZED');

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    const freshSession = sessionFrom(login);
    expect(freshSession).toBeTruthy();

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: jsonHeaders(token, freshSession),
    });
    expect(logout.status).toBe(200);

    // Logout bumps users.token_version — the old JWT is now rejected.
    const after = await app.request('/api/me', {
      headers: { cookie: `holonet_session=${freshSession}` },
    });
    expect(after.status).toBe(401);
  });

  it('records failed-login security events', async () => {
    const events = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.eventType, 'login_failed'));
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.severity === 'warning')).toBe(true);
  });

  it('rate limits login after repeated failures', async () => {
    const target = `rate-${unique}@holonet.local`;
    const token = await csrfPair();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ email: target, password: 'wrong-password' }),
      });
      expect(res.status).toBe(401);
    }
    const blocked = await app.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: target, password: 'wrong-password' }),
    });
    expect(blocked.status).toBe(429);
    expect((await errorBodyOf(blocked)).error.code).toBe('RATE_LIMITED');
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('resets the password without leaking email existence', async () => {
    const token = await csrfPair();

    // Unknown email: identical success response, no debug token.
    const unknown = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: `ghost-${unique}@holonet.local` }),
    });
    expect(unknown.status).toBe(200);
    const unknownBody = (await unknown.json()) as { ok: boolean; debug?: unknown };
    expect(unknownBody.ok).toBe(true);
    expect(unknownBody.debug).toBeUndefined();

    // Known email: same shape, dev-only debug token.
    const known = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL }),
    });
    expect(known.status).toBe(200);
    const knownBody = (await known.json()) as { ok: boolean; debug?: { resetToken?: string } };
    expect(knownBody.ok).toBe(true);
    const resetToken = knownBody.debug?.resetToken;
    expect(resetToken).toBeTruthy();

    // Only the SHA-256 hash of the token is stored.
    const stored = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((row) => row.tokenHash !== resetToken)).toBe(true);

    const reset = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' }),
    });
    expect(reset.status).toBe(200);

    // Old password rejected; new password accepted.
    const oldLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ email: EMAIL, password: 'new-password-123' }),
    });
    expect(newLogin.status).toBe(200);
    activeSession = sessionFrom(newLogin);

    // Tokens are single-use.
    const reuse = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ token: resetToken, password: 'another-password-123' }),
    });
    expect(reuse.status).toBe(400);
  });

  it('prevents cross-workspace access via requireWorkspaceAccess', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Test Workspace', slug: WS_SLUG })
      .returning();
    expect(workspace).toBeTruthy();

    // Not a member yet: 404 — workspace existence is not leaked.
    const denied = await app.request(`/api/workspaces/${workspace!.id}`, {
      headers: { cookie: `holonet_session=${activeSession}` },
    });
    expect(denied.status).toBe(404);

    // Join as owner: guard passes, handler returns the workspace.
    await db.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId, role: 'owner' });
    const allowed = await app.request(`/api/workspaces/${workspace!.id}`, {
      headers: { cookie: `holonet_session=${activeSession}` },
    });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { workspace: { id: string } };
    expect(body.workspace.id).toBe(workspace!.id);

    // No session: 401.
    const anonymous = await app.request(`/api/workspaces/${workspace!.id}`);
    expect(anonymous.status).toBe(401);
  });

  it('enforces the admin role on admin routes', async () => {
    // Member role: 403.
    const member = await app.request('/api/admin/workspaces', {
      headers: { cookie: `holonet_session=${activeSession}` },
    });
    expect(member.status).toBe(403);
    expect((await errorBodyOf(member)).error.code).toBe('FORBIDDEN');

    // Promote directly in the database; the middleware reads the DB role.
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
    const admin = await app.request('/api/admin/workspaces', {
      headers: { cookie: `holonet_session=${activeSession}` },
    });
    expect(admin.status).toBe(501);
  });
});
