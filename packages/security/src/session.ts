import { SignJWT, jwtVerify } from 'jose';

/**
 * Session tokens: signed JWTs (HS256) verified with jose — pure JavaScript,
 * no native modules, safe for Function Compute.
 *
 * Claims: sub (user id), email, role. Signed with AUTH_SECRET (>= 32 chars).
 * Tokens are stateless; revocation is by AUTH_SECRET rotation (per-user
 * revocation is a later phase — see docs/security.md).
 */

export interface SessionClaims {
  sub: string;
  email: string;
  role: 'admin' | 'member';
  /** Session version — must match users.token_version (logout/reset bump it). */
  ver: number;
}

const encoder = new TextEncoder();

export async function signSessionToken(
  claims: SessionClaims,
  secret: string,
  maxAgeSeconds: number,
): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role, ver: claims.ver })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(encoder.encode(secret));
}

/** Verifies a session JWT; returns the claims, or null when invalid/expired. */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ['HS256'] });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      (payload.role !== 'admin' && payload.role !== 'member') ||
      typeof payload.ver !== 'number'
    ) {
      return null;
    }
    return { sub: payload.sub, email: payload.email, role: payload.role, ver: payload.ver };
  } catch {
    return null;
  }
}
