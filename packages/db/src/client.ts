import { existsSync, readFileSync } from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type HolonetDatabase = NodePgDatabase<typeof schema>;

/** Tracks the pg Pool behind each database instance for lifecycle control. */
const pools = new WeakMap<HolonetDatabase, Pool>();

/**
 * Loads KEY=VALUE lines from a .env file. Values are not shell-sourced, so
 * '<PLACEHOLDER>' tokens are safe. Existing environment variables win.
 */
export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) {
      const [, key, value] = match;
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

/** DATABASE_URL from the environment (docs/PROJECT_RULES.md rule 11). Throws when unset. */
export function databaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Export it or use the local development value from .env.example.',
    );
  }
  return url;
}

/**
 * Creates a Drizzle client backed by a PostgreSQL connection pool.
 * DATABASE_URL is provided via the environment (rule 11).
 */
export function createDatabase(databaseUrl: string = databaseUrlFromEnv()): HolonetDatabase {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  pools.set(db, pool);
  return db;
}

/** Ends the underlying connection pool (call on script exit / cold shutdown). */
export async function closeDatabase(db: HolonetDatabase): Promise<void> {
  const pool = pools.get(db);
  if (pool) {
    await pool.end();
  }
}
