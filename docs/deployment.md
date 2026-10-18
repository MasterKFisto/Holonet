# Holonet — Deployment

## Fixed hostname

The public hostname is fixed: **https://holonet.section-zero.link**.

It is the value of `PUBLIC_BASE_URL` and fronts the platform (dashboard + API on Function
Compute). Published sites are served from the OSS public bucket (`OSS_PUBLIC_BASE_URL`), directly
or via a CDN-backed domain. Do not introduce other hostnames.

## Deployment architecture

- A dedicated **RAM user** (not the account root) performs deployments: Function Compute updates
  and OSS uploads of app assets. Its AccessKey pair lives only in the deployer's environment and
  is never committed to Git.
- Function Compute runs under the **RAM role** `FC_ROLE_ARN`, which grants object access to the
  two Holonet OSS buckets and log writes to SLS.
- The database is **PostgreSQL in Docker on a Docker host (ECS) inside the VPC**, reachable by
  Function Compute over the private network only (see docs/infrastructure.md for the explicit
  constraints).

## Preflight

```bash
pnpm typecheck
pnpm test
pnpm lint
bash infra/scripts/deploy-check.sh --production   # verifies tooling + production env vars
```

`deploy-check.sh --production` fails if required variables are unset or still contain
`<PLACEHOLDER>` values, if `PUBLIC_BASE_URL` is not exactly `https://holonet.section-zero.link`,
or if `AUTH_SECRET` is still the development placeholder. RAM user credentials are checked in
the deployer's environment (Serverless Devs access profile), not in the repository.

## Build

```bash
pnpm build
```

- `apps/api` → `apps/api/dist` (Hono app; entrypoint `dist/function.js` for FC, `dist/index.js`
  for a Node server). Local start currently runs the TypeScript source via tsx
  (`pnpm --filter api start`) because workspace packages are consumed as source.
- `apps/builder` → `apps/builder/dist` (build worker entrypoint).
- `apps/dashboard` → `apps/dashboard/dist` (static SPA build, uploaded to the OSS public bucket).

### Function Compute artifacts

FC cannot resolve workspace links at runtime, so both functions are bundled into
self-contained CommonJS zips before deployment:

```bash
pnpm deploy:package                     # or:
bash infra/scripts/package-api.sh       # → infra/alibaba/dist/holonet-app.zip
bash infra/scripts/package-builder.sh   # → infra/alibaba/dist/holonet-builder.zip
```

Each script esbuild-bundles the FC entrypoint (`apps/api/src/function.ts` /
`apps/builder/src/handler.ts`) **with all workspace packages** (`--platform=node
--target=node20 --format=cjs`, `proxy-agent` external), writes a CommonJS `package.json`, bakes
`infra/alibaba/dashboard-assets.json` into the app zip when present, and zips the entrypoint at
the archive root. Packaging needs no Alibaba credentials. Smoke-test the app bundle locally:

```bash
node -e "require('./infra/alibaba/dist/holonet-app/index.js').handler(JSON.stringify({version:'v1',rawPath:'/api/health',body:'',isBase64Encoded:false,queryParameters:{},headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/api/health'}}}), {}).then(r => console.log(r.statusCode, r.body))"
```

## Dashboard asset publishing

The production dashboard is served as static assets from the OSS public bucket
under `app/`; the Function Compute `holonet-app` function returns a minimal HTML shell
(`GET /`) that loads the dashboard entry CSS and JS from OSS.

```bash
pnpm build
node infra/scripts/upload-dashboard-assets.mjs   # or: pnpm dashboard:upload
```

The upload script:

1. Builds `apps/dashboard` when `dist/` is missing (force a rebuild with `--build`).
2. Uploads every `dist/` file to `app/…` in `OSS_PUBLIC_BUCKET` with correct content types
   (HTML, JS, CSS, JPG, PNG, SVG, fonts, …).
3. Sets cache-control per file: HTML → `no-cache`; hashed JS/CSS/images/fonts →
   `public, max-age=31536000, immutable`.
4. Writes the uploaded asset manifest to `infra/alibaba/dashboard-assets.json`
   (entry CSS/JS, per-file keys, content types, cache-control, sizes, SHA-256).

Required environment (deployment RAM user; never committed):

- `OSS_REGION` (or `ALIBABA_CLOUD_REGION`), `OSS_PUBLIC_BUCKET`, `OSS_PUBLIC_BASE_URL`
- `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` (or RAM-role credentials in CI)

At runtime the API reads the manifest via `DASHBOARD_ASSET_MANIFEST_PATH` (default:
`infra/alibaba/dashboard-assets.json`) and renders the shell with:

- `PUBLIC_BASE_URL` (`https://holonet.section-zero.link`) as `<base href>`.
- `OSS_PUBLIC_BASE_URL` + `/app/…` for every entry CSS/JS URL.

> **PLACEHOLDER — FC manifest packaging.** On Function Compute the manifest should be baked into
> the function artifact (or fetched from OSS at cold start) since the function image has no
> repository checkout; the default local path is for development.

## Publishing flow

Publishing a site runs the build pipeline end to end:

1. `POST /api/sites/:siteId/publish` creates a `deployments` row (queued) with
   `storagePrefix = sites/{siteId}/releases/{deploymentId}` and a `site_build` job, then
   invokes the builder.
2. **Local development** (`BUILDER_INVOKER=local`, the default): the API runs the build
   synchronously in-process via `LocalBuilderInvoker`.
3. **Production** (`BUILDER_INVOKER=fc`): `FcBuilderInvoker` invokes the `holonet-builder`
   Function Compute event function with the `{ siteId, deploymentId }` payload.
   PLACEHOLDER — the FC SDK invocation is wired in the deployment phase; the builder's FC
   entrypoint is `apps/builder/src/handler.ts`.
4. The builder loads the site, pages, and blocks from PostgreSQL, validates the template
   manifest (untrusted data, rule 17), generates the static site, and uploads it to
   `sites/{siteId}/releases/{deploymentId}/…` in the OSS public bucket (HTML `no-cache`,
   hashed assets immutable).
5. The builder writes the current release pointer `sites/{siteId}/current.json` and marks the
   deployment and its job `completed`, storing the **build logs** on the job `result`.
   Failures mark both `failed` with the error message.
6. `POST /api/sites/:siteId/rollback/:deploymentId` re-points `current.json` to the previous
   deployment (its storage prefix) and records a live rollback deployment.

The same pipeline runs as a local CLI:

```bash
pnpm --filter builder cli -- <siteId> <deploymentId>
```

(The CLI strips pnpm's `--` argument separator, so the command also works without it.)

## Production layout

| Component                                          | Target                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| API + dashboard HTML entrypoint                    | Function Compute function `holonet-app` (`FC_FUNCTION_NAME_APP`)                    |
| Static site builds                                 | Function Compute function `holonet-builder` (`FC_FUNCTION_NAME_BUILDER`)            |
| Metadata database                                  | PostgreSQL 16 in Docker on a Docker host (ECS) inside the VPC, private network only |
| Published sites + app assets (JPG, CSS, JS, fonts) | OSS public bucket (`OSS_PUBLIC_BUCKET`)                                             |
| Backups, form submissions, AI import snapshots     | OSS private bucket (`OSS_PRIVATE_BUCKET`)                                           |
| Deployment identity                                | Dedicated RAM user                                                                  |
| Function identity                                  | RAM role `FC_ROLE_ARN` (OSS + SLS logs)                                             |
| Public entry                                       | Custom domain https://holonet.section-zero.link                                     |

## Deploy steps (outline)

1. **VPC + Docker host + PostgreSQL** — create the VPC; provision the ECS Docker host with no
   public exposure for the database; run PostgreSQL 16 in Docker; configure the security group so
   TCP 5432 is allowed only from the Function Compute attachment. Apply the schema via
   `pnpm db:migrate` from inside the VPC (or through a private tunnel).
2. **OSS buckets** — create the public and private buckets in `ALIBABA_CLOUD_REGION`; apply
   `infra/alibaba/oss/oss-bucket-policy.example.json` to the public bucket.
3. **RAM** — create the deployment RAM user (least privilege) and the FC execution role
   (`FC_ROLE_ARN`) with `infra/alibaba/ram/holonet-fc-role-policy.example.json`.
4. **Function Compute** — deploy `holonet-app` and `holonet-builder` with Serverless Devs
   (`infra/alibaba/s.yaml`), VPC attachment and production environment variables injected from
   `infra/alibaba/.env.deploy` (never committed).
5. **Custom domain** — bind https://holonet.section-zero.link to the `holonet-app` HTTP trigger.
6. **Dashboard assets** — upload the Vite build to the OSS public bucket; the app function serves
   the dashboard HTML that references those assets.
7. **Published sites** — verify published sites are served from the OSS public bucket
   (OSS-backed domain, CDN optional).
8. **End-to-end check** — walk the request flow in docs/architecture.md (dashboard → API → DB →
   builder → OSS → published site).

## Function Compute deployment (Serverless Devs)

All FC configuration lives in **`infra/alibaba/s.yaml`** (Serverless Devs, edition 3):

- **holonet-app** — HTTP function (`nodejs20`, handler `index.handler`, 512 MB / 30 s,
  `internetAccess: true`): dashboard HTML shell, all API routes, the public form route, and
  health checks. VPC config (`vpcConfig`) from `VPC_ID` / `VSWITCH_IDS` / `SECURITY_GROUP_ID`,
  execution role `FC_ROLE_ARN`, HTTP trigger with `GET, POST, PUT, PATCH, DELETE, OPTIONS`
  (anonymous), and a custom-domain placeholder for https://holonet.section-zero.link.
- **holonet-builder** — event function (`nodejs20`, handler `index.handler`, 1024 MB
  (override `FC_BUILDER_MEMORY`) / **900 s** timeout): builds static sites from
  `{ siteId, deploymentId }` events and uploads releases to OSS. Same VPC + role as the app.
- All environment values (buckets, region, role ARN, VPC ids, `DATABASE_URL`, `AUTH_SECRET`,
  AI provider settings) come from `${env(...)}` placeholders — **real values are never
  committed** (rules 10/11). `PUBLIC_BASE_URL` is pinned to
  `https://holonet.section-zero.link`.

### First deploy

```bash
npm install -g @serverless-devs/s
s config add --AccessKeyID <RAM user AK> --AccessKeySecret <RAM user SK> -a holonet
cp infra/alibaba/.env.deploy.example infra/alibaba/.env.deploy   # fill in placeholders
bash infra/scripts/deploy.sh                                     # check → package → upload dashboard → s deploy
```

Single functions: `cd infra/alibaba && s holonet-app deploy` / `s holonet-builder deploy`.
Teardown: `s remove -y`. Remote builder invocation:
`s holonet-builder invoke --event '{"siteId":"…","deploymentId":"…"}'`. Full instructions,
the deployment checklist, custom-domain/HTTPS-certificate notes, and the VPC/PostgreSQL notes
are in `infra/alibaba/README.md`.

> **Builder invocation — resolved.** `BUILDER_INVOKER=fc` uses the real fc3 SDK invoker
> (`apps/api/src/invokers/fc-builder-invoker.ts`): asynchronous invocation
> (`x-fc-invocation-type: Async`) of `holonet-builder` with `{ siteId, deploymentId }`, endpoint
> `${accountId}.${region}.fc.aliyuncs.com`. Credential flow: inside Function Compute the invoker
> uses the **temporary STS credentials** captured from the FC context by the HTTP trigger adapter
> (`apps/api/src/lib/fc-context.ts` — issued by the `FC_ROLE_ARN` execution role); outside FC it
> falls back to `OSS_ACCESS_KEY_ID`/`OSS_ACCESS_KEY_SECRET` (or
> `ALIBABA_CLOUD_ACCESS_KEY_ID`/`ALIBABA_CLOUD_ACCESS_KEY_SECRET`) for local testing only.
> Invocation failures mark the deployment + `site_build` job `failed`, record
> `builder_invocation_failed` security (critical) + audit events, and return a structured
> `BUILDER_INVOCATION_FAILED` error — deployments are never left stuck in `queued`.

## Backups

```bash
bash infra/scripts/backup-db.sh [backup-dir]     # pg_dump custom format via DATABASE_URL
bash infra/scripts/restore-db.sh <dump-file>     # pg_restore via DATABASE_URL
```

Production procedure: run `backup-db.sh` on a schedule (from the Docker host or through the
private network), upload the dump to the OSS **private** bucket, and test restores regularly.

## Future upgrade paths

Summarized in docs/architecture.md: managed PostgreSQL (ApsaraDB RDS), CDN, Redis queue,
Kubernetes (ACK), merchant-of-record payments, and an internally hosted AI model. The deployment
sections of this document are updated when any of these are adopted.
