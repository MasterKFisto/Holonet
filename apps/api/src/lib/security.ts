import { createHash } from 'node:crypto';
import {
  auditLogs,
  securityEvents,
  type HolonetDatabase,
  type SecurityEventSeverity,
} from '@holonet/db';

/** Hashes a client IP before storage — raw IPs are never persisted. */
export function ipHashOf(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export interface SecurityEventInput {
  workspaceId?: string;
  userId?: string;
  eventType: string;
  severity?: SecurityEventSeverity;
  metadata?: Record<string, unknown>;
}

/** Records a security event (failed logins, rate limits, …). */
export async function recordSecurityEvent(
  db: HolonetDatabase,
  input: SecurityEventInput,
): Promise<void> {
  await db.insert(securityEvents).values({
    workspaceId: input.workspaceId,
    userId: input.userId,
    eventType: input.eventType,
    severity: input.severity ?? 'info',
    metadata: input.metadata ?? {},
  });
}

export interface AuditLogInput {
  workspaceId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipHash?: string;
}

/** Records an audit log entry (login, logout, register, reset request, …). */
export async function recordAuditLog(db: HolonetDatabase, input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    ipHash: input.ipHash,
  });
}
