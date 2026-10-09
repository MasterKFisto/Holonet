import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('@holonet/security password hashing (scrypt)', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');
    expect(first).not.toBe(second);
    expect(await verifyPassword('same password', first)).toBe(true);
    expect(await verifyPassword('same password', second)).toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
  });
});
