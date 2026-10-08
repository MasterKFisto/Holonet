import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('holonet-api', () => {
  it('responds to /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'holonet' });
  });
});
