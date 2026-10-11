import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Hono, type Context } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  ImportError,
  PROMPT_TEMPLATE_VERSION,
  analyzeWithFallback,
  createAiProvider,
  fetchSitePages,
} from '@holonet/ai';
import {
  aiAnalyses,
  deployments,
  importJobs,
  jobs,
  sites,
  templates,
  templateVersions,
} from '@holonet/db';
import { z } from '@holonet/security';
import { requireBuilder, requireDb, requirePrivateStorage, requireStorage } from '../lib/db.js';
import { applyImportAnalysis } from '../lib/import-draft.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog } from '../lib/security.js';
import { requireSiteAccess } from '../middleware/access.js';
import { requireUser } from '../middleware/auth.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  settings: z.record(z.unknown()).optional(),
  templateVersionId: z.string().uuid().nullable().optional(),
});

const getSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const site = await db.query.sites.findFirst({ where: eq(sites.id, c.get('siteId')!) });
  if (!site) {
    throw new AppError('NOT_FOUND', 'site not found', 404);
  }
  return c.json({ site });
};

const updateSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = updateSiteSchema.parse(await c.req.json());
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  const current = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!current) {
    throw new AppError('NOT_FOUND', 'site not found', 404);
  }

  if (body.slug) {
    const conflict = await db.query.sites.findFirst({
      where: and(eq(sites.workspaceId, workspaceId), eq(sites.slug, body.slug)),
    });
    if (conflict && conflict.id !== siteId) {
      throw new AppError('CONFLICT', 'site slug already taken in this workspace', 409);
    }
  }
  if (body.templateVersionId) {
    const version = await db.query.templateVersions.findFirst({
      where: eq(templateVersions.id, body.templateVersionId),
    });
    const template = version
      ? await db.query.templates.findFirst({ where: eq(templates.id, version.templateId) })
      : undefined;
    if (!version || !template || template.workspaceId !== workspaceId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'templateVersionId does not belong to this workspace',
        400,
      );
    }
  }

  // Status transitions maintain publishedAt (draft/published support).
  let publishedAt: Date | null | undefined;
  if (body.status !== undefined && body.status !== current.status) {
    publishedAt = body.status === 'published' ? new Date() : null;
  }

  const [site] = await db
    .update(sites)
    .set({ ...body, publishedAt, updatedAt: new Date() })
    .where(eq(sites.id, siteId))
    .returning();

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_updated',
    targetType: 'site',
    targetId: siteId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ site });
};

const deleteSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  // Hard delete; pages/blocks/deployments cascade.
  await db.delete(sites).where(eq(sites.id, siteId));
  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_deleted',
    targetType: 'site',
    targetId: siteId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ ok: true });
};

const publishSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const builder = requireBuilder(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;

  const deploymentId = randomUUID();
  const [deployment] = await db
    .insert(deployments)
    .values({
      id: deploymentId,
      siteId,
      workspaceId,
      status: 'queued',
      storagePrefix: `sites/${siteId}/releases/${deploymentId}`,
    })
    .returning();

  await db.insert(jobs).values({
    workspaceId,
    type: 'site_build',
    status: 'pending',
    payload: { siteId, deploymentId },
  });

  await db
    .update(sites)
    .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  // Local development: the build runs synchronously in-process (BUILDER_INVOKER).
  // The builder marks the deployment (and its job) completed or failed.
  await builder.invokeBuild(siteId, deploymentId);

  const [current] = await db.select().from(deployments).where(eq(deployments.id, deploymentId));

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_published',
    targetType: 'deployment',
    targetId: deploymentId,
    metadata: { siteId, status: current?.status },
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ deployment: current ?? deployment }, 202);
};

const rollbackSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;
  const deploymentId = c.req.param('deploymentId');
  if (!deploymentId) {
    throw new AppError('NOT_FOUND', 'deployment not found', 404);
  }

  const target = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.siteId, siteId)),
  });
  if (!target) {
    throw new AppError('NOT_FOUND', 'deployment not found', 404);
  }

  const newId = randomUUID();
  const [deployment] = await db
    .insert(deployments)
    .values({
      id: newId,
      siteId,
      workspaceId,
      status: 'queued',
      storagePrefix: target.storagePrefix,
      note: `rollback to ${deploymentId}`,
    })
    .returning();

  await db.insert(jobs).values({
    workspaceId,
    type: 'site_build',
    status: 'pending',
    payload: { siteId, deploymentId: newId, rollbackTo: deploymentId },
  });

  // Update the current release pointer to the previous deployment
  // (sites/{siteId}/current.json).
  const storage = requireStorage(c);
  const current = {
    deploymentId: newId,
    storagePrefix: target.storagePrefix,
    targetDeploymentId: deploymentId,
    generatedAt: new Date().toISOString(),
    note: `rollback to ${deploymentId}`,
  };
  await storage.putObject(
    `sites/${siteId}/current.json`,
    Buffer.from(JSON.stringify(current, null, 2)),
    { contentType: 'application/json', cacheControl: 'no-cache' },
  );

  await db
    .update(deployments)
    .set({ status: 'live', finishedAt: new Date() })
    .where(eq(deployments.id, newId));
  await db
    .update(jobs)
    .set({
      status: 'completed',
      finishedAt: new Date(),
      result: { note: 'rollback', targetDeploymentId: deploymentId },
    })
    .where(and(eq(jobs.type, 'site_build'), sql`${jobs.payload}->>'deploymentId' = ${newId}`));

  await recordAuditLog(db, {
    workspaceId,
    actorUserId: user.id,
    action: 'site_rollback',
    targetType: 'deployment',
    targetId: newId,
    metadata: { siteId, rollbackTo: deploymentId, newDeploymentId: newId },
    ipHash: ipHashOf(clientIp(c)),
  });

  const [live] = await db.select().from(deployments).where(eq(deployments.id, newId));
  return c.json({ deployment: live ?? deployment }, 202);
};

const listDeploymentsHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const rows = await db.query.deployments.findMany({
    where: eq(deployments.siteId, c.get('siteId')!),
    orderBy: [desc(deployments.createdAt)],
  });
  return c.json({ deployments: rows });
};

/*
 * Website import (AI importer foundation) — POST /api/sites/:siteId/import.
 *
 * Flow: validate request → create import_jobs (pending) → fetching (SSRF-safe
 * bounded fetch, robots.txt respected) → raw HTML to the PRIVATE bucket under
 * imports/{workspaceId}/{importJobId}/raw/ → analyzing (ai_analyses row) →
 * completed. Failures land on the job as `failed`; policy violations (invalid
 * URL, blocked host, robots disallowed) as `rejected`. Nothing is ever
 * published automatically — imported content becomes draft pages only, in a
 * later phase (docs/security.md).
 */

const IMPORT_USER_AGENT = 'HolonetImporter/0.1';

/** ImportError codes that are policy rejections rather than runtime failures. */
const REJECTED_CODES = new Set(['invalid-url', 'blocked-host', 'robots-disallowed']);

const importSiteSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2000),
  ownershipConfirmed: z.boolean(),
});

async function updateImportJob(
  db: ReturnType<typeof requireDb>,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(importJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(importJobs.id, jobId));
}

const importSiteHandler = async (c: Context<AppEnv>): Promise<Response> => {
  let body: z.infer<typeof importSiteSchema>;
  try {
    body = importSiteSchema.parse(await c.req.json());
  } catch {
    throw new AppError(
      'VALIDATION_ERROR',
      'request body must be { sourceUrl: string, ownershipConfirmed: boolean }',
      400,
    );
  }
  // 1. Ownership confirmation is mandatory.
  if (body.ownershipConfirmed !== true) {
    throw new AppError(
      'VALIDATION_ERROR',
      'ownership confirmation is required before importing a website',
      400,
    );
  }

  const db = requireDb(c);
  const user = c.get('user')!;
  const siteId = c.get('siteId')!;
  const workspaceId = c.get('workspaceId')!;
  const privateStorage = requirePrivateStorage(c);
  const env = c.get('env');

  // 2. Create the import job (pending) — every attempt is auditable.
  const [job] = await db
    .insert(importJobs)
    .values({
      workspaceId,
      siteId,
      sourceUrl: body.sourceUrl,
      status: 'pending',
      aiProvider: 'heuristics',
    })
    .returning();

  const finish = async (
    status: 'completed' | 'failed' | 'rejected',
    patch: { errorMessage?: string; stats?: Record<string, unknown> },
  ): Promise<void> => {
    await updateImportJob(db, job!.id, { ...patch, status, finishedAt: new Date() });
  };

  const auditImport = async (outcome: string): Promise<void> => {
    await recordAuditLog(db, {
      workspaceId,
      actorUserId: user.id,
      action: 'site_import',
      targetType: 'site',
      targetId: siteId,
      metadata: { importJobId: job!.id, sourceUrl: body.sourceUrl, outcome },
      ipHash: ipHashOf(clientIp(c)),
    });
  };

  try {
    // 3. Fetching — SSRF-safe, bounded, credential-free (docs/security.md).
    await updateImportJob(db, job!.id, { status: 'fetching', startedAt: new Date() });

    const result = await fetchSitePages(
      body.sourceUrl,
      {
        resolveHost: async (hostname) => {
          try {
            const entries = await lookup(hostname, { all: true });
            return entries.map((entry) => entry.address);
          } catch {
            // DNS failures surface as ImportError('unresolvable-host') upstream,
            // so the job ends `failed` instead of crashing the request.
            return [];
          }
        },
        fetchUrl: async (url, init) => {
          const response = await fetch(url, {
            redirect: 'manual', // the importer re-validates every hop itself
            signal: init?.signal,
            headers: {
              'user-agent': IMPORT_USER_AGENT,
              accept: init?.headers?.['accept'] ?? 'text/html',
            },
          });
          return {
            status: response.status,
            headers: { get: (name: string) => response.headers.get(name) },
            text: async () => response.text(),
            url: response.url,
          };
        },
      },
      {
        maxPages: env.IMPORT_MAX_PAGES,
        maxPageBytes: env.IMPORT_MAX_PAGE_BYTES,
        timeoutMs: env.IMPORT_TIMEOUT_MS,
        userAgent: IMPORT_USER_AGENT,
      },
    );

    // 4. Raw fetched data goes to the PRIVATE bucket only (never public).
    const rawKeys: string[] = [];
    const rawManifest = {
      sourceUrl: body.sourceUrl,
      fetchedAt: new Date().toISOString(),
      pages: result.pages.map((page) => ({
        url: page.url,
        status: page.status,
        contentType: page.contentType,
        bytes: Buffer.byteLength(page.html, 'utf8'),
      })),
      robots: result.robots,
    };
    for (const [index, page] of result.pages.entries()) {
      const key = `imports/${workspaceId}/${job!.id}/raw/page-${index + 1}.html`;
      await privateStorage.putObject(key, Buffer.from(page.html, 'utf8'), {
        contentType: 'text/html',
      });
      rawKeys.push(key);
    }
    await privateStorage.putObject(
      `imports/${workspaceId}/${job!.id}/raw/manifest.json`,
      Buffer.from(JSON.stringify(rawManifest, null, 2)),
      { contentType: 'application/json' },
    );
    rawKeys.push(`imports/${workspaceId}/${job!.id}/raw/manifest.json`);

    // 5. Analyzing — provider pipeline with manual fallback. The AI output is
    //    validated with Zod before any draft is created (rule 17).
    await updateImportJob(db, job!.id, { status: 'analyzing' });
    const provider = createAiProvider(env);
    const outcome = await analyzeWithFallback(provider, {
      sourceUrl: body.sourceUrl,
      pages: result.pages,
      robots: result.robots,
    });

    // 6. Store the AI output (provider, model, prompt template version).
    await db.insert(aiAnalyses).values({
      workspaceId,
      importJobId: job!.id,
      siteId,
      model: outcome.model,
      provider: outcome.providerUsed,
      promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      input: {
        sourceUrl: body.sourceUrl,
        pageCount: result.pages.length,
        providerConfigured: provider.name,
      },
      output: {
        ...outcome.analysis,
        fallbackFrom: outcome.fallbackFrom,
      },
      tokenUsage: {},
      status: 'completed',
    });

    // 7. Draft creation — draft pages/blocks only, never published. The
    //    import job stays linked to the site (import_jobs.site_id).
    const draft = await applyImportAnalysis({
      db,
      workspaceId,
      siteId,
      analysis: outcome.analysis,
    });

    await finish('completed', {
      stats: {
        pagesFetched: result.pages.length,
        robots: result.robots,
        rawKeys,
        provider: outcome.providerUsed,
        model: outcome.model,
        fallbackFrom: outcome.fallbackFrom,
        suggestedTemplate: outcome.analysis.suggestedTemplate,
        draft,
      },
    });
  } catch (error) {
    if (error instanceof ImportError) {
      const terminalStatus = REJECTED_CODES.has(error.code) ? 'rejected' : 'failed';
      await finish(terminalStatus, {
        errorMessage: error.message,
        stats: { errorCode: error.code },
      });
      await auditImport(terminalStatus);
      const [finalJob] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id));
      return c.json({ importJob: finalJob }, 200);
    }
    // Unexpected failure: the job is marked failed (safe to inspect) and the
    // error surfaces through the global error handler.
    await finish('failed', { errorMessage: 'import failed unexpectedly' });
    await auditImport('failed');
    throw error;
  }

  await auditImport('completed');

  const [finalJob] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id));
  return c.json({ importJob: finalJob }, 200);
};

export const siteRoutes = new Hono<AppEnv>()
  .get('/api/sites/:siteId', requireUser, requireSiteAccess(), getSiteHandler)
  .patch('/api/sites/:siteId', requireUser, requireSiteAccess(), updateSiteHandler)
  .delete('/api/sites/:siteId', requireUser, requireSiteAccess(), deleteSiteHandler)
  .post('/api/sites/:siteId/publish', requireUser, requireSiteAccess(), publishSiteHandler)
  .post(
    '/api/sites/:siteId/rollback/:deploymentId',
    requireUser,
    requireSiteAccess(),
    rollbackSiteHandler,
  )
  .get('/api/sites/:siteId/deployments', requireUser, requireSiteAccess(), listDeploymentsHandler)
  .post('/api/sites/:siteId/import', requireUser, requireSiteAccess(), importSiteHandler);
