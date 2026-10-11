import { basename } from 'node:path';
import { closeDatabase } from '@holonet/db';
import { buildSite, createBuildDepsFromEnv } from './build.js';

export * from './build.js';
export * from './handler.js';

/**
 * Local CLI for the build pipeline:
 *
 *   pnpm --filter builder cli -- <siteId> <deploymentId>
 *
 * Loads the site from PostgreSQL, generates the static site, and uploads it
 * to local storage (STORAGE_PROVIDER=fs) or OSS (STORAGE_PROVIDER=oss).
 */
export async function runLocal(): Promise<void> {
  // pnpm may forward the '--' separator as an argument — strip it.
  const [siteId, deploymentId] = process.argv.slice(2).filter((arg) => arg !== '--');
  if (!siteId || !deploymentId) {
    console.error('[holonet-builder] usage: builder <siteId> <deploymentId>');
    process.exitCode = 1;
    return;
  }

  const deps = createBuildDepsFromEnv();
  try {
    const result = await buildSite({ siteId, deploymentId }, deps);
    console.log(
      `[holonet-builder] build ${result.ok ? 'completed' : 'failed'}: ${result.deploymentId} (${result.files} files)`,
    );
    if (result.error) {
      console.error(`[holonet-builder] ${result.error}`);
      process.exitCode = 1;
    }
  } finally {
    await closeDatabase(deps.db);
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  runLocal().catch((error) => {
    console.error('[holonet-builder] unexpected error:', error);
    process.exitCode = 1;
  });
}
