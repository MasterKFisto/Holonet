import { Hono } from 'hono';
import { SERVICE_NAME } from '@holonet/core';
import type { AppEnv } from '../types.js';

/**
 * Health endpoints — fully implemented.
 * GET /health     — lightweight liveness probe.
 * GET /api/health — richer readiness probe (version, uptime).
 */
export const healthRoutes = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true, service: SERVICE_NAME }))
  .get('/api/health', (c) =>
    c.json({
      ok: true,
      service: SERVICE_NAME,
      version: '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
