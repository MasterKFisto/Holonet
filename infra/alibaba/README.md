# Alibaba Cloud infrastructure

Configuration and policy templates for production on Alibaba Cloud.
Every committed value is a placeholder — real values come from environment
variables (`.env.deploy`, never committed; docs/PROJECT_RULES.md rules 10/11).

| Path                    | Contents                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `s.yaml`                | **Serverless Devs** project defining the two Function Compute functions (`holonet-app`, `holonet-builder`).        |
| `.env.deploy.example`   | Deployment environment template (copy to `.env.deploy` — git-ignored).                                             |
| `fc/`                   | Legacy JSON config sketch (superseded by `s.yaml`; kept for reference).                                            |
| `oss/`                  | OSS bucket policies (public bucket: static assets + published sites; private bucket: imports, form data, backups). |
| `ram/`                  | RAM role policies for the Function Compute execution role.                                                         |
| `dist/`                 | Local packaging output (`holonet-app.zip`, `holonet-builder.zip`) — git-ignored.                                   |
| `dashboard-assets.json` | Manifest written by `infra/scripts/upload-dashboard-assets.mjs` (baked into `holonet-app`).                        |

Deployment procedure: [docs/deployment.md](../../docs/deployment.md).
**Account/infrastructure setup (RAM users/roles, OSS, VPC, PostgreSQL, custom
domain): [docs/alibaba-cloud-setup.md](../../docs/alibaba-cloud-setup.md).**
Assumptions and placeholders: [docs/infrastructure.md](../../docs/infrastructure.md).

## Functions

### holonet-app (HTTP)

- Serves the dashboard HTML shell (`GET /`), all API routes, the public form
  endpoint (`POST /forms/:formId`), and health checks (`/health`, `/api/health`).
- Runtime `nodejs20`, handler `index.handler`, 512 MB / 30 s, `internetAccess: true`.
- VPC attachment from environment variables (PostgreSQL in Docker inside the VPC).
- Execution role `FC_ROLE_ARN` (OSS via STS — no AccessKeys in the function).
- HTTP trigger: `GET, POST, PUT, PATCH, DELETE, OPTIONS`, anonymous auth.
- Custom domain placeholder: **https://holonet.section-zero.link**.

### holonet-builder (event)

- Builds a static site from `{ siteId, deploymentId }` events and uploads the
  release to the OSS public bucket.
- Runtime `nodejs20`, handler `index.handler`, 1024 MB (override with
  `FC_BUILDER_MEMORY`) / **900 s timeout** (builds are slower than API calls).
- VPC attachment + `FC_ROLE_ARN`, same as the app function.

## Deploying with Serverless Devs

### 1. One-time tooling

```bash
# Serverless Devs CLI
npm install -g @serverless-devs/s

# Access profile for the dedicated deployment RAM user (rule: least privilege,
# never the account root). Real AccessKeys stay in the CLI config, not in Git.
s config add --AccessKeyID <RAM_USER_AK> --AccessKeySecret <RAM_USER_SK> -a holonet
```

### 2. Environment

```bash
cp infra/alibaba/.env.deploy.example infra/alibaba/.env.deploy
# fill in every placeholder (region, account id, buckets, role ARN, VPC ids,
# DATABASE_URL, AUTH_SECRET). The file is git-ignored — never commit it.
```

### 3. Deploy

```bash
bash infra/scripts/deploy.sh
```

This runs the readiness check, uploads the dashboard SPA assets to OSS,
packages both function artifacts (`pnpm deploy:package`), and executes
`s deploy` from `infra/alibaba/` (s.yaml) — `s` reads `.env.deploy`-exported
variables for every `${env(...)}` placeholder.

Target a single function:

```bash
cd infra/alibaba
s holonet-app deploy    # API function only
s holonet-builder deploy
```

Remove (teardown): `cd infra/alibaba && s remove -y`.

## Local packaging (without deploying)

```bash
pnpm deploy:package                     # or:
bash infra/scripts/package-api.sh       # → infra/alibaba/dist/holonet-app.zip
bash infra/scripts/package-builder.sh   # → infra/alibaba/dist/holonet-builder.zip
```

Each script bundles the FC entrypoint (`apps/api/src/function.ts` /
`apps/builder/src/handler.ts`) **together with all workspace packages** into a
self-contained CommonJS `index.js` (esbuild), adds a CommonJS `package.json`,
bakes `dashboard-assets.json` into the app zip (with `--production` a missing
manifest is a hard error — the runtime can otherwise fall back to the OSS
bucket key `app/dashboard-assets.json`), and zips the result with the
entrypoint at the archive root. No Alibaba credentials are needed for
packaging.

Smoke-test the packaged app handler locally:

```bash
node -e "require('./infra/alibaba/dist/holonet-app/index.js').handler(JSON.stringify({version:'v1',rawPath:'/api/health',body:'',isBase64Encoded:false,queryParameters:{},headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/api/health'}}}), {}).then(r => console.log(r.statusCode, r.body))"
```

## Invoking the builder

**Locally (no FC):**

```bash
pnpm --filter builder cli -- <siteId> <deploymentId>
```

Requires `DATABASE_URL` and `STORAGE_PROVIDER=fs` (with `STORAGE_LOCAL_DIR`),
or OSS credentials for the public bucket.

**Remotely (Function Compute):**

```bash
s holonet-builder invoke --event '{"siteId":"<siteId>","deploymentId":"<deploymentId>"}'
```

The event function logs build output to the SLS logstore (`holonet-builder`)
and marks the deployment `live`/`failed` and the `site_build` job
`completed`/`failed` in PostgreSQL.

## Deployment checklist

- [ ] `infra/alibaba/.env.deploy` filled with real values (placeholders removed)
- [ ] `s config add` access profile `holonet` for the deployment RAM user
- [ ] VPC, vSwitch, and security group exist and match `VPC_ID`/`VSWITCH_IDS`/`SECURITY_GROUP_ID`
- [ ] PostgreSQL (Docker on ECS inside the VPC) reachable on `DATABASE_URL`; schema migrated (`pnpm db:migrate`)
- [ ] Security group allows TCP 5432 **only** from the Function Compute attachment
- [ ] OSS public + private buckets exist; public bucket policy applied (`oss/oss-bucket-policy.example.json`)
- [ ] `FC_ROLE_ARN` exists with the RAM policy from `ram/holonet-fc-role-policy.example.json`
- [ ] `AUTH_SECRET` replaced with a strong random value (≥32 chars)
- [ ] `bash infra/scripts/deploy-check.sh --production` passes
- [ ] `pnpm build` + `pnpm test` green before deploying
- [ ] `bash infra/scripts/deploy.sh` completes
- [ ] `curl -i https://holonet.section-zero.link/health` → 200
- [ ] Register a workspace, publish a site, verify the OSS release files
- [ ] Submit a public form (`POST /forms/:formId`) and see the submission in the dashboard
- [ ] Import a website (ownership confirmed) and verify the draft pages stay unpublished
- [ ] Builder logs visible in SLS; `site_build` jobs complete

## Custom domain and HTTPS certificate

- `s.yaml` carries a **placeholder** `customDomains` entry for
  `holonet.section-zero.link`. Before enabling it:
  1. Verify the domain in Alibaba Cloud (real-name verification for `.link`).
  2. Point a DNS CNAME at the Function Compute endpoint (shown in the FC
     console for the HTTP trigger).
  3. Issue an HTTPS certificate (Alibaba Cloud SSL Certificates Service —
     free DV certs work) and copy its `certId`.
  4. Update the `customDomains` entry to `protocol: HTTPS` with the `certConfig`
     (certId/privateKey/certificate or a cert reference) — or bind the domain in
     the FC console and leave the s.yaml entry as documentation.
- The platform hostname (configurable — `PUBLIC_BASE_URL` / `PUBLIC_DOMAIN`,
  default example `https://holonet.section-zero.link`) is passed into the
  function environment; `deploy-check.sh --production` enforces that
  `PUBLIC_BASE_URL` is a valid `https://` URL.

## Function Compute → PostgreSQL in Docker (VPC notes)

- PostgreSQL runs in Docker on a Docker host (ECS) **inside the VPC**; it has
  no public endpoint. Function Compute reaches it over the private network
  because both functions attach the same `VPC_ID`/`VSWITCH_IDS`/`SECURITY_GROUP_ID`.
- `DATABASE_URL` must use the **private host** (`<DB_PRIVATE_HOST>` in
  `.env.deploy.example`) — the ECS private IP or an internal DNS name, never a
  public IP or port-forwarded address.
- The Docker host's security group must allow TCP 5432 only from the FC
  attachment security group (least privilege). See docs/infrastructure.md.
- FC VPC attachment can add a few seconds of cold-start latency; with
  `internetAccess: true` both functions also reach the public internet
  (site imports, AI endpoints) alongside the VPC.

## Placeholder notes

- **PLACEHOLDER — rate limiting across instances.** In-memory limiters are
  per-instance; move to a shared store (Redis) for multi-instance scale.
- **FC HTTP trigger signature — resolved.** `apps/api/src/function.ts` is a
  full fc3 HTTP trigger adapter (API-Gateway-style JSON event → Web Request →
  Hono → `{ statusCode, headers, isBase64Encoded, body }`). Event shape +
  verification step: [docs/assumptions.md](../../docs/assumptions.md).
  Smoke-test the packaged adapter locally:

```bash
node -e "require('./infra/alibaba/dist/holonet-app/index.js').handler(JSON.stringify({version:'v1',rawPath:'/api/health',body:'',isBase64Encoded:false,queryParameters:{},headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/api/health'}}}), {}).then(r => console.log(r.statusCode, r.body))"
```

- **Builder invocation from the API — resolved.** `BUILDER_INVOKER=fc` invokes
  `holonet-builder` asynchronously through the fc3 SDK using the STS
  credentials captured from the FC context (fallback: OSS/ALIBABA_CLOUD
  AccessKey env vars for local testing). Failures mark the deployment + job
  `failed` with security/audit events — see
  [docs/deployment.md](../../docs/deployment.md).

```bash
node -e "require('./infra/alibaba/dist/holonet-app/index.js').handler(JSON.stringify({version:'v1',rawPath:'/api/health',body:'',isBase64Encoded:false,queryParameters:{},headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/api/health'}}}), {}).then(r => console.log(r.statusCode, r.body))"
```
