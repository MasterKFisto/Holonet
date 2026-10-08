import { describe, expect, it } from 'vitest';
import * as schema from './schema.js';

describe('@holonet/db schema compilation', () => {
  it('defines all 22 Holonet tables', () => {
    const tableNames = [
      'users',
      'workspaces',
      'workspaceMembers',
      'sites',
      'templates',
      'templateVersions',
      'pages',
      'blocks',
      'assets',
      'forms',
      'formSubmissions',
      'domains',
      'deployments',
      'snapshots',
      'subscriptions',
      'payments',
      'auditLogs',
      'securityEvents',
      'jobs',
      'importJobs',
      'aiAnalyses',
      'designTokens',
    ] as const;

    expect(tableNames).toHaveLength(22);
    for (const name of tableNames) {
      const table = schema[name];
      expect(table, `table ${name} should exist`).toBeDefined();
    }
  });

  it('stores password hashes and MFA fields on users, never plaintext', () => {
    expect(schema.users.passwordHash.name).toBe('password_hash');
    expect(schema.users.mfaSecret.name).toBe('mfa_secret');
    expect(schema.users.mfaEnabled.name).toBe('mfa_enabled');
    expect(schema.users.mfaRecoveryCodes.name).toBe('mfa_recovery_codes');
    // The schema has no plaintext password column.
    expect(Object.keys(schema.users)).not.toContain('password');
  });

  it('covers the job queue lifecycle statuses', () => {
    expect(schema.jobs.status.name).toBe('status');
    expect(schema.jobs.availableAt.name).toBe('available_at');
    expect(schema.jobs.attempts.name).toBe('attempts');
  });

  it('scopes tenant queries with workspaceFilter', async () => {
    const { createDatabase, closeDatabase } = await import('./client.js');
    const db = createDatabase('postgres://unused:unused@localhost:5432/unused');
    try {
      const query = db
        .select()
        .from(schema.sites)
        .where(schema.workspaceFilter(schema.sites, 'ws-123'));
      const rendered = query.toSQL();
      expect(rendered.sql).toContain('workspace_id');
      expect(rendered.params).toContain('ws-123');
    } finally {
      await closeDatabase(db);
    }
  });
});
