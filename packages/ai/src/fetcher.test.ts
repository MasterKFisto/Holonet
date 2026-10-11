import { describe, expect, it } from 'vitest';
import { fetchSitePages, robotsDisallows, type FetchDeps, type ResponseLike } from './index.js';

function htmlResponse(
  body: string,
  extra: Partial<{
    status: number;
    contentType: string;
    location: string;
    contentLength: number;
  }> = {},
): ResponseLike {
  const headers = new Map<string, string>();
  headers.set('content-type', extra.contentType ?? 'text/html; charset=utf-8');
  if (extra.location) {
    headers.set('location', extra.location);
  }
  if (extra.contentLength !== undefined) {
    headers.set('content-length', String(extra.contentLength));
  }
  return {
    status: extra.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body,
    url: '',
  };
}

function makeDeps(
  pages: Record<string, ResponseLike>,
  onRequest?: (url: string) => void,
): FetchDeps {
  return {
    resolveHost: async () => ['93.184.216.34'],
    fetchUrl: async (url) => {
      onRequest?.(url);
      const response = pages[url];
      if (!response) {
        return htmlResponse('', { status: 404 });
      }
      return response;
    },
  };
}

const SOURCE = 'https://example.com/';

describe('@holonet/ai fetchSitePages', () => {
  it('fetches up to maxPages pages via same-origin links only', async () => {
    const requested: string[] = [];
    const deps = makeDeps(
      {
        'https://example.com/robots.txt': htmlResponse('User-agent: *\nDisallow:\n'),
        [SOURCE]: htmlResponse(
          `<html><head><title>Home</title></head><body><a href="/about">A</a><a href="/contact">B</a></body></html>`,
        ),
        'https://example.com/about': htmlResponse(
          `<html><head><title>About</title></head><body><a href="/team">T</a><a href="https://evil.com/x">X</a></body></html>`,
        ),
        'https://example.com/contact': htmlResponse(
          `<html><head><title>Contact</title></head><body></body></html>`,
        ),
        'https://example.com/team': htmlResponse(
          `<html><head><title>Team</title></head><body></body></html>`,
        ),
      },
      (url) => requested.push(url),
    );

    const result = await fetchSitePages(SOURCE, deps);
    // maxPages = 3 → home, about, contact. /team must not be fetched.
    expect(result.pages.map((page) => page.url)).toEqual([
      SOURCE,
      'https://example.com/about',
      'https://example.com/contact',
    ]);
    expect(result.robots.checked).toBe(true);
    expect(result.robots.disallowed).toBe(false);
    expect(requested).not.toContain('https://example.com/team');
    expect(requested).not.toContain('https://evil.com/x');
  });

  it('rejects when robots.txt disallows the target path', async () => {
    const deps = makeDeps({
      'https://example.com/robots.txt': htmlResponse('User-agent: *\nDisallow: /private\n'),
      [SOURCE]: htmlResponse('<html></html>'),
    });
    await expect(fetchSitePages('https://example.com/private/page', deps)).rejects.toMatchObject({
      code: 'robots-disallowed',
    });
  });

  it('refuses authenticated pages and paywalls (no credential support)', async () => {
    await expect(
      fetchSitePages(
        SOURCE,
        makeDeps({
          'https://example.com/robots.txt': htmlResponse('', { status: 404 }),
          [SOURCE]: htmlResponse('', { status: 401 }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'auth-required' });

    await expect(
      fetchSitePages(
        SOURCE,
        makeDeps({
          'https://example.com/robots.txt': htmlResponse('', { status: 404 }),
          [SOURCE]: htmlResponse('', { status: 402 }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'paywall' });
  });

  it('skips pages over the declared size cap without reading their body', async () => {
    let bodyRead = false;
    const oversized: ResponseLike = {
      status: 200,
      headers: {
        get: (name: string) => (name === 'content-length' ? String(6 * 1024 * 1024) : 'text/html'),
      },
      text: async () => {
        bodyRead = true;
        return '<html></html>';
      },
      url: '',
    };
    const deps = makeDeps({
      'https://example.com/robots.txt': htmlResponse('', { status: 404 }),
      [SOURCE]: oversized,
    });
    const result = await fetchSitePages(SOURCE, deps);
    expect(result.pages).toHaveLength(0);
    expect(bodyRead).toBe(false); // the 6 MiB page was never downloaded
  });

  it('skips pages that exceed the cap after download but still crawls their links', async () => {
    const bigBody = `<html><body><a href="/about">about</a>${'x'.repeat(6 * 1024 * 1024)}</body></html>`;
    const deps = makeDeps({
      'https://example.com/robots.txt': htmlResponse('', { status: 404 }),
      [SOURCE]: htmlResponse(bigBody),
      'https://example.com/about': htmlResponse('<html><head><title>About</title></head></html>'),
    });
    const result = await fetchSitePages(SOURCE, deps);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.url).toBe('https://example.com/about');
  });

  it('revalidates every redirect hop (no redirect-based SSRF)', async () => {
    const requested: string[] = [];
    const deps = makeDeps(
      {
        'https://example.com/robots.txt': htmlResponse('', { status: 404 }),
        [SOURCE]: htmlResponse('', {
          status: 302,
          location: 'http://169.254.169.254/latest/meta-data/',
        }),
      },
      (url) => requested.push(url),
    );
    await expect(fetchSitePages(SOURCE, deps)).rejects.toMatchObject({
      code: 'cross-origin-redirect',
    });
    // The metadata endpoint is never contacted.
    expect(requested.some((url) => url.includes('169.254.169.254'))).toBe(false);
  });

  it('sends only the importer user-agent — never credentials', async () => {
    const seen: unknown[] = [];
    const deps: FetchDeps = {
      resolveHost: async () => ['93.184.216.34'],
      fetchUrl: async (_url, init) => {
        seen.push(init);
        return htmlResponse('<html></html>');
      },
    };
    await fetchSitePages(SOURCE, deps);
    for (const init of seen) {
      const record = init as { signal?: unknown; headers?: Record<string, string> };
      expect(Object.keys(record).sort()).toEqual(['headers', 'signal']);
      expect(record.headers?.['user-agent']).toBe('HolonetImporter/0.1');
      expect(Object.keys(record.headers ?? {})).toEqual(['user-agent', 'accept']);
    }
  });
});

describe('@holonet/ai robotsDisallows', () => {
  it('parses wildcard user-agent rules', () => {
    expect(robotsDisallows('User-agent: *\nDisallow: /admin\n', '/admin/login')).toBe(true);
    expect(robotsDisallows('User-agent: *\nDisallow: /\n', '/')).toBe(true);
    expect(robotsDisallows('User-agent: *\nDisallow: /admin\n', '/about')).toBe(false);
    expect(robotsDisallows('User-agent: Googlebot\nDisallow: /private\n', '/private')).toBe(false);
  });
});
