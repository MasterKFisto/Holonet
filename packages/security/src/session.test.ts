import { describe, expect, it } from 'vitest';
import { signSessionToken, verifySessionToken } from './session.js';

const SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';

const claims = { sub: 'user-1', email: 'user@holonet.local', role: 'member' as const, ver: 3 };

describe('@holonet/security session tokens (jose HS256)', () => {
  it('round-trips claims', async () => {
    const token = await signSessionToken(claims, SECRET, 3600);
    expect(await verifySessionToken(token, SECRET)).toEqual(claims);
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await signSessionToken({ ...claims, role: 'admin' as const }, SECRET, 3600);
    const other = 'another-secret-with-at-least-thirty-two-bytes!!';
    expect(await verifySessionToken(token, other)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await signSessionToken(claims, SECRET, -10);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySessionToken('not.a.jwt', SECRET)).toBeNull();
  });
});
