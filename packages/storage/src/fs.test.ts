import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFsStorageProvider, type FsStorageProvider } from './fs.js';

let dir: string;
let storage: FsStorageProvider;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holonet-storage-'));
  storage = createFsStorageProvider({
    rootDir: dir,
    bucket: 'public',
    publicBaseUrl: 'http://localhost:3000/',
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FsStorageProvider', () => {
  it('round-trips objects with content type and cache control', async () => {
    await storage.putObject('media/public/ws-1/assets/a-1.png', Buffer.from('png-bytes'), {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    const object = await storage.getObject('media/public/ws-1/assets/a-1.png');
    expect(object).not.toBeNull();
    expect(object!.body.toString('utf8')).toBe('png-bytes');
    expect(object!.contentType).toBe('image/png');
  });

  it('returns null for missing keys', async () => {
    expect(await storage.getObject('media/public/ws-1/nope.png')).toBeNull();
  });

  it('deletes objects', async () => {
    await storage.putObject('media/public/ws-1/a.txt', Buffer.from('x'), {
      contentType: 'text/plain',
    });
    await storage.deleteObject('media/public/ws-1/a.txt');
    expect(await storage.getObject('media/public/ws-1/a.txt')).toBeNull();
  });

  it('lists objects under a prefix, sorted', async () => {
    await storage.putObject('media/public/ws-1/index.html', Buffer.from('1'), {
      contentType: 'text/html',
    });
    await storage.putObject('media/public/ws-1/css/app.css', Buffer.from('2'), {
      contentType: 'text/css',
    });
    await storage.putObject('media/public/ws-2/index.html', Buffer.from('3'), {
      contentType: 'text/html',
    });
    expect(await storage.listObjects('media/public/ws-1')).toEqual([
      'media/public/ws-1/css/app.css',
      'media/public/ws-1/index.html',
    ]);
  });

  it('builds public and signed URLs', async () => {
    const key = 'media/public/ws-1/assets/a-1.png';
    expect(storage.getPublicUrl(key)).toBe('http://localhost:3000/storage/public/' + key);
    expect(await storage.getSignedUrl(key, 600)).toBe(storage.getPublicUrl(key));
  });

  it('stores files under the configured root (dev: .holonet-storage)', async () => {
    const key = 'media/public/ws-1/assets/a-1.png';
    await storage.putObject(key, Buffer.from('x'), { contentType: 'image/png' });
    const { readFile } = await import('node:fs/promises');
    const { join: pathJoin } = await import('node:path');
    const bytes = await readFile(pathJoin(dir, 'public', ...key.split('/')));
    expect(bytes.toString('utf8')).toBe('x');
  });

  it('rejects traversal keys', async () => {
    await expect(
      storage.putObject('../../etc/passwd', Buffer.from('x'), { contentType: 'text/plain' }),
    ).rejects.toThrow(/traversal|relative/);
  });
});
