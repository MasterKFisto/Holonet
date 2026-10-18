import { Readable } from 'node:stream';
import * as FcSdk from '@alicloud/fc20230330';
import {
  InvokeFunctionHeaders,
  InvokeFunctionRequest,
  type InvokeFunctionResponse,
} from '@alicloud/fc20230330';
import { Config } from '@alicloud/openapi-core/dist/utils.js';
import { RuntimeOptions } from '@darabonba/typescript';
import { and, eq, sql } from 'drizzle-orm';
import { deployments, jobs } from '@holonet/db';
import { AppError } from '../lib/errors.js';
import { recordAuditLog, recordSecurityEvent } from '../lib/security.js';
import { getFcContext } from '../lib/fc-context.js';
import type { BuilderInvoker, BuilderInvokerDeps } from '../lib/builder-invoker.js';

/** The fc20230330 SDK client is a CJS module exporting the class as `.default`. */
interface FcSdkClientInstance {
  invokeFunctionWithOptions(
    functionName: string,
    request: InvokeFunctionRequest,
    headers: InvokeFunctionHeaders,
    runtime: RuntimeOptions,
  ): Promise<InvokeFunctionResponse>;
}

const FcSdkClient = (FcSdk as unknown as { default: new (config: unknown) => FcSdkClientInstance })
  .default;

/**
 * Function Compute builder invocation (BUILDER_INVOKER=fc).
 *
 * Invokes the holonet-builder fc3 function asynchronously
 * (x-fc-invocation-type: Async) with the payload { siteId, deploymentId }.
 * The HTTP request returns immediately; the builder function marks the
 * deployment (and its site_build job) completed or failed itself.
 *
 * Credential resolution order:
 *  1. Inside Function Compute: the temporary STS credentials captured from
 *     the FC context by the HTTP trigger adapter (lib/fc-context.ts) — these
 *     come from the FC execution RAM role (FC_ROLE_ARN).
 *  2. Local testing: OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET or
 *     ALIBABA_CLOUD_ACCESS_KEY_ID/ALIBABA_CLOUD_ACCESS_KEY_SECRET.
 *
 * Endpoint: `${accountId}.${region}.fc.aliyuncs.com`.
 *
 * On invocation failure the deployment and its site_build job are marked
 * failed (never left in `queued`), a security + audit event is recorded, and
 * a structured API error is raised.
 */

/** Narrow client contract — the real implementation wraps the fc3 SDK. */
export interface FcBuilderClient {
  invokeFunction(params: { functionName: string; payload: string }): Promise<{
    statusCode?: number;
  }>;
}

export interface FcBuilderCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export interface FcBuilderInvokerOptions {
  functionName?: string;
  region?: string;
  accountId?: string;
  /** Override for tests; defaults to the fc20230330 SDK client. */
  clientFactory?: (config: {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken?: string;
    endpoint: string;
    region: string;
  }) => FcBuilderClient;
  /** Override for tests; defaults to FC context → environment variables. */
  credentials?: () => FcBuilderCredentials;
}

/** Resolves credentials: FC context STS first, then local env fallback. */
export function resolveFcCredentials(): FcBuilderCredentials {
  const fc = getFcContext();
  const sts = fc?.credentials;
  if (sts?.accessKeyId && sts.accessKeySecret && sts.securityToken) {
    return {
      accessKeyId: sts.accessKeyId,
      accessKeySecret: sts.accessKeySecret,
      securityToken: sts.securityToken,
    };
  }
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret =
    process.env.OSS_ACCESS_KEY_SECRET ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if (accessKeyId && accessKeySecret) {
    return { accessKeyId, accessKeySecret };
  }
  throw new AppError(
    'INVALID_CONFIG',
    'no Function Compute credentials available (STS context or OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET)',
    500,
  );
}

/** Wraps the fc20230330 SDK client behind the narrow interface. */
function defaultFcClientFactory(config: {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
  endpoint: string;
  region: string;
}): FcBuilderClient {
  const client = new FcSdkClient(
    new Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      securityToken: config.securityToken,
      endpoint: config.endpoint,
      regionId: config.region,
    }),
  );
  return {
    async invokeFunction({ functionName, payload }) {
      const response: InvokeFunctionResponse = await client.invokeFunctionWithOptions(
        functionName,
        new InvokeFunctionRequest({ body: Readable.from([payload]), qualifier: 'LATEST' }),
        new InvokeFunctionHeaders({ xFcInvocationType: 'Async' }),
        new RuntimeOptions({}),
      );
      return { statusCode: response.statusCode };
    },
  };
}

export class FcBuilderInvoker implements BuilderInvoker {
  readonly kind = 'fc' as const;

  private readonly functionName: string;
  private readonly region: string;
  private readonly accountId: string;
  private readonly clientFactory: (config: {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken?: string;
    endpoint: string;
    region: string;
  }) => FcBuilderClient;
  private readonly credentials: () => FcBuilderCredentials;

  constructor(
    private readonly deps: BuilderInvokerDeps,
    options: FcBuilderInvokerOptions = {},
  ) {
    this.functionName =
      options.functionName ?? process.env.FC_FUNCTION_NAME_BUILDER ?? 'holonet-builder';
    this.region = options.region ?? process.env.ALIBABA_CLOUD_REGION ?? '';
    this.accountId = options.accountId ?? process.env.ALIBABA_CLOUD_ACCOUNT_ID ?? '';
    this.clientFactory = options.clientFactory ?? defaultFcClientFactory;
    this.credentials = options.credentials ?? resolveFcCredentials;
  }

  async invokeBuild(siteId: string, deploymentId: string): Promise<void> {
    if (!this.region || !this.accountId) {
      const message = 'ALIBABA_CLOUD_REGION/ALIBABA_CLOUD_ACCOUNT_ID not configured';
      await this.failDeployment(siteId, deploymentId, message);
      throw new AppError('BUILDER_INVOCATION_FAILED', `builder invocation failed: ${message}`, 500);
    }

    let credentials: FcBuilderCredentials;
    try {
      credentials = this.credentials();
    } catch (error) {
      await this.failDeployment(
        siteId,
        deploymentId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    const endpoint = `${this.accountId}.${this.region}.fc.aliyuncs.com`;
    const payload = JSON.stringify({ siteId, deploymentId });

    try {
      const client = this.clientFactory({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        securityToken: credentials.securityToken,
        endpoint,
        region: this.region,
      });
      const result = await client.invokeFunction({
        functionName: this.functionName,
        payload,
      });
      if (
        result.statusCode !== undefined &&
        (result.statusCode < 200 || result.statusCode >= 300)
      ) {
        throw new Error(`builder invocation responded with status ${result.statusCode}`);
      }
      // Async invocation accepted — the builder function updates the
      // deployment and its site_build job itself.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failDeployment(siteId, deploymentId, message);
      throw new AppError('BUILDER_INVOCATION_FAILED', `builder invocation failed: ${message}`, 500);
    }
  }

  /** Marks the deployment + job failed and records security/audit events. */
  private async failDeployment(
    siteId: string,
    deploymentId: string,
    message: string,
  ): Promise<void> {
    const db = this.deps.db;
    if (!db) {
      return; // nothing to mark without a database
    }
    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId));
    const workspaceId = deployment?.workspaceId;
    const now = new Date();
    await db
      .update(deployments)
      .set({ status: 'failed', errorMessage: message, finishedAt: now, updatedAt: now })
      .where(eq(deployments.id, deploymentId));
    await db
      .update(jobs)
      .set({ status: 'failed', errorMessage: message, finishedAt: now, updatedAt: now })
      .where(
        and(eq(jobs.type, 'site_build'), sql`${jobs.payload}->>'deploymentId' = ${deploymentId}`),
      );
    if (workspaceId) {
      await recordSecurityEvent(db, {
        workspaceId,
        eventType: 'builder_invocation_failed',
        severity: 'critical',
        metadata: { siteId, deploymentId, message },
      });
      await recordAuditLog(db, {
        workspaceId,
        action: 'site_build_invocation_failed',
        targetType: 'deployment',
        targetId: deploymentId,
        metadata: { siteId, message },
      });
    }
  }
}
