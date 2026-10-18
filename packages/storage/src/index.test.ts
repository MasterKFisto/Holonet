import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStorageProviderFromEnv,
  getOssCredentialsProvider,
  setOssCredentialsProvider,
  type StorageProvider,
} from './index.js';
import type { AlibabaOssConfig } from './oss.js';

describe('@holonet/storage provider factory', () => {
  it('defaults to the fs provider', () => {
    const previous = process.env.STORAGE_PROVIDER;
    delete process.env.STORAGE_PROVIDER;
    try {
      const provider: StorageProvider = createStorageProviderFromEnv('public');
      expect(provider.kind).toBe('fs');
      expect(provider.bucket).toBe('public');
    } finally {
      if (previous !== undefined) {
        process.env.STORAGE_PROVIDER = previous;
      }
    }
  });

  it('rejects unknown providers', () => {
    process.env.STORAGE_PROVIDER = 'nope';
    try {
      expect(() => createStorageProviderFromEnv('public')).toThrow(/unknown STORAGE_PROVIDER/);
    } finally {
      delete process.env.STORAGE_PROVIDER;
    }
  });

  it('OSS provider requires region and bucket from the environment', () => {
    const previousProvider = process.env.STORAGE_PROVIDER;
    const region = process.env.OSS_REGION;
    const fallback = process.env.ALIBABA_CLOUD_REGION;
    const bucket = process.env.OSS_PUBLIC_BUCKET;
    process.env.STORAGE_PROVIDER = 'oss';
    delete process.env.OSS_REGION;
    delete process.env.ALIBABA_CLOUD_REGION;
    delete process.env.OSS_PUBLIC_BUCKET;
    try {
      expect(() => createStorageProviderFromEnv('public')).toThrow(/OSS_REGION/);
    } finally {
      delete process.env.STORAGE_PROVIDER;
      if (previousProvider !== undefined) {
        process.env.STORAGE_PROVIDER = previousProvider;
      }
      if (region !== undefined) {
        process.env.OSS_REGION = region;
      }
      if (fallback !== undefined) {
        process.env.ALIBABA_CLOUD_REGION = fallback;
      }
      if (bucket !== undefined) {
        process.env.OSS_PUBLIC_BUCKET = bucket;
      }
    }
  });
});

describe('OSS credentials provider registration', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function setOssEnv(overrides: Record<string, string | undefined>): void {
    const keys = [
      'STORAGE_PROVIDER',
      'OSS_REGION',
      'OSS_PUBLIC_BUCKET',
      'OSS_ACCESS_KEY_ID',
      'OSS_ACCESS_KEY_SECRET',
    ];
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.STORAGE_PROVIDER = 'oss';
    process.env.OSS_REGION = 'cn-hangzhou';
    process.env.OSS_PUBLIC_BUCKET = 'holonet-public';
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  afterEach(() => {
    setOssCredentialsProvider(undefined);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
      delete savedEnv[key];
    }
  });

  it('registers and clears the process-wide provider', () => {
    expect(getOssCredentialsProvider()).toBeUndefined();
    const provider = () => undefined;
    setOssCredentialsProvider(provider);
    expect(getOssCredentialsProvider()).toBe(provider);
    setOssCredentialsProvider(undefined);
    expect(getOssCredentialsProvider()).toBeUndefined();
  });

  it('attaches the registered provider when no static keys are configured', () => {
    setOssEnv({});
    const provider = vi.fn(() => undefined);
    setOssCredentialsProvider(provider);
    const storage = createStorageProviderFromEnv('public');
    expect(storage.kind).toBe('oss');
    // Runtime peek at the TS-private config to assert the wiring.
    const config = (storage as unknown as { config: AlibabaOssConfig }).config;
    expect(config.credentialsProvider).toBe(provider);
    expect(config.accessKeyId).toBeUndefined();
  });

  it('prefers static env keys over the registered provider (local testing)', () => {
    setOssEnv({ OSS_ACCESS_KEY_ID: 'local-key', OSS_ACCESS_KEY_SECRET: 'local-secret' });
    setOssCredentialsProvider(() => undefined);
    const storage = createStorageProviderFromEnv('public');
    const config = (storage as unknown as { config: AlibabaOssConfig }).config;
    expect(config.credentialsProvider).toBeUndefined();
    expect(config.accessKeyId).toBe('local-key');
  });
});
