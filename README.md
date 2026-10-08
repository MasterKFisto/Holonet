# Holonet

Security-first static website platform with AI-assisted website import, template-based publishing, form handling, backups, and managed static hosting.

- **Fixed public hostname:** https://holonet.section-zero.link
- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20
- **Package manager:** pnpm (monorepo)
- **Database:** PostgreSQL 16 in Docker (Docker Compose locally; a Docker host inside a VPC in production)
- **Production compute:** Alibaba Cloud Function Compute
- **Production object storage:** Alibaba Cloud OSS

All project rules live in [docs/PROJECT_RULES.md](docs/PROJECT_RULES.md).

## 1. Purpose

Holonet lets operators manage static websites end to end:

1. **Import** — import existing websites (with optional AI assistance) into Holonet.
2. **Build** — assemble websites from templates and content blocks.
3. **Publish** — publish pure static files to Alibaba Cloud OSS.
4. **Operate** — handle forms, keep backups, and host everything at a managed domain.

The platform is security-first: imported content and AI output are treated as untrusted, all tenant data is isolated by workspace, no secrets are stored in code or docs, and public static assets live only in OSS in production.

## Architecture at a glance

**Local development** — Node.js API on :3000, React dashboard on Vite :5173, PostgreSQL in Docker
Compose, local filesystem storage (optional MinIO as an OSS stand-in). See docs/architecture.md
for diagrams.

**Production** — Function Compute hosts the API/dashboard entrypoint (`holonet-app`) and a
separate build function (`holonet-builder`); PostgreSQL runs in Docker on a Docker host inside a
VPC and is reached over the private network; the OSS public bucket holds JPG, CSS, JS, fonts,
published sites, and app assets; the OSS private bucket holds backups, form submissions, and AI
import snapshots; a RAM user deploys, a RAM role authorizes the functions (OSS + logs); the
custom domain is https://holonet.section-zero.link.

**Request flow** — (1) browser visits https://holonet.section-zero.link; (2) Function Compute
returns dashboard HTML or an API response; (3) static assets load from OSS; (4) the API writes to
PostgreSQL; (5) publish invokes the builder function; (6) the builder generates the static site
and uploads it to OSS; (7) the published site is served from OSS or a CDN/OSS-backed domain.

**Upgrade paths** — managed PostgreSQL, CDN, Redis queue, Kubernetes, merchant-of-record
payments, internally hosted AI model. See docs/architecture.md.

## 2. Repository layout

```
holonet/
  package.json          # root scripts + shared tooling (TS, ESLint, Prettier, Vitest)
  pnpm-workspace.yaml   # workspace globs (apps/*, packages/*)
  tsconfig.base.json    # shared strict TypeScript configuration
  .env.example          # environment variable template (placeholders only)
  docs/                 # architecture, infrastructure, security, deployment docs
  apps/
    api/                # Hono backend + Function Compute HTTP entrypoint
    dashboard/          # React dashboard (Vite)
    builder/            # static site build worker (Function Compute function)
  packages/
    core/               # shared constants, domain types, utilities
    db/                 # Drizzle schema, migrations, database utilities
    storage/            # storage abstraction (local filesystem + Alibaba OSS)
    templates/          # Holonet template manifests and block schemas
    static-generator/   # generates static websites from Holonet site data
    ai/                 # AI import provider interfaces
    security/           # validation, rate limiting, audit logging, security events
  infra/
    docker/             # Docker Compose for PostgreSQL
    alibaba/            # Function Compute, OSS, RAM, deployment configuration
    scripts/            # dev, backup, restore, deploy helper scripts
```

> Status: scaffold phase. Interfaces and entrypoints exist; business logic arrives phase by phase (see the docs and rule 15 in `docs/PROJECT_RULES.md`).

## 3. Required tools

| Tool                                       | Version                       | Purpose                                                     |
| ------------------------------------------ | ----------------------------- | ----------------------------------------------------------- |
| Node.js                                    | 20.x                          | Runtime for all services                                    |
| pnpm                                       | 9+ (corepack ships with Node) | Package manager / monorepo                                  |
| Docker                                     | recent stable                 | PostgreSQL for local development                            |
| MinIO (optional)                           | recent stable                 | Simulates OSS locally (S3-compatible)                       |
| PostgreSQL client (`pg_dump`/`pg_restore`) | 16.x                          | Backups and restores (infra scripts)                        |
| Alibaba Cloud CLI / Serverless Devs        | —                             | Production deployment (later phase; see docs/deployment.md) |

## 4. Local development setup

```bash
# 1. Copy the environment template (placeholders only — never commit real values)
cp .env.example .env

# 2. Install dependencies
pnpm install

# 3. Start PostgreSQL (Docker)
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Start the development servers
pnpm dev                 # API on :3000, dashboard on :5173
```

Optional: run MinIO to simulate OSS locally (see docs/infrastructure.md).

Quality gates — run before finishing any phase (rules 14/15):

```bash
pnpm typecheck   # tsc --noEmit across all workspaces
pnpm test        # Vitest across all workspaces
pnpm lint        # ESLint across the repo
pnpm format:check
```

Database scripts (Drizzle, run from packages/db):

```bash
pnpm db:generate   # generate migrations from the schema
pnpm db:migrate    # apply migrations (uses DATABASE_URL)
pnpm db:seed       # seed the pilot workspace (idempotent)
pnpm db:studio     # open Drizzle Studio
```

### Migrations and seeding

```bash
# Generate a migration after changing packages/db/src/schema.ts
pnpm db:generate

# Apply pending migrations (packages/db/src/migrate.ts, Drizzle migrator)
pnpm db:migrate

# Seed: creates admin@holonet.local (password from ADMIN_INITIAL_PASSWORD,
# stored as a scrypt hash), the "Holonet Pilot" workspace, the
# "Professional Services" template (minimal JSONB manifest), and one draft
# site. Safe to run repeatedly (idempotent).
ADMIN_INITIAL_PASSWORD=change-me-admin pnpm db:seed
```

- Migration files live in `packages/db/migrations/` (generated — never hand-edit).
- `DATABASE_URL` points at the local Docker database (see the connection string above); in
  production it points at the private VPC address of the PostgreSQL Docker host.
- `db:generate` works offline; `db:migrate` and `db:seed` need a running database.

Deployment readiness:

```bash
pnpm deploy:check                                 # local tooling check
bash infra/scripts/deploy-check.sh --production   # verify production env vars
```

## Local Database Setup

The local database is PostgreSQL 16 running in Docker (`infra/docker/docker-compose.yml`).

```bash
# Install dependencies
pnpm install

# Start the database (detached; ready once the healthcheck passes)
docker compose -f infra/docker/docker-compose.yml up -d

# Apply Drizzle migrations
pnpm db:migrate
```

psql connection string (matches the local `DATABASE_URL` in `.env.example`):

```text
postgres://holonet:holonet@localhost:5432/holonet
```

Helper scripts in `infra/scripts/`:

| Script                 | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `db-up.sh`             | Starts the local database and waits until it is healthy.        |
| `db-down.sh`           | Stops the local database (keeps the data volume).               |
| `db-psql.sh`           | Opens a psql shell inside the database container.               |
| `db-backup.sh`         | pg_dump → `backups/database/holonet-db-YYYYMMDD-HHMMSS.sql.gz`. |
| `db-restore.sh <file>` | Restores a backup file into the local database.                 |

Optional Adminer web UI for local database inspection (disabled by default):

```bash
docker compose -f infra/docker/docker-compose.yml --profile adminer up -d
# then open http://localhost:8080
```

> ⚠️ **Do not expose PostgreSQL to the public internet. In production, run PostgreSQL inside a VPC
> and allow access only from Function Compute or trusted private network interfaces.**
>
> `infra/docker/docker-compose.prod.yml` publishes no ports by default; its comments explain how
> to bind the private VPC interface and lock down the host firewall and security group. See
> docs/infrastructure.md.

## 5. Environment variables

All configuration comes from environment variables — see `.env.example` (rules 10/11). Real values are never committed.

| Variable                                       | Meaning                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | `development` locally, `production` on Alibaba Cloud                                                |
| `PORT`                                         | Port for the local API server (default 3000)                                                        |
| `PUBLIC_BASE_URL`                              | Fixed public base URL: `https://holonet.section-zero.link`                                          |
| `DATABASE_URL`                                 | PostgreSQL connection string (local dev default; production uses the private VPC address)           |
| `ALIBABA_CLOUD_REGION`                         | Alibaba Cloud region for Function Compute and OSS                                                   |
| `ALIBABA_CLOUD_ACCOUNT_ID`                     | Alibaba Cloud account ID (used to build ARNs)                                                       |
| `OSS_PUBLIC_BUCKET`                            | OSS bucket for public resources: JPG, CSS, JS, fonts, published sites, app assets                   |
| `OSS_PRIVATE_BUCKET`                           | OSS bucket for non-public resources: backups, form submissions, AI import snapshots                 |
| `OSS_ENDPOINT`                                 | OSS API endpoint for the chosen region                                                              |
| `OSS_PUBLIC_BASE_URL`                          | Public URL of the public bucket (static hosting origin)                                             |
| `AUTH_SECRET`                                  | Secret for signing session tokens — **must be replaced** in production                              |
| `SESSION_COOKIE_NAME`                          | Session cookie name (`holonet_session`)                                                             |
| `COOKIE_SECURE`                                | Enforce Secure flag on cookies (`true` in production)                                               |
| `ADMIN_INITIAL_PASSWORD`                       | Initial admin password for `pnpm db:seed` (stored as a scrypt hash, never plaintext)                |
| `AI_PROVIDER`                                  | AI import provider (`manual` default; provider interfaces in packages/ai)                           |
| `AI_ENDPOINT` / `AI_API_KEY` / `AI_MODEL`      | Optional AI provider endpoint, key, and model — the key comes from the environment, never from code |
| `FC_FUNCTION_NAME_APP`                         | Function Compute function name for the app/API                                                      |
| `FC_FUNCTION_NAME_BUILDER`                     | Function Compute function name for the builder worker                                               |
| `FC_ROLE_ARN`                                  | RAM role ARN assumed by Function Compute (`acs:ram::…:role/holonet-fc-role`)                        |
| `VPC_ID` / `VSWITCH_IDS` / `SECURITY_GROUP_ID` | VPC attachment for Function Compute                                                                 |

## 6. Production deployment overview

Production runs on Alibaba Cloud:

- **Compute** — Function Compute function `holonet-app` hosts the API and the dashboard HTML
  entrypoint; a separate function `holonet-builder` performs static site builds. Both run Node.js
  20 in the region `ALIBABA_CLOUD_REGION`, attach to the VPC
  (`VPC_ID`/`VSWITCH_IDS`/`SECURITY_GROUP_ID`), and run under the RAM role `FC_ROLE_ARN`. See
  `infra/alibaba/fc/`.
- **Database** — PostgreSQL 16 runs in Docker on a Docker host (ECS) inside the VPC. Function
  Compute cannot host a persistent database, so connectivity is over the VPC private network
  only; the database is never publicly exposed. See docs/infrastructure.md.
- **Object storage** — the OSS public bucket (`OSS_PUBLIC_BUCKET`) holds public resources: JPG,
  CSS, JS, fonts, published static websites, and app assets. The OSS private bucket
  (`OSS_PRIVATE_BUCKET`) holds backups, form submissions, AI import snapshots, and other
  non-public resources. See `infra/alibaba/oss/`.
- **Identity** — a dedicated RAM user performs deployments; the FC RAM role grants the functions
  least-privilege OSS and SLS log access. See `infra/alibaba/ram/`.
- **Custom domain** — https://holonet.section-zero.link is bound to the `holonet-app` function;
  published sites are served from the OSS public bucket (CDN optional).
- **Backups** — `infra/scripts/backup-db.sh` / `restore-db.sh` (pg_dump/pg_restore against
  `DATABASE_URL`), with dumps stored in the private OSS bucket.
- **Preflight** — `pnpm deploy:check` (and `deploy-check.sh --production`) validate tooling and
  environment before deploying.

Full procedure: [docs/deployment.md](docs/deployment.md). Architecture and request flow:
[docs/architecture.md](docs/architecture.md). Configuration templates: `infra/alibaba/`.
Placeholder assumptions are marked `PLACEHOLDER` in the relevant files.

## 7. Fixed hostname

The public hostname is fixed: **https://holonet.section-zero.link**.

It is wired through `PUBLIC_BASE_URL` and `OSS_PUBLIC_BASE_URL` in `.env.example`, used as the default by `packages/core`, and serves as the origin for published sites. Do not invent other hostnames.

## Documentation

- [docs/PROJECT_RULES.md](docs/PROJECT_RULES.md) — the 20 project rules and architecture summary
- [docs/architecture.md](docs/architecture.md) — full architecture: local and production diagrams, request flow, upgrade paths
- [docs/infrastructure.md](docs/infrastructure.md) — local and Alibaba Cloud infrastructure, network, RAM/OSS, secrets policy
- [docs/security.md](docs/security.md) — security posture and threat handling
- [docs/deployment.md](docs/deployment.md) — deployment and operations procedure
