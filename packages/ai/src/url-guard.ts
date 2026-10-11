import { isIP } from 'node:net';

export type ImportErrorCode =
  | 'invalid-url'
  | 'blocked-host'
  | 'unresolvable-host'
  | 'robots-disallowed'
  | 'auth-required'
  | 'paywall'
  | 'rate-limited'
  | 'cross-origin-redirect'
  | 'fetch-failed';

/** Typed importer failure — the API maps codes to job statuses. */
export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * SSRF guard for import source URLs (docs/security.md).
 *
 * A user-supplied URL is only accepted when it points at a public HTTP(S)
 * endpoint. Localhost, private/link-local/reserved IP ranges, cloud metadata
 * endpoints, credential-bearing URLs, non-standard ports, and malformed
 * domains are all rejected before any request is made.
 */

export interface ImportUrlValidation {
  ok: boolean;
  reason?: string;
  hostname?: string;
}

/** Hostnames that resolve to cloud/internal services and must never be fetched. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Parses an IPv4-mapped IPv6 address (::ffff:a.b.c.d) back to dotted form. */
function mappedIpv4(ip: string): string | undefined {
  const match = ip.toLowerCase().match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}.${match[4]}` : undefined;
}

/**
 * Returns true when the address is a globally routable unicast address.
 * Everything reserved for private, loopback, link-local, CGNAT, multicast,
 * documentation, or benchmarking use is rejected.
 */
export function isPublicIpAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) {
    return false;
  }

  if (family === 6) {
    const mapped = mappedIpv4(ip);
    if (mapped) {
      return isPublicIpAddress(mapped);
    }
    const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::' || normalized === '::1') {
      return false; // unspecified + loopback
    }
    const first = parseInt(normalized.split(':')[0] || '0', 16);
    if (Number.isNaN(first)) {
      return false;
    }
    // fc00::/7 — unique local addresses (RFC 4193).
    if ((first & 0xfe00) === 0xfc00) {
      return false;
    }
    // fe80::/10 — link local (RFC 4291).
    if ((first & 0xffc0) === 0xfe80) {
      return false;
    }
    // ff00::/8 — multicast.
    if ((first & 0xff00) === 0xff00) {
      return false;
    }
    // 2001:db8::/32 — documentation.
    if (normalized.startsWith('2001:db8')) {
      return false;
    }
    // 100::/64 — discard-only (RFC 6666).
    if (normalized.startsWith('100:') || normalized === '100::') {
      return false;
    }
    // 64:ff9b::/96 — NAT64 well-known prefix (RFC 6052).
    if (normalized.startsWith('64:ff9b::')) {
      return false;
    }
    return true;
  }

  // IPv4.
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return false;
  }
  const [a, b, c] = octets as [number, number, number];
  if (a === 0) {
    return false; // 0.0.0.0/8 — "this network"
  }
  if (a === 10) {
    return false; // 10.0.0.0/8 — private
  }
  if (a === 127) {
    return false; // 127.0.0.0/8 — loopback
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false; // 100.64.0.0/10 — CGNAT
  }
  if (a === 169 && b === 254) {
    return false; // 169.254.0.0/16 — link local (incl. 169.254.169.254 metadata)
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false; // 172.16.0.0/12 — private
  }
  if (a === 192 && b === 168) {
    return false; // 192.168.0.0/16 — private
  }
  if (a === 192 && b === 0 && c === 0) {
    return false; // 192.0.0.0/24 — IETF protocol assignments
  }
  if (a === 192 && b === 0 && c === 2) {
    return false; // 192.0.2.0/24 — TEST-NET-1
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false; // 198.18.0.0/15 — benchmarking
  }
  if (a === 198 && b === 51 && c === 100) {
    return false; // 198.51.100.0/24 — TEST-NET-2
  }
  if (a === 203 && b === 0 && c === 113) {
    return false; // 203.0.113.0/24 — TEST-NET-3
  }
  if (a >= 224) {
    return false; // multicast, reserved, limited broadcast
  }
  return true;
}

/** True when the URL passes all import SSRF checks. */
export function validateImportUrl(rawUrl: string): ImportUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https are allowed' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials in URLs are not allowed' };
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'only default ports (80/443) are allowed' };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '') {
    return { ok: false, reason: 'missing hostname' };
  }
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'blocked hostname' };
  }

  // WHATWG URLs keep IPv6 literals bracketed ([::1]) — strip before checks.
  const bareHost = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bareHost) > 0) {
    return isPublicIpAddress(bareHost)
      ? { ok: true, hostname: bareHost }
      : { ok: false, reason: 'hostname is a non-public IP address' };
  }

  // Domain names must be syntactically valid with a real TLD.
  const domainPattern = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainPattern.test(hostname)) {
    return { ok: false, reason: 'invalid domain' };
  }
  return { ok: true, hostname };
}
