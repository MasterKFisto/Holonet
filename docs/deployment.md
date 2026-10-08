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
`<PLACEHOLDER>` values. RAM user credentials are checked in the deployer's environment (Alibaba
Cloud CLI profile), not in the repository.

## Build

```bash
pnpm build
```

- `apps/api` → `apps/api/dist` (Hono app; entrypoint `dist/function.js` for FC, `dist/index.js`
  for a Node server).
- `apps/builder` → `apps/builder/dist` (build worker entrypoint).
- `apps/dashboard` → `apps/dashboard/dist` (static SPA build, uploaded to the OSS public bucket).

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
4. **Function Compute** — deploy `holonet-app` and `holonet-builder` per
   `infra/alibaba/fc/fc-config.example.json`, with VPC attachment and production environment
   variables injected at deploy time (never committed).
5. **Custom domain** — bind https://holonet.section-zero.link to the `holonet-app` HTTP trigger.
6. **Dashboard assets** — upload the Vite build to the OSS public bucket; the app function serves
   the dashboard HTML that references those assets.
7. **Published sites** — verify published sites are served from the OSS public bucket
   (OSS-backed domain, CDN optional).
8. **End-to-end check** — walk the request flow in docs/architecture.md (dashboard → API → DB →
   builder → OSS → published site).

> **PLACEHOLDER — tooling.** The exact deployment tool (Serverless Devs `s` CLI, Alibaba Cloud
> CLI, or console) and the FC HTTP-trigger signature are finalized when Function Compute
> deployment is implemented; assumptions are recorded in docs/infrastructure.md (rule 16). Until
> then, deploy manually via the Alibaba Cloud console using the templates above.

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
