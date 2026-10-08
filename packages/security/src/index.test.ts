import { describe, expect, it } from 'vitest';
import { logAuditEvent } from './index.js';

describe('@holonet/security', () => {
  it('returns the logged audit entry', () => {
    const entry = logAuditEvent({
      timestamp: new Date().toISOString(),
      workspaceId: 'ws-1',
      actor: 'system',
      action: 'test',
      outcome: 'success',
    });
    expect(entry.action).toBe('test');
    expect(entry.workspaceId).toBe('ws-1');
  });
});
