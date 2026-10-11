import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { blocks, forms, pages, sites } from '@holonet/db';
import { requireDb } from '../lib/db.js';
import { errorBody } from '../lib/errors.js';
import { unauthorized, verifyWorkspaceMembership } from './auth.js';
import type { AppEnv } from '../types.js';

function notFound(c: Parameters<MiddlewareHandler<AppEnv>>[0], message: string): Response {
  return c.json(errorBody({ code: 'NOT_FOUND', message }, c.get('requestId')), 404);
}

/**
 * Site access control: loads the site, verifies workspace membership, and
 * sets c.var.workspaceId + c.var.siteId. Non-members get 404 — the site's
 * existence is never leaked across tenants (rule 18).
 */
export function requireSiteAccess(paramName = 'siteId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return unauthorized(c, 'authentication required');
    }
    const siteId = c.req.param(paramName);
    if (!siteId) {
      return notFound(c, 'site not found');
    }
    const db = requireDb(c);
    const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
    if (!site || !(await verifyWorkspaceMembership(db, user.id, site.workspaceId))) {
      return notFound(c, 'site not found');
    }
    c.set('workspaceId', site.workspaceId);
    c.set('siteId', site.id);
    await next();
  };
}

/** Page access control: page → site → workspace membership. */
export function requirePageAccess(paramName = 'pageId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return unauthorized(c, 'authentication required');
    }
    const pageId = c.req.param(paramName);
    if (!pageId) {
      return notFound(c, 'page not found');
    }
    const db = requireDb(c);
    const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
    const site = page
      ? await db.query.sites.findFirst({ where: eq(sites.id, page.siteId) })
      : undefined;
    if (!page || !site || !(await verifyWorkspaceMembership(db, user.id, site.workspaceId))) {
      return notFound(c, 'page not found');
    }
    c.set('workspaceId', site.workspaceId);
    c.set('siteId', site.id);
    c.set('pageId', page.id);
    await next();
  };
}

/** Block access control: block → page → site → workspace membership. */
export function requireBlockAccess(paramName = 'blockId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return unauthorized(c, 'authentication required');
    }
    const blockId = c.req.param(paramName);
    if (!blockId) {
      return notFound(c, 'block not found');
    }
    const db = requireDb(c);
    const block = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
    const page = block
      ? await db.query.pages.findFirst({ where: eq(pages.id, block.pageId) })
      : undefined;
    const site = page
      ? await db.query.sites.findFirst({ where: eq(sites.id, page.siteId) })
      : undefined;
    if (
      !block ||
      !page ||
      !site ||
      !(await verifyWorkspaceMembership(db, user.id, site.workspaceId))
    ) {
      return notFound(c, 'block not found');
    }
    c.set('workspaceId', site.workspaceId);
    c.set('siteId', site.id);
    c.set('pageId', page.id);
    c.set('blockId', block.id);
    await next();
  };
}

/** Form access control: form → site → workspace membership. */
export function requireFormAccess(paramName = 'formId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return unauthorized(c, 'authentication required');
    }
    const formId = c.req.param(paramName);
    if (!formId) {
      return notFound(c, 'form not found');
    }
    const db = requireDb(c);
    const form = await db.query.forms.findFirst({ where: eq(forms.id, formId) });
    if (!form || !(await verifyWorkspaceMembership(db, user.id, form.workspaceId))) {
      return notFound(c, 'form not found');
    }
    c.set('workspaceId', form.workspaceId);
    c.set('siteId', form.siteId);
    await next();
  };
}
