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
 * Records a security-relevant event (login, publish, backup, config change).
 * PLACEHOLDER: logs to stdout; persistence arrives in a later phase.
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
 * Creates a rate limiter configuration holder.
 * PLACEHOLDER: real limiting logic arrives in a later phase.
 */
export function createRateLimiter(config: RateLimitConfig): { config: RateLimitConfig } {
  return { config };
}
