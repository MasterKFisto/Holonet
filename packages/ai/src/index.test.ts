import { describe, expect, it } from 'vitest';
import { ImportError, validateImportUrl } from './index.js';

describe('@holonet/ai validateImportUrl', () => {
  it('accepts plain public http/https URLs', () => {
    expect(validateImportUrl('https://example.com').ok).toBe(true);
    expect(validateImportUrl('http://example.com/about').ok).toBe(true);
    expect(validateImportUrl('https://example.com:443/').ok).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(validateImportUrl('ftp://example.com').ok).toBe(false);
    expect(validateImportUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateImportUrl('gopher://example.com').ok).toBe(false);
  });

  it('rejects localhost and localhost subdomains', () => {
    expect(validateImportUrl('http://localhost:3000').ok).toBe(false);
    expect(validateImportUrl('http://api.localhost').ok).toBe(false);
    expect(validateImportUrl('http://foo.localhost.example.com').ok).toBe(true);
  });

  it('rejects private, loopback, and link-local IP literals', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254', // cloud metadata endpoint
      '169.254.1.1',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::808:808',
    ]) {
      expect(validateImportUrl(`http://${ip}/`).ok, `http://${ip}/ should be rejected`).toBe(false);
    }
  });

  it('accepts public IP literals', () => {
    expect(validateImportUrl('http://93.184.216.34/').ok).toBe(true);
    expect(validateImportUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/').ok).toBe(true);
  });

  it('rejects credentials and non-standard ports', () => {
    expect(validateImportUrl('https://user:pass@example.com').ok).toBe(false);
    expect(validateImportUrl('https://user@example.com').ok).toBe(false);
    expect(validateImportUrl('https://example.com:8443').ok).toBe(false);
    expect(validateImportUrl('http://example.com:8080').ok).toBe(false);
  });

  it('rejects malformed and invalid domains', () => {
    expect(validateImportUrl('not a url').ok).toBe(false);
    expect(validateImportUrl('https://').ok).toBe(false);
    expect(validateImportUrl('https://example').ok).toBe(false); // no TLD
    expect(validateImportUrl('https://example.c').ok).toBe(false); // 1-char TLD
    expect(validateImportUrl('https://-bad.example.com').ok).toBe(false);
    expect(validateImportUrl('https://metadata.google.internal').ok).toBe(false);
  });

  it('throws typed ImportError', () => {
    const error = new ImportError('invalid-url', 'nope');
    expect(error.code).toBe('invalid-url');
    expect(error.name).toBe('ImportError');
  });
});
