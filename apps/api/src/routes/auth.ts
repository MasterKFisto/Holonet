import { createHash, randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { passwordResetTokens, users } from '@holonet/db';
import { hashPassword, signSessionToken, verifyPassword, z } from '@holonet/security';
import { requireDb } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { ipHashOf, recordAuditLog, recordSecurityEvent } from '../lib/security.js';
import { clearSessionCookie, setSessionCookie } from '../lib/session-cookie.js';
import { requireUser } from '../middleware/auth.js';
import {
  clearLoginFailures,
  loginRateLimit,
  recordLoginFailure,
} from '../middleware/login-rate-limit.js';
import { clientIp } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128),
});

interface PublicUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
}

function publicUser(user: { id: string; email: string; role: PublicUser['role'] }): PublicUser {
  return { id: user.id, email: user.email, role: user.role };
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Dummy hash so login timing does not reveal whether an email exists. */
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHashPromise;
}

async function issueSession(
  c: Context<AppEnv>,
  user: { id: string; email: string; role: 'admin' | 'member'; tokenVersion: number },
): Promise<void> {
  const token = await signSessionToken(
    { sub: user.id, email: user.email, role: user.role, ver: user.tokenVersion },
    c.get('env').AUTH_SECRET,
    c.get('env').SESSION_MAX_AGE_SECONDS,
  );
  setSessionCookie(c, token);
}

const registerHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = registerSchema.parse(await c.req.json());
  const db = requireDb(c);

  const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  if (existing) {
    throw new AppError('CONFLICT', 'email already registered', 409);
  }

  const [user] = await db
    .insert(users)
    .values({ email: body.email, passwordHash: await hashPassword(body.password) })
    .returning();
  if (!user) {
    throw new AppError('INTERNAL_ERROR', 'failed to create user', 500);
  }

  const ip = clientIp(c);
  await recordAuditLog(db, {
    actorUserId: user.id,
    action: 'user_registered',
    targetType: 'user',
    targetId: user.id,
    ipHash: ipHashOf(ip),
  });

  await issueSession(c, user);
  return c.json({ user: publicUser(user) }, 201);
};

const loginHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = loginSchema.parse(await c.req.json());
  const db = requireDb(c);
  const ip = clientIp(c);

  const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash()));

  if (!user || !passwordOk) {
    recordLoginFailure(ip, body.email);
    await recordSecurityEvent(db, {
      userId: user?.id,
      eventType: 'login_failed',
      severity: 'warning',
      metadata: { email: body.email },
    });
    throw new AppError('UNAUTHORIZED', 'invalid email or password', 401);
  }
  if (user.status !== 'active') {
    throw new AppError('UNAUTHORIZED', 'account disabled', 401);
  }

  clearLoginFailures(ip, body.email);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAuditLog(db, {
    actorUserId: user.id,
    action: 'user_logged_in',
    targetType: 'user',
    targetId: user.id,
    ipHash: ipHashOf(ip),
  });

  await issueSession(c, user);
  return c.json({ user: publicUser(user) });
};

const logoutHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const user = c.get('user')!;
  const db = requireDb(c);

  // Invalidate every session token issued for this user.
  await db
    .update(users)
    .set({ tokenVersion: user.tokenVersion + 1 })
    .where(eq(users.id, user.id));

  await recordAuditLog(db, {
    actorUserId: user.id,
    action: 'user_logged_out',
    targetType: 'user',
    targetId: user.id,
    ipHash: ipHashOf(clientIp(c)),
  });
  clearSessionCookie(c);
  return c.json({ ok: true });
};

const forgotPasswordHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = forgotPasswordSchema.parse(await c.req.json());
  const db = requireDb(c);

  // Identical response whether or not the email exists — existence is never
  // revealed (docs/security.md).
  const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
  let debugToken: string | undefined;
  if (user) {
    const raw = randomBytes(32).toString('base64url');
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(raw),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });
    await recordAuditLog(db, {
      actorUserId: user.id,
      action: 'password_reset_requested',
      targetType: 'user',
      targetId: user.id,
      ipHash: ipHashOf(clientIp(c)),
    });
    if (c.get('env').NODE_ENV !== 'production') {
      // PLACEHOLDER — email transport arrives in a later phase. The token is
      // returned for local development only, never in production.
      debugToken = raw;
    }
  }
  return c.json({ ok: true, ...(debugToken ? { debug: { resetToken: debugToken } } : {}) });
};

const resetPasswordHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const body = resetPasswordSchema.parse(await c.req.json());
  const db = requireDb(c);

  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashResetToken(body.token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!record) {
    throw new AppError('VALIDATION_ERROR', 'invalid or expired password reset token', 400);
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(body.password),
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, record.userId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  await recordAuditLog(db, {
    actorUserId: record.userId,
    action: 'password_reset_completed',
    targetType: 'user',
    targetId: record.userId,
    ipHash: ipHashOf(clientIp(c)),
  });
  return c.json({ ok: true });
};

const meHandler = async (c: Context<AppEnv>): Promise<Response> => {
  const db = requireDb(c);
  const current = await db.query.users.findFirst({ where: eq(users.id, c.get('user')!.id) });
  if (!current) {
    throw new AppError('UNAUTHORIZED', 'session user no longer exists', 401);
  }
  return c.json({ user: publicUser(current) });
};

export const authRoutes = new Hono<AppEnv>()
  .post('/api/auth/register', registerHandler)
  .post('/api/auth/login', loginRateLimit(), loginHandler)
  .post('/api/auth/logout', requireUser, logoutHandler)
  .post('/api/auth/forgot-password', forgotPasswordHandler)
  .post('/api/auth/reset-password', resetPasswordHandler)
  .get('/api/me', requireUser, meHandler);
