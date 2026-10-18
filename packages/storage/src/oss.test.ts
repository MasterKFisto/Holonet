import { describe, expect, it, vi } from 'vitest';
import type OSS from 'ali-oss';
import {
  createAlibabaOssStorageProvider,
  type AlibabaOssStorageProvider,
  type OssCredentials,
} from './oss.js';

/**
 * Mocked OSS client — no network access. Tests the provider's request
 * mapping and URL construction against the ali-oss client interface.
 */
function mockClient() {
  return {
    put: vi.fn(async () => ({})),
    get: vi.fn(async (_name: string) => ({
      content: Buffer.from('object-bytes'),
      res: { headers: { 'content-type': 'image/png' } },
    })),
    delete: vi.fn(async () => ({})),
    list: vi.fn(async () => ({
      objects: [{ name: 'media/public/ws-1/a.png' }, { name: 'media/public/ws-1/b.css' }],
    })),
    signatureUrl: vi.fn((name: string, options: { expires: number }) => {
      return `https://bucket.example/${name}?expires=${options.expires}&signed`;
    }),
  } as unknown as OSS;
}

const config = {
  region: 'cn-hangzhou',
  bucket: 'holonet-public',
  publicBaseUrl: 'https://holonet-public.example.com',
};

describe('AlibabaOssStorageProvider (mocked client)', () => {
  it('puts objects with content type and cache control headers', async () => {
    const client = mockClient();
    const storage: AlibabaOssStorageProvider = createAlibabaOssStorageProvider(config, client);
    await storage.putObject('media/public/ws-1/a.png', Buffer.from('x'), {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(client.put).toHaveBeenCalledTimes(1);
    const [name, , options] = (client.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(name).toBe('media/public/ws-1/a.png');
    expect(options).toMatchObject({
      mime: 'image/png',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  });

  it('gets objects and maps NoSuchKey to null', async () => {
    const client = mockClient();
    const storage = createAlibabaOssStorageProvider(config, client);

    const object = await storage.getObject('media/public/ws-1/a.png');
    expect(object).toEqual({
      key: 'media/public/ws-1/a.png',
      body: Buffer.from('object-bytes'),
      contentType: 'image/png',
    });

    (client.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: 'NoSuchKey' });
    expect(await storage.getObject('media/public/ws-1/missing.png')).toBeNull();
  });

  it('lists object names', async () => {
    const client = mockClient();
    const storage = createAlibabaOssStorageProvider(config, client);
    expect(await storage.listObjects('media/public/ws-1')).toEqual([
      'media/public/ws-1/a.png',
      'media/public/ws-1/b.css',
    ]);
  });

  it('builds public URLs from the public base URL', () => {
    const storage = createAlibabaOssStorageProvider(config, mockClient());
    expect(storage.getPublicUrl('media/public/ws-1/a.png')).toBe(
      'https://holonet-public.example.com/media/public/ws-1/a.png',
    );
  });

  it('signs URLs with the given expiry', async () => {
    const client = mockClient();
    const storage = createAlibabaOssStorageProvider(config, client);
    expect(await storage.getSignedUrl('media/public/ws-1/a.png', 600)).toBe(
      'https://bucket.example/media/public/ws-1/a.png?expires=600&signed',
    );
    expect(client.signatureUrl).toHaveBeenCalledWith('media/public/ws-1/a.png', { expires: 600 });
  });

  it('validates keys before any client call', async () => {
    const client = mockClient();
    const storage = createAlibabaOssStorageProvider(config, client);
    await expect(storage.putObject('../escape', Buffer.from('x'))).rejects.toThrow(
      /relative|traversal/,
    );
    expect(client.put).not.toHaveBeenCalled();
  });
});

describe('AlibabaOssStorageProvider credentials', () => {
  it('builds the client from the credentials provider (FC STS) lazily', async () => {
    const seen: Array<OssCredentials | undefined> = [];
    const clientFactory = vi.fn((credentials: OssCredentials | undefined) => {
      seen.push(credentials);
      return mockClient();
    });
    const storage = createAlibabaOssStorageProvider({
      ...config,
      credentialsProvider: () => ({
        accessKeyId: 'STS.key-id',
        accessKeySecret: 'STS.secret',
        securityToken: 'STS.token',
      }),
      clientFactory,
    });

    await storage.putObject('media/public/ws-1/a.png', Buffer.from('x'));
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({
      accessKeyId: 'STS.key-id',
      accessKeySecret: 'STS.secret',
      securityToken: 'STS.token',
    });
  });

  it('reuses the dynamic client within the refresh window and rebuilds after it', async () => {
    const clientFactory = vi.fn((_credentials: OssCredentials | undefined) => mockClient());
    const cached = createAlibabaOssStorageProvider({
      ...config,
      credentialsProvider: () => ({
        accessKeyId: 'STS.key-id',
        accessKeySecret: 'STS.secret',
      }),
      clientFactory,
    });
    await cached.putObject('media/public/ws-1/a.png', Buffer.from('x'));
    await cached.putObject('media/public/ws-1/b.png', Buffer.from('y'));
    expect(clientFactory).toHaveBeenCalledTimes(1);

    const refreshing = createAlibabaOssStorageProvider({
      ...config,
      credentialsProvider: () => ({
        accessKeyId: 'STS.key-id',
        accessKeySecret: 'STS.secret',
      }),
      clientFactory,
      credentialsRefreshMs: 0,
    });
    await refreshing.putObject('media/public/ws-1/a.png', Buffer.from('x'));
    await refreshing.putObject('media/public/ws-1/b.png', Buffer.from('y'));
    expect(clientFactory).toHaveBeenCalledTimes(3);
  });

  it('builds static-key clients once, eagerly, without the credentials provider', async () => {
    const credentialsProvider = vi.fn(() => undefined);
    const clientFactory = vi.fn((_credentials: OssCredentials | undefined) => mockClient());
    const storage = createAlibabaOssStorageProvider({
      ...config,
      accessKeyId: 'local-key',
      accessKeySecret: 'local-secret',
      credentialsProvider,
      clientFactory,
    });
    expect(clientFactory).toHaveBeenCalledTimes(1);
    await storage.putObject('media/public/ws-1/a.png', Buffer.from('x'));
    await storage.putObject('media/public/ws-1/b.png', Buffer.from('y'));
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(credentialsProvider).not.toHaveBeenCalled();
  });

  it('passes undefined credentials to the factory when the provider has none', async () => {
    const seen: Array<OssCredentials | undefined> = [];
    const storage = createAlibabaOssStorageProvider({
      ...config,
      credentialsProvider: () => undefined,
      clientFactory: (credentials) => {
        seen.push(credentials);
        return mockClient();
      },
    });
    await storage.putObject('media/public/ws-1/a.png', Buffer.from('x'));
    expect(seen).toEqual([undefined]);
  });
});
