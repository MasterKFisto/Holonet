import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs with cwd = packages/db. Load the repository-root .env
// inline (drizzle-kit's config loader cannot resolve NodeNext '.js' imports
// from ./src, so loadEnvFile() from client.ts is duplicated here).
// Environment takes precedence; real values are never committed.
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(rootDir, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) {
      const [, key, value] = match;
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

// db:generate works offline; only drizzle-kit studio/migrate need a real URL,
// and pnpm db:migrate routes through src/migrate.ts instead.
const databaseUrl = process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
