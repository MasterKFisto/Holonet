import type { WorkspaceId } from '@holonet/core';
import { z } from 'zod';

export { z };

export * from './password.js';
export * from './session.js';

export interface AuditLogEntry {
  timestamp: string;
  workspaceId: WorkspaceId;
  actor: string;
  action: string;
  outcome: 'success' | 'failure';
  detail?: string;
}

/**
 * Lightweight stdout audit helper for CLIs and early development. The API
 * persists audit events to the database (`audit_logs`) via its own helpers;
 * this function remains for scripts that have no database handle.
 */
export function logAuditEvent(entry: AuditLogEntry): AuditLogEntry {
  console.log('[holonet-audit]', JSON.stringify(entry));
  return entry;
}

export interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

/**
 * Creates a rate limiter configuration holder. The API's limiting logic lives
 * in apps/api/src/middleware/rate-limit.ts (in-memory, per instance); this
 * holder is kept for the future shared-store (Redis) limiter upgrade path.
 */
export function createRateLimiter(config: RateLimitConfig): { config: RateLimitConfig } {
  return { config };
}
