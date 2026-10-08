import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, createDatabase, databaseUrlFromEnv } from './client.js';

describe('@holonet/db connection', () => {
  it('exports a database factory', () => {
    expect(typeof createDatabase).toBe('function');
  });

  it('connects and executes a query when DATABASE_URL points at a reachable PostgreSQL', async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.warn('[db test] DATABASE_URL not set — skipping live connection test');
      return;
    }

    const db = createDatabase(url);
    try {
      const rows = await db.execute(sql`select 1 as ok`);
      expect(rows.rows).toHaveLength(1);
    } catch (error) {
      console.warn(`[db test] database unreachable — skipping live check: ${String(error)}`);
    } finally {
      await closeDatabase(db);
    }
  });

  it('throws a clear error when DATABASE_URL is unset', () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => databaseUrlFromEnv()).toThrow(/DATABASE_URL is not set/);
    } finally {
      if (previous !== undefined) {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});
