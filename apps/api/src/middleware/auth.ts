import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq } from 'drizzle-orm';
import { users, workspaceMembers } from '@holonet/db';
import { verifySessionToken } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { errorBody } from '../lib/errors.js';
import type { AppEnv, AuthenticatedUser } from '../types.js';

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0], message: string): Response {
  return c.json(errorBody({ code: 'UNAUTHORIZED', message }, c.get('requestId')), 401);
}

/**
 * Resolves the session cookie into the authenticated user:
 * 1. verify the session JWT (jose HS256, AUTH_SECRET);
 * 2. load the user from PostgreSQL (authoritative role/status);
 * 3. require the token version to match users.token_version, so logout and
 *    password reset invalidate existing sessions;
 * 4. set c.var.user.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, c.get('env').SESSION_COOKIE_NAME);
  if (!token) {
    return unauthorized(c, 'authentication required');
  }
  const claims = await verifySessionToken(token, c.get('env').AUTH_SECRET);
  if (!claims) {
    return unauthorized(c, 'invalid or expired session');
  }
  const db = requireDb(c);
  const user = await db.query.users.findFirst({ where: eq(users.id, claims.sub) });
  if (!user || user.status !== 'active' || user.tokenVersion !== claims.ver) {
    return unauthorized(c, 'invalid or expired session');
  }
  const principal: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
  };
  c.set('user', principal);
  await next();
};

/** Requires an authenticated user with the admin role (users.role = 'admin'). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return unauthorized(c, 'authentication required');
  }
  if (user.role !== 'admin') {
    return c.json(
      errorBody({ code: 'FORBIDDEN', message: 'admin access required' }, c.get('requestId')),
      403,
    );
  }
  await next();
};

/**
 * Requires the caller to be an active member of the workspace identified by
 * the route parameter (default: 'workspaceId'). Sets c.var.workspaceId.
 *
 * Non-members receive 404 (not 403) so workspace existence is never leaked
 * across tenants (rule 18 — cross-workspace access is prevented).
 */
export function requireWorkspaceAccess(paramName = 'workspaceId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return unauthorized(c, 'authentication required');
    }
    const workspaceId = c.req.param(paramName);
    if (!workspaceId) {
      return c.json(
        errorBody({ code: 'NOT_FOUND', message: 'workspace not found' }, c.get('requestId')),
        404,
      );
    }
    const db = requireDb(c);
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id),
        eq(workspaceMembers.status, 'active'),
      ),
    });
    if (!member) {
      return c.json(
        errorBody({ code: 'NOT_FOUND', message: 'workspace not found' }, c.get('requestId')),
        404,
      );
    }
    c.set('workspaceId', workspaceId);
    await next();
  };
}
