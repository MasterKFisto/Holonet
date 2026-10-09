import OSS from 'ali-oss';
import { assertSafePrefix, assertValidKey } from './keys.js';
import type { PutObjectOptions, StorageObject, StorageProvider } from './provider.js';

export interface AlibabaOssConfig {
  region: string;
  /** Custom endpoint (OSS_ENDPOINT); defaults to the public regional endpoint. */
  endpoint?: string;
  bucket: string;
  /** Present for local testing; on Function Compute credentials come from the
   * RAM role via STS — PLACEHOLDER, wired in the deployment phase. */
  accessKeyId?: string;
  accessKeySecret?: string;
  /** RAM role ARN used for STS credentials on Function Compute (optional). */
  roleArn?: string;
  /** Base URL used by getPublicUrl (defaults to the bucket's public endpoint). */
  publicBaseUrl?: string;
}

function isNoSuchKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'NoSuchKey'
  );
}

/**
 * Alibaba Cloud OSS storage provider for production (STORAGE_PROVIDER=oss),
 * backed by the official ali-oss SDK. Credentials are never hardcoded —
 * they come from the environment (rules 10/11).
 */
export class AlibabaOssStorageProvider implements StorageProvider {
  readonly kind = 'oss' as const;
  readonly bucket: string;

  private readonly client: OSS;
  private readonly publicBaseUrl: string;

  /** `client` is injectable for tests; production uses the real SDK client. */
  constructor(config: AlibabaOssConfig, client?: OSS) {
    this.bucket = config.bucket;
    this.publicBaseUrl = (
      config.publicBaseUrl ?? `https://${config.bucket}.oss-${config.region}.aliyuncs.com`
    ).replace(/\/+$/, '');
    // roleArn is carried in config for the FC STS wiring (PLACEHOLDER).
    void config.roleArn;
    this.client =
      client ??
      new OSS({
        region: config.region,
        bucket: config.bucket,
        endpoint: config.endpoint,
        secure: true,
        // Empty strings when absent: the SDK then relies on environment
        // credentials or the RAM-role STS metadata.
        accessKeyId: config.accessKeyId ?? '',
        accessKeySecret: config.accessKeySecret ?? '',
      });
  }

  async putObject(key: string, body: Buffer, options?: PutObjectOptions): Promise<void> {
    assertValidKey(key);
    await this.client.put(key, body, {
      mime: options?.contentType,
      headers: options?.cacheControl ? { 'Cache-Control': options.cacheControl } : undefined,
    });
  }

  async getObject(key: string): Promise<StorageObject | null> {
    assertValidKey(key);
    try {
      const result = await this.client.get(key);
      const body = Buffer.isBuffer(result.content)
        ? result.content
        : Buffer.from(String(result.content ?? ''));
      const headers = result.res?.headers as Record<string, string> | undefined;
      const contentType = headers?.['content-type'] ?? 'application/octet-stream';
      return { key, body, contentType };
    } catch (error) {
      if (isNoSuchKey(error)) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.delete(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    assertSafePrefix(prefix);
    const result = await this.client.list({ prefix, 'max-keys': 1000 }, {});
    return (result.objects ?? []).map((object) => object.name);
  }

  getPublicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl}/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertValidKey(key);
    return this.client.signatureUrl(key, { expires: expiresInSeconds });
  }
}

export function createAlibabaOssStorageProvider(
  config: AlibabaOssConfig,
  client?: OSS,
): AlibabaOssStorageProvider {
  return new AlibabaOssStorageProvider(config, client);
}
