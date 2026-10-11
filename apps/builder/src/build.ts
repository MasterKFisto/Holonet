import { and, eq, sql } from 'drizzle-orm';
import {
  blocks,
  createDatabase,
  databaseUrlFromEnv,
  deployments,
  jobs,
  pages,
  sites,
  templateVersions,
  type HolonetDatabase,
} from '@holonet/db';
import {
  professionalServicesTemplate,
  parseTemplateManifest,
  type TemplateManifest,
} from '@holonet/templates';
import {
  generateStaticSite,
  type HolonetSiteSnapshot,
  type SnapshotPage,
} from '@holonet/static-generator';
import { createStorageProviderFromEnv, releaseKey, type StorageProvider } from '@holonet/storage';

/**
 * Holonet build pipeline (local and Function Compute).
 *
 * 1. Load the deployment, site, pages, and blocks from PostgreSQL.
 * 2. Validate the site data (template manifest, page set).
 * 3. Generate the static site via @holonet/static-generator.
 * 4. Upload under sites/{siteId}/releases/{deploymentId}/ to the OSS public
 *    bucket (or local storage in development).
 * 5. Write the current release pointer sites/{siteId}/current.json.
 * 6. Mark the deployment and its job completed — or failed, with the build
 *    logs stored on the job result.
 */

export interface BuildSiteInput {
  siteId: string;
  deploymentId: string;
}

export interface BuildSiteResult {
  ok: boolean;
  deploymentId: string;
  files: number;
  error?: string;
}

export interface BuildDeps {
  db: HolonetDatabase;
  /** Public-bucket storage provider. */
  storage: StorageProvider;
  publicBaseUrl: string;
  now?: () => Date;
}

const HTML_CACHE = 'no-cache';
const ASSET_CACHE = 'public, max-age=31536000, immutable';

function cacheControlFor(key: string): string {
  return key.endsWith('.html') ? HTML_CACHE : ASSET_CACHE;
}

interface JobUpdate {
  status: 'processing' | 'completed' | 'failed';
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
  finishedAt?: Date | null;
}

function updateJob(db: HolonetDatabase, deploymentId: string, set: JobUpdate): Promise<unknown> {
  return db
    .update(jobs)
    .set(set)
    .where(
      and(eq(jobs.type, 'site_build'), sql`${jobs.payload}->>'deploymentId' = ${deploymentId}`),
    );
}

export async function buildSite(input: BuildSiteInput, deps: BuildDeps): Promise<BuildSiteResult> {
  const { db, storage, publicBaseUrl } = deps;
  const now = deps.now ?? (() => new Date());
  const logs: string[] = [];
  const log = (message: string): void => {
    logs.push(`[${now().toISOString()}] ${message}`);
  };

  const deployment = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, input.deploymentId), eq(deployments.siteId, input.siteId)),
  });
  if (!deployment) {
    throw new Error(`deployment ${input.deploymentId} not found for site ${input.siteId}`);
  }

  log(`build started for deployment ${input.deploymentId}`);
  await db
    .update(deployments)
    .set({ status: 'building', startedAt: now(), errorMessage: null })
    .where(eq(deployments.id, input.deploymentId));
  await updateJob(db, input.deploymentId, { status: 'processing' });

  try {
    const site = await db.query.sites.findFirst({ where: eq(sites.id, input.siteId) });
    if (!site) {
      throw new Error(`site ${input.siteId} not found`);
    }

    // Template manifest: from the site's template version, else the built-in
    // default. The manifest is re-validated — untrusted data (rule 17).
    let template: TemplateManifest;
    if (site.templateVersionId) {
      const version = await db.query.templateVersions.findFirst({
        where: eq(templateVersions.id, site.templateVersionId),
      });
      if (!version) {
        throw new Error(`template version ${site.templateVersionId} not found`);
      }
      template = parseTemplateManifest(version.manifest);
    } else {
      template = professionalServicesTemplate;
    }
    log(`template: ${template.id}@${template.version}`);

    // Pages + blocks (ordered).
    const sitePages = await db.query.pages.findMany({
      where: eq(pages.siteId, input.siteId),
      orderBy: (pages, { asc }) => [asc(pages.sortOrder), asc(pages.createdAt)],
    });
    const siteBlocks = await db.query.blocks.findMany({
      where: eq(blocks.siteId, input.siteId),
      orderBy: (blocks, { asc }) => [asc(blocks.sortOrder), asc(blocks.createdAt)],
    });
    const blocksByPage = new Map<string, typeof siteBlocks>();
    for (const block of siteBlocks) {
      const list = blocksByPage.get(block.pageId) ?? [];
      list.push(block);
      blocksByPage.set(block.pageId, list);
    }

    const snapshotPages: SnapshotPage[] = sitePages.map((page) => ({
      path: page.path,
      title: page.title,
      description:
        typeof page.meta['description'] === 'string' ? page.meta['description'] : undefined,
      blocks: (blocksByPage.get(page.id) ?? []).map((block) => ({
        type: block.type,
        props: block.props,
      })),
    }));

    if (snapshotPages.length === 0) {
      throw new Error(`site ${input.siteId} has no pages`);
    }

    const snapshot: HolonetSiteSnapshot = {
      workspaceId: site.workspaceId,
      siteId: site.id,
      siteName: site.name,
      baseUrl: publicBaseUrl,
      template,
      pages: snapshotPages,
    };

    const output = await generateStaticSite(snapshot);
    const fileCount = Object.keys(output.files).length;
    log(`generated ${fileCount} files`);

    // Upload under sites/{siteId}/releases/{deploymentId}/…
    for (const [fileKey, content] of Object.entries(output.files)) {
      const key = releaseKey(input.siteId, input.deploymentId, fileKey);
      const contentType =
        output.manifest.find((entry) => entry.key === fileKey)?.contentType ??
        'application/octet-stream';
      await storage.putObject(key, Buffer.from(content), {
        contentType,
        cacheControl: cacheControlFor(fileKey),
      });
    }

    // Current release metadata.
    const current = {
      deploymentId: input.deploymentId,
      storagePrefix: `sites/${input.siteId}/releases/${input.deploymentId}`,
      files: fileCount,
      generatedAt: now().toISOString(),
    };
    await storage.putObject(
      `sites/${input.siteId}/current.json`,
      Buffer.from(JSON.stringify(current, null, 2)),
      { contentType: 'application/json', cacheControl: HTML_CACHE },
    );
    log(`current release → ${current.storagePrefix}`);

    await db
      .update(deployments)
      .set({ status: 'live', finishedAt: now() })
      .where(eq(deployments.id, input.deploymentId));
    await updateJob(db, input.deploymentId, {
      status: 'completed',
      finishedAt: now(),
      result: { files: current.files, storagePrefix: current.storagePrefix, logs },
    });

    return { ok: true, deploymentId: input.deploymentId, files: current.files };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`build failed: ${message}`);
    await db
      .update(deployments)
      .set({ status: 'failed', errorMessage: message, finishedAt: now() })
      .where(eq(deployments.id, input.deploymentId));
    await updateJob(db, input.deploymentId, {
      status: 'failed',
      errorMessage: message,
      finishedAt: now(),
      result: { logs },
    });
    return { ok: false, deploymentId: input.deploymentId, files: 0, error: message };
  }
}

/** Build dependencies from environment variables (CLI and FC entrypoints). */
export function createBuildDepsFromEnv(): BuildDeps {
  return {
    db: createDatabase(databaseUrlFromEnv()),
    storage: createStorageProviderFromEnv('public'),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'https://holonet.section-zero.link',
  };
}
