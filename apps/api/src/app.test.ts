import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const app = createApp();

type ErrorBody = { error: { code: string; message?: string }; requestId?: string };

async function errorBodyOf(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

describe('holonet-api health', () => {
  it('responds to /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'holonet' });
  });

  it('responds to /api/health', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, service: 'holonet' });
    expect(typeof (body as { version?: unknown }).version).toBe('string');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toBeTruthy();
  });

  it('keeps remaining skeleton routes behind the auth guard (401 without a session)', async () => {
    const res = await app.request('/api/admin/workspaces');
    expect(res.status).toBe(401);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('guards workspace routes (401 without a session)', async () => {
    const res = await app.request('/api/workspaces');
    expect(res.status).toBe(401);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('exposes every planned route (no 404s)', async () => {
    const planned = [
      ['GET', '/api/workspaces'],
      ['POST', '/api/workspaces'],
      ['GET', '/api/workspaces/ws-1'],
      ['PATCH', '/api/workspaces/ws-1'],
      ['GET', '/api/workspaces/ws-1/sites'],
      ['POST', '/api/workspaces/ws-1/sites'],
      ['GET', '/api/sites/site-1'],
      ['PATCH', '/api/sites/site-1'],
      ['DELETE', '/api/sites/site-1'],
      ['GET', '/api/sites/site-1/pages'],
      ['POST', '/api/sites/site-1/pages'],
      ['PATCH', '/api/pages/page-1'],
      ['DELETE', '/api/pages/page-1'],
      ['GET', '/api/pages/page-1/blocks'],
      ['POST', '/api/pages/page-1/blocks'],
      ['PATCH', '/api/blocks/block-1'],
      ['DELETE', '/api/blocks/block-1'],
      ['POST', '/api/sites/site-1/publish'],
      ['POST', '/api/sites/site-1/import'],
      ['POST', '/api/sites/site-1/rollback/deploy-1'],
      ['GET', '/api/sites/site-1/deployments'],
      ['GET', '/api/sites/site-1/forms'],
      ['GET', '/api/forms/form-1/submissions'],
      ['POST', '/forms/11111111-1111-4111-8111-111111111111'],
      ['GET', '/api/admin/import-jobs'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/auth/forgot-password'],
      ['POST', '/api/auth/reset-password'],
      ['GET', '/api/me'],
    ] as const;
    for (const [method, path] of planned) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path} should exist`).not.toBe(404);
    }
  });
});

describe('holonet-api middleware', () => {
  it('sets security headers', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sets a request id and honors a valid client-supplied one', async () => {
    const own = await app.request('/health');
    expect(own.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    const echoed = await app.request('/health', {
      headers: { 'x-request-id': 'test-request-123' },
    });
    expect(echoed.headers.get('x-request-id')).toBe('test-request-123');
  });

  it('enables CORS for the local dashboard', async () => {
    const res = await app.request('/api/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('holonet-api auth without a database', () => {
  it('requires a session on /api/me', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'password-123' }),
    });
    expect(res.status).toBe(403);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('guards admin routes', async () => {
    const res = await app.request('/api/admin/workspaces');
    expect(res.status).toBe(401);
    const body = await errorBodyOf(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('holonet-api rate limiting', () => {
  it('rate limits per client IP', async () => {
    const env = loadEnv({
      ...process.env,
      RATE_LIMIT_MAX_REQUESTS: '2',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    });
    const limitedApp = createApp(env);
    const headers = { 'x-forwarded-for': '203.0.113.7' };

    expect((await limitedApp.request('/api/health', { headers })).status).toBe(200);
    expect((await limitedApp.request('/api/health', { headers })).status).toBe(200);

    const limited = await limitedApp.request('/api/health', { headers });
    expect(limited.status).toBe(429);
    const body = await errorBodyOf(limited);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});
