import { basename } from 'node:path';
import type { SiteId, WorkspaceId } from '@holonet/core';

export interface BuildRequest {
  workspaceId: WorkspaceId;
  siteId: SiteId;
}

export interface BuildResult {
  ok: boolean;
  files: number;
}

/**
 * Entry point for the Holonet build worker, deployed as an Alibaba Cloud
 * Function Compute function.
 *
 * PLACEHOLDER — the real pipeline arrives in a later phase:
 * 1. load site data via @holonet/db (scoped to request.workspaceId);
 * 2. generate static files via @holonet/static-generator;
 * 3. publish the artifacts via @holonet/storage (OSS in production).
 */
export async function handleBuild(_request: BuildRequest): Promise<BuildResult> {
  return { ok: true, files: 0 };
}

/** Local runner: prints a placeholder message until the worker is implemented. */
export async function runLocal(): Promise<void> {
  console.log('[holonet-builder] worker placeholder — pipeline arrives in a later phase');
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  void runLocal();
}
