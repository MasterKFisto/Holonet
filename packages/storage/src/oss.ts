import OSS from 'ali-oss';
import { assertSafePrefix, assertValidKey } from './keys.js';
import type { PutObjectOptions, StorageObject, StorageProvider } from './provider.js';

/** Temporary (STS) credentials — e.g. the Function Compute execution RAM role. */
export interface OssCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export interface AlibabaOssConfig {
  region: string;
  /** Custom endpoint (OSS_ENDPOINT); defaults to the public regional endpoint. */
  endpoint?: string;
  bucket: string;
  /**
   * Static credentials for local testing only. On Function Compute these are
   * absent and credentials come from `credentialsProvider` instead.
   */
  accessKeyId?: string;
  accessKeySecret?: string;
  /**
   * Dynamic credentials source used when no static keys are configured. On
   * Function Compute this returns the RAM-role STS credentials captured from
   * the invocation context (registered via `setOssCredentialsProvider`).
   * The resolved client is cached for `credentialsRefreshMs`.
   */
  credentialsProvider?: () => OssCredentials | undefined;
  /** RAM role ARN (informational — the execution role is attached to the function). */
  roleArn?: string;
  /** Base URL used by getPublicUrl (defaults to the bucket's public endpoint). */
  publicBaseUrl?: string;
  /** Test hook: custom client factory receiving the resolved credentials. */
  clientFactory?: (credentials: OssCredentials | undefined) => OSS;
  /** Test hook: how long a dynamically-built client is reused (default 4 min). */
  credentialsRefreshMs?: number;
}

/** FC STS credentials rotate; rebuilding the client every few minutes is cheap. */
const DEFAULT_CREDENTIALS_REFRESH_MS = 4 * 60 * 1000;

function isNoSuchKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'NoSuchKey'
  );
}

function buildClient(config: AlibabaOssConfig, credentials: OssCredentials | undefined): OSS {
  const factory =
    config.clientFactory ??
    ((creds: OssCredentials | undefined) =>
      new OSS({
        region: config.region,
        bucket: config.bucket,
        endpoint: config.endpoint,
        secure: true,
        // Empty strings when absent: the SDK then relies on environment
        // credentials (local fallback only).
        accessKeyId: creds?.accessKeyId ?? '',
        accessKeySecret: creds?.accessKeySecret ?? '',
        ...(creds?.securityToken ? { stsToken: creds.securityToken } : {}),
      }));
  return factory(credentials);
}

/**
 * Alibaba Cloud OSS storage provider for production (STORAGE_PROVIDER=oss),
 * backed by the official ali-oss SDK. Credentials are never hardcoded —
 * they come from the environment (rules 10/11).
 */
export class AlibabaOssStorageProvider implements StorageProvider {
  readonly kind = 'oss' as const;
  readonly bucket: string;

  private readonly config: AlibabaOssConfig;
  private readonly injectedClient?: OSS;
  private readonly staticClient?: OSS;
  private dynamicClient?: OSS;
  private dynamicClientBuiltAt = 0;
  private readonly publicBaseUrl: string;

  /** `client` is injectable for tests; production uses the real SDK client. */
  constructor(config: AlibabaOssConfig, client?: OSS) {
    this.config = config;
    this.bucket = config.bucket;
    this.publicBaseUrl = (
      config.publicBaseUrl ?? `https://${config.bucket}.oss-${config.region}.aliyuncs.com`
    ).replace(/\/+$/, '');
    this.injectedClient = client;
    // Static credentials (local testing): build once, eagerly. Without static
    // keys the client is built lazily from `credentialsProvider` (FC STS) and
    // refreshed on a TTL so rotated credentials are picked up.
    if (!client && config.accessKeyId && config.accessKeySecret) {
      this.staticClient = buildClient(config, {
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
      });
    }
  }

  private resolveClient(): OSS {
    if (this.injectedClient) {
      return this.injectedClient;
    }
    if (this.staticClient) {
      return this.staticClient;
    }
    const refreshMs = this.config.credentialsRefreshMs ?? DEFAULT_CREDENTIALS_REFRESH_MS;
    const now = Date.now();
    if (!this.dynamicClient || now - this.dynamicClientBuiltAt >= refreshMs) {
      this.dynamicClient = buildClient(this.config, this.config.credentialsProvider?.());
      this.dynamicClientBuiltAt = now;
    }
    return this.dynamicClient;
  }

  async putObject(key: string, body: Buffer, options?: PutObjectOptions): Promise<void> {
    assertValidKey(key);
    await this.resolveClient().put(key, body, {
      mime: options?.contentType,
      headers: options?.cacheControl ? { 'Cache-Control': options.cacheControl } : undefined,
    });
  }

  async getObject(key: string): Promise<StorageObject | null> {
    assertValidKey(key);
    try {
      const result = await this.resolveClient().get(key);
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
    await this.resolveClient().delete(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    assertSafePrefix(prefix);
    const result = await this.resolveClient().list({ prefix, 'max-keys': 1000 }, {});
    return (result.objects ?? []).map((object) => object.name);
  }

  getPublicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl}/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertValidKey(key);
    return this.resolveClient().signatureUrl(key, { expires: expiresInSeconds });
  }
}

export function createAlibabaOssStorageProvider(
  config: AlibabaOssConfig,
  client?: OSS,
): AlibabaOssStorageProvider {
  return new AlibabaOssStorageProvider(config, client);
}
