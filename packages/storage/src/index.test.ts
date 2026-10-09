import { describe, expect, it } from 'vitest';
import { createStorageProviderFromEnv, type StorageProvider } from './index.js';

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
