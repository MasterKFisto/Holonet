import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { StorageProvider } from '@holonet/storage';
import {
  auditLogs,
  closeDatabase,
  createDatabase,
  deployments,
  jobs,
  securityEvents,
  users,
  workspaces,
  type HolonetDatabase,
} from '@holonet/db';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createBuilderInvoker, LocalBuilderInvoker } from './lib/builder-invoker.js';
import { storeFcContext } from './lib/fc-context.js';
import {
  FcBuilderInvoker,
  resolveFcCredentials,
  type FcBuilderClient,
} from './invokers/fc-builder-invoker.js';

const dbUrl = process.env.DATABASE_URL;
const hasDb = typeof dbUrl === 'string' && dbUrl.length > 0;

const AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes-ok';
const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `fc-builder-${unique}@holonet.local`;
const PASSWORD = 'correct-horse-battery';
const SLUG = `fc-builder-${unique}`;

const fakeStorage: StorageProvider = {
  kind: 'fs',
  bucket: 'public',
  putObject: async () => {},
  getObject: async () => null,
  deleteObject: async () => {},
  listObjects: async () => [],
  getPublicUrl: (key) => `http://fake-storage/${key}`,
  getSignedUrl: async (key) => `http://fake-storage/${key}`,
};

let db: HolonetDatabase;
let csrf = '';
let session = '';
let siteId = '';
let workspaceId = '';

async function csrfPair(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request('/health');
  const match = (res.headers.get('set-cookie') ?? '').match(/holonet_csrf=([^;]+)/);
  return match?.[1] ?? '';
}

function sessionFrom(res: Response): string {
  const match = (res.headers.get('set-cookie') ?? '').match(/holonet_session=([^;]+)/);
  return match?.[1] ?? '';
}

function jsonHeaders(token: string, session?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-csrf-token': token,
    cookie: `holonet_csrf=${token}${session ? `; holonet_session=${session}` : ''}`,
  };
}

type FcClientFactory = (config: {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
  endpoint: string;
  region: string;
}) => FcBuilderClient;

function fcInvoker(clientFactory: FcClientFactory): FcBuilderInvoker {
  return new FcBuilderInvoker(
    { db, storage: fakeStorage, publicBaseUrl: 'https://holonet.section-zero.link' },
    {
      region: 'cn-hangzhou',
      accountId: '1234567890',
      credentials: () => ({ accessKeyId: 'test-ak', accessKeySecret: 'test-sk' }),
      clientFactory,
    },
  );
}

function fcEnv(): ReturnType<typeof loadEnv> {
  return loadEnv({
    ...process.env,
    DATABASE_URL: dbUrl!,
    AUTH_SECRET,
    BUILDER_INVOKER: 'fc',
    ALIBABA_CLOUD_REGION: 'cn-hangzhou',
    ALIBABA_CLOUD_ACCOUNT_ID: '1234567890',
  });
}

describe.skipIf(!hasDb).sequential('holonet-api FC builder invocation', () => {
  beforeAll(async () => {
    db = createDatabase(dbUrl!);
    const bootstrapApp = createApp(fcEnv(), db, fakeStorage);
    csrf = await csrfPair(bootstrapApp);

    const register = await bootstrapApp.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(csrf),
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(register.status).toBe(201);
    session = sessionFrom(register);

    const workspaceRes = await bootstrapApp.request('/api/workspaces', {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
      body: JSON.stringify({ name: 'FC Builder Workspace', slug: SLUG }),
    });
    workspaceId = ((await workspaceRes.json()) as { workspace: { id: string } }).workspace.id;

    const siteRes = await bootstrapApp.request(`/api/workspaces/${workspaceId}/sites`, {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
      body: JSON.stringify({ name: 'FC Builder Site', slug: `${SLUG}-site` }),
    });
    siteId = ((await siteRes.json()) as { site: { id: string } }).site.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG));
    await db.delete(users).where(eq(users.email, EMAIL));
    await closeDatabase(db);
  });

  it('publish with BUILDER_INVOKER=fc calls invokeBuild with the correct payload', async () => {
    const calls: Array<{ functionName: string; payload: string }> = [];
    const configs: unknown[] = [];
    const invoker = fcInvoker((config) => {
      configs.push(config);
      return {
        invokeFunction: async ({ functionName, payload }) => {
          calls.push({ functionName, payload });
          return { statusCode: 202 };
        },
      };
    });
    const fcApp = createApp(fcEnv(), db, fakeStorage, invoker);

    const publish = await fcApp.request(`/api/sites/${siteId}/publish`, {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
    });
    expect(publish.status).toBe(202);
    const body = (await publish.json()) as {
      deployment: { id: string; status: string; storagePrefix: string };
    };
    const deploymentId = body.deployment.id;

    // The FC invocation carried the exact payload and target function.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.functionName).toBe('holonet-builder');
    expect(JSON.parse(calls[0]?.payload ?? '{}')).toEqual({ siteId, deploymentId });

    // The SDK config used the correct endpoint and credentials.
    expect(configs[0]).toMatchObject({
      endpoint: '1234567890.cn-hangzhou.fc.aliyuncs.com',
      accessKeyId: 'test-ak',
      region: 'cn-hangzhou',
    });

    // Async invocation: the deployment stays queued — the builder function
    // marks it live once the build completes.
    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId));
    expect(deployment?.status).toBe('queued');
  });

  it('invocation failure marks deployment + job failed, logs audit + security events', async () => {
    const invoker = fcInvoker(() => ({
      invokeFunction: async () => {
        throw new Error('simulated FC invocation failure');
      },
    }));
    const fcApp = createApp(fcEnv(), db, fakeStorage, invoker);

    const publish = await fcApp.request(`/api/sites/${siteId}/publish`, {
      method: 'POST',
      headers: jsonHeaders(csrf, session),
    });
    // Structured API error — never a hanging 'queued' deployment.
    expect(publish.status).toBe(500);
    const body = (await publish.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BUILDER_INVOCATION_FAILED');
    expect(body.error.message).toContain('simulated FC invocation failure');

    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.workspaceId, workspaceId));
    // The failed invocation's deployment is the most recent one — it must be
    // marked failed, never left stuck in 'queued' (the earlier async
    // deployment from the previous test stays 'queued' by design).
    const [latest] = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    expect(latest?.status).toBe('failed');
    const failedDeployment = latest;
    expect(failedDeployment?.errorMessage).toContain('simulated FC invocation failure');
    expect(failedDeployment?.finishedAt).toBeTruthy();

    const job = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.type, 'site_build'),
        sql`${jobs.payload}->>'deploymentId' = ${failedDeployment?.id ?? ''}`,
      ),
    });
    expect(job?.status).toBe('failed');
    expect(job?.errorMessage).toContain('simulated FC invocation failure');

    const audit = await db.query.auditLogs.findFirst({
      where: and(
        eq(auditLogs.action, 'site_build_invocation_failed'),
        eq(auditLogs.workspaceId, workspaceId),
      ),
    });
    expect(audit).toBeTruthy();
    expect(audit?.targetId).toBe(failedDeployment?.id);

    const event = await db.query.securityEvents.findFirst({
      where: and(
        eq(securityEvents.eventType, 'builder_invocation_failed'),
        eq(securityEvents.workspaceId, workspaceId),
      ),
    });
    expect(event).toBeTruthy();
    expect(event?.severity).toBe('critical');
  });

  it('local mode remains unaffected', () => {
    const local = createBuilderInvoker('local', {
      db,
      storage: fakeStorage,
      publicBaseUrl: 'https://holonet.section-zero.link',
    });
    expect(local).toBeInstanceOf(LocalBuilderInvoker);
    expect(local.kind).toBe('local');
    expect(createBuilderInvoker('fc', { storage: fakeStorage, publicBaseUrl: 'x' }).kind).toBe(
      'fc',
    );
  });

  it('resolves credentials: FC context STS first, env fallback second', () => {
    storeFcContext({
      credentials: { accessKeyId: 'STS.ak', accessKeySecret: 'STS.sk', securityToken: 'STS.tok' },
    });
    expect(resolveFcCredentials()).toEqual({
      accessKeyId: 'STS.ak',
      accessKeySecret: 'STS.sk',
      securityToken: 'STS.tok',
    });

    storeFcContext({});
    const previousAk = process.env.OSS_ACCESS_KEY_ID;
    const previousSk = process.env.OSS_ACCESS_KEY_SECRET;
    process.env.OSS_ACCESS_KEY_ID = 'env-ak';
    process.env.OSS_ACCESS_KEY_SECRET = 'env-sk';
    try {
      expect(resolveFcCredentials()).toEqual({
        accessKeyId: 'env-ak',
        accessKeySecret: 'env-sk',
      });
    } finally {
      if (previousAk === undefined) {
        delete process.env.OSS_ACCESS_KEY_ID;
      } else {
        process.env.OSS_ACCESS_KEY_ID = previousAk;
      }
      if (previousSk === undefined) {
        delete process.env.OSS_ACCESS_KEY_SECRET;
      } else {
        process.env.OSS_ACCESS_KEY_SECRET = previousSk;
      }
    }

    storeFcContext({});
    const savedAk = process.env.OSS_ACCESS_KEY_ID;
    const savedSk = process.env.OSS_ACCESS_KEY_SECRET;
    delete process.env.OSS_ACCESS_KEY_ID;
    delete process.env.OSS_ACCESS_KEY_SECRET;
    delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    try {
      expect(() => resolveFcCredentials()).toThrow(/no Function Compute credentials/);
    } finally {
      if (savedAk !== undefined) process.env.OSS_ACCESS_KEY_ID = savedAk;
      if (savedSk !== undefined) process.env.OSS_ACCESS_KEY_SECRET = savedSk;
    }
  });
});
