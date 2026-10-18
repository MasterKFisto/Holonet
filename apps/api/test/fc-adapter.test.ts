import { describe, expect, it } from 'vitest';
import {
  fcEventToRequest,
  handler,
  parseFcEvent,
  responseToFc3,
  storeFcContext,
  getFcContext,
  type Fc3HttpEvent,
} from '../src/function.js';

function httpEvent(overrides: Partial<Fc3HttpEvent> = {}): Fc3HttpEvent {
  return {
    version: 'v1',
    rawPath: '/api/health',
    body: null,
    isBase64Encoded: false,
    queryParameters: {},
    headers: { host: 'holonet.section-zero.link' },
    requestContext: { http: { method: 'GET', path: '/api/health' } },
    ...overrides,
  };
}

describe('holonet FC3 HTTP trigger adapter', () => {
  it('serves GET /api/health from an FC3 event with statusCode 200', async () => {
    const event = httpEvent();
    const response = await handler(JSON.stringify(event), { region: 'cn-hangzhou' });
    expect(response.statusCode).toBe(200);
    expect(response.isBase64Encoded).toBe(false);
    const body = JSON.parse(response.body) as { ok: boolean; service: string };
    expect(body).toMatchObject({ ok: true, service: 'holonet' });
  });

  it('accepts a Buffer event and builds the request URL from host + rawPath + query', async () => {
    const event = httpEvent({
      rawPath: '/api/health',
      queryParameters: { a: '1', b: 'x y' },
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
    });
    const request = fcEventToRequest(parseFcEvent(Buffer.from(JSON.stringify(event))));
    expect(request.url).toBe('https://example.com/api/health?a=1&b=x%20y');
    expect(request.method).toBe('GET');
  });

  /** Obtains a CSRF token from the double-submit cookie (as the dashboard does). */
  async function csrfToken(): Promise<string> {
    const event = httpEvent();
    const response = await handler(event);
    const setCookie = response.headers['set-cookie'];
    const values = Array.isArray(setCookie) ? setCookie : [setCookie];
    const match = values.find((value) => value?.includes('holonet_csrf='));
    return match?.match(/holonet_csrf=([^;]+)/)?.[1] ?? '';
  }

  it('decodes base64 request bodies (isBase64Encoded=true) for POST events', async () => {
    const token = await csrfToken();
    const payload = JSON.stringify({ email: 'someone@example.com' }); // missing password → 400
    const event = httpEvent({
      rawPath: '/api/auth/login',
      body: Buffer.from(payload, 'utf8').toString('base64'),
      isBase64Encoded: true,
      headers: {
        host: 'holonet.section-zero.link',
        'content-type': 'application/json',
        cookie: `holonet_csrf=${token}`,
        'x-csrf-token': token,
      },
      requestContext: { http: { method: 'POST', path: '/api/auth/login' } },
    });

    // Prove the adapter decoded the body: the login route parsed it and
    // rejected it with its Zod validation error (not CSRF, not "invalid JSON").
    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('passes plain-text request bodies through unchanged (transport level)', async () => {
    const event = httpEvent({
      rawPath: '/some/route',
      body: 'plain text body',
      headers: { host: 'holonet.section-zero.link', 'content-type': 'text/plain' },
      requestContext: { http: { method: 'POST', path: '/some/route' } },
    });
    const request = fcEventToRequest(event);
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('plain text body');
  });

  it('returns a structured 400 for unparseable events instead of crashing', async () => {
    const response = await handler('this is not json');
    expect(response.statusCode).toBe(400);
    expect(response.isBase64Encoded).toBe(false);
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Function Compute');

    const missingRawPath = await handler('{"version":"v1"}');
    expect(missingRawPath.statusCode).toBe(400);
  });

  it('base64-encodes binary response bodies with isBase64Encoded=true', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x01, 0xfe]);
    const response = new Response(bytes.buffer, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const fc3 = await responseToFc3(response);
    expect(fc3.isBase64Encoded).toBe(true);
    expect(Buffer.from(fc3.body, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('keeps text response bodies un-encoded', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fc3 = await responseToFc3(response);
    expect(fc3.isBase64Encoded).toBe(false);
    expect(fc3.body).toBe('{"ok":true}');
  });

  it('stores the FC context (credentials, region, accountId, requestId)', async () => {
    const context = {
      requestId: 'req-123',
      region: 'cn-hangzhou',
      accountId: '1234567890',
      credentials: {
        accessKeyId: 'STS.ak',
        accessKeySecret: 'STS.sk',
        securityToken: 'STS.token',
      },
    };
    storeFcContext(context);
    const stored = getFcContext();
    expect(stored?.requestId).toBe('req-123');
    expect(stored?.region).toBe('cn-hangzhou');
    expect(stored?.accountId).toBe('1234567890');
    expect(stored?.credentials?.securityToken).toBe('STS.token');
  });
});
