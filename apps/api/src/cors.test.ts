import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { cookieSecure, loadEnv } from './config/env.js';

const ORIGIN_A = 'https://dashboard.example.com';
const ORIGIN_B = 'https://admin.example.com';
const ORIGIN_OTHER = 'https://evil.example.com';

function corsEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    ...process.env,
    PUBLIC_BASE_URL: 'https://platform.example.com',
    CORS_ORIGINS: `${ORIGIN_A}, ${ORIGIN_B}`,
    ...overrides,
  });
}

describe('holonet-api CORS (comma-separated CORS_ORIGINS)', () => {
  it('allows each origin in the list on simple requests', async () => {
    const app = createApp(corsEnv());

    const forA = await app.request('/health', { headers: { Origin: ORIGIN_A } });
    expect(forA.headers.get('access-control-allow-origin')).toBe(ORIGIN_A);
    expect(forA.headers.get('access-control-allow-credentials')).toBe('true');
    expect(forA.headers.get('vary')).toContain('Origin');

    const forB = await app.request('/health', { headers: { Origin: ORIGIN_B } });
    expect(forB.headers.get('access-control-allow-origin')).toBe(ORIGIN_B);
  });

  it('reflects the allowed origin on preflight requests', async () => {
    const app = createApp(corsEnv());

    const res = await app.request('/api/sites', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN_A,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN_A);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('rejects origins outside the list', async () => {
    const app = createApp(corsEnv());

    const res = await app.request('/health', { headers: { Origin: ORIGIN_OTHER } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('supports a single-origin list without trailing commas', async () => {
    const app = createApp(corsEnv({ CORS_ORIGINS: ORIGIN_A }));
    const res = await app.request('/health', { headers: { Origin: ORIGIN_A } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN_A);
  });
});

describe('holonet-api cookie Secure flag (derived from PUBLIC_BASE_URL)', () => {
  it('marks the CSRF cookie Secure when PUBLIC_BASE_URL is https://', async () => {
    const app = createApp(corsEnv({ NODE_ENV: 'development', PUBLIC_BASE_URL: ORIGIN_A }));
    const res = await app.request('/health');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('holonet_csrf=');
    expect(setCookie).toContain('Secure');
  });

  it('omits Secure when PUBLIC_BASE_URL is http:// (local development)', async () => {
    const app = createApp(
      corsEnv({ NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://localhost:3000' }),
    );
    const res = await app.request('/health');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('holonet_csrf=');
    expect(setCookie).not.toContain('Secure');
  });

  it('cookieSecure() mirrors the PUBLIC_BASE_URL scheme', () => {
    expect(cookieSecure(corsEnv({ PUBLIC_BASE_URL: 'https://platform.example.com' }))).toBe(true);
    expect(cookieSecure(corsEnv({ PUBLIC_BASE_URL: 'http://localhost:3000' }))).toBe(false);
  });
});
