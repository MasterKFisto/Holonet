import type { Context, MiddlewareHandler } from 'hono';
import { errorBody } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

function bearerToken(c: Context<AppEnv>): string | undefined {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length).trim() || undefined;
}

/**
 * PLACEHOLDER — full authentication arrives in the auth phase.
 * Until then: no token → 401; a token that cannot yet be validated → 501.
 * Once implemented, this middleware resolves the session, sets c.var.user,
 * and calls next().
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c) => {
  const token = bearerToken(c);
  if (!token) {
    return c.json(
      errorBody({ code: 'UNAUTHORIZED', message: 'authentication required' }, c.get('requestId')),
      401,
    );
  }
  return c.json(
    errorBody(
      {
        code: 'NOT_IMPLEMENTED',
        message: 'session validation is not implemented yet (auth phase)',
      },
      c.get('requestId'),
    ),
    501,
  );
};

/**
 * PLACEHOLDER — workspace membership authorization arrives in the auth phase.
 * Once implemented, this middleware verifies the caller's role in
 * :workspaceId via workspace_members and sets c.var.workspaceId.
 */
export const requireWorkspaceAccess: MiddlewareHandler<AppEnv> = async (c) => {
  return c.json(
    errorBody(
      {
        code: 'NOT_IMPLEMENTED',
        message: 'workspace authorization is not implemented yet (auth phase)',
      },
      c.get('requestId'),
    ),
    501,
  );
};

/**
 * PLACEHOLDER — admin authorization arrives in the auth phase.
 * Once implemented, this middleware verifies c.var.user.role === 'admin'.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c) => {
  return c.json(
    errorBody(
      {
        code: 'NOT_IMPLEMENTED',
        message: 'admin authorization is not implemented yet (auth phase)',
      },
      c.get('requestId'),
    ),
    501,
  );
};
