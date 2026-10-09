import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with Node.js crypto scrypt (no native modules — deploys
 * cleanly to Function Compute). Stored format embeds the salt:
 *   `scrypt$<salt hex>$<hash hex>`
 * Plaintext passwords are never stored or logged.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const STORED_FORMAT = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function scryptAsync(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise(derivedKey);
      }
    });
  });
}

/** Hashes a password; returns `scrypt$<salt hex>$<hash hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification of a password against a stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = STORED_FORMAT.exec(stored);
  if (!match) {
    return false;
  }
  const salt = Buffer.from(match[1]!, 'hex');
  const expected = Buffer.from(match[2]!, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
