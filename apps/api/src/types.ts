import type { HolonetDatabase } from '@holonet/db';
import type { Env } from './config/env.js';

/** The authenticated principal — set by requireUser once auth is implemented. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  /** users.token_version — logout/password reset invalidate sessions. */
  tokenVersion: number;
}

/**
 * Hono app type: environment config and per-request state live in Variables
 * so every handler and middleware sees typed values.
 */
export type AppEnv = {
  Variables: {
    env: Env;
    requestId: string;
    /** Set by requireUser (placeholder until the auth phase). */
    user?: AuthenticatedUser;
    /** Set by requireWorkspaceAccess (placeholder until the auth phase). */
    workspaceId?: string;
    /** Request-scoped database (set when DATABASE_URL is configured). */
    db?: HolonetDatabase;
  };
};
