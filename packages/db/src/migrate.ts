import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  closeDatabase,
  createDatabase,
  databaseUrlFromEnv,
  loadEnvFile,
  type HolonetDatabase,
} from './client.js';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending Drizzle migrations from ./migrations. */
export async function migrateDatabase(db: HolonetDatabase): Promise<void> {
  await migrate(db, { migrationsFolder });
}

async function main(): Promise<void> {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  loadEnvFile(resolve(rootDir, '.env'));

  const db = createDatabase(databaseUrlFromEnv());
  try {
    await migrateDatabase(db);
    console.log('[holonet-db] migrations applied');
  } finally {
    await closeDatabase(db);
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((error) => {
    console.error('[holonet-db] migration failed:', error);
    process.exitCode = 1;
  });
}
