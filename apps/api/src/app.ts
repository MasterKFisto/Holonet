import { Hono } from 'hono';
import { SERVICE_NAME } from '@holonet/core';

/**
 * Builds the Holonet API application.
 * Routes are added phase by phase; see docs/architecture.md.
 */
export function createApp(): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true, service: SERVICE_NAME }));
  return app;
}
