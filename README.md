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

## API Development

The API is a Hono app in `apps/api`, served locally with `@hono/node-server`:

```bash
pnpm --filter api dev        # API on http://localhost:3000
pnpm --filter api typecheck
```

Quick checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/health
curl -i http://localhost:3000/api/workspaces   # 401 UNAUTHORIZED (auth required)
```

- **Skeleton status:** `/health` and `/api/health` are fully implemented, as are all
  authentication routes (`register`, `login`, `logout`, `forgot-password`, `reset-password`,
  `/api/me`), the site/workspace/page/block CRUD routes, publishing (`publish`, `rollback`),
  and the public form-submission endpoints. Every other route from the API plan exists with
  structured `501 NOT_IMPLEMENTED` responses until its phase lands.
- **Authentication:** scrypt password hashing (constant-time verify), jose HS256 session JWTs in
  the HTTP-only `holonet_session` cookie (Secure in production, `SameSite=Lax`, revoked by
  `users.token_version` on logout/reset), double-submit CSRF protection (`holonet_csrf` +
  `X-CSRF-Token`), login rate limiting (5 failures / 15 min per IP+email), hashed single-use
  password-reset tokens (1 h expiry), and `security_events` / `audit_logs` records for every
  login/register/logout/reset event. Full design: docs/security.md.
- **Forms (public submissions):** `POST /forms/:formId` accepts JSON or form-encoded visitor
  submissions from published static sites. It is CSRF-exempt by design and hardened instead with
  a honeypot field, per-IP+form rate limiting (10/min), 64 KiB payload caps, generic success
  responses (spam, rate-limited, and unknown forms are silently discarded), hashed IP storage,
  `security_events` escalation for repeated abuse, and a `form_notification` webhook job
  placeholder. Authenticated members browse submissions via `GET /api/sites/:siteId/forms` and
  `GET /api/forms/:formId/submissions`. Full design: docs/security.md ("Public form submissions").
- **Publishing:** `POST /api/sites/:siteId/publish` builds the site with the static generator
  (in-process by default, Function Compute via `BUILDER_INVOKER=fc` placeholder), uploads the
  release under `sites/{siteId}/releases/{deploymentId}/…`, and points `current.json` at the new
  release; `POST /api/sites/:siteId/rollback` repoints the current release at the previous one.
  Builds run as `site_build` jobs with logs recorded on the job result.
- **Website import (AI foundation):** `POST /api/sites/:siteId/import` (requires ownership
  confirmation) creates an `import_jobs` row and runs the SSRF-safe fetcher from
  `packages/ai`: public http(s) URLs only (localhost, private/link-local IPs, metadata
  endpoints, credential URLs, and non-default ports are rejected), max 3 pages / 5 MiB / 20 s,
  fixed user agent `HolonetImporter/0.1`, no credentials, no JavaScript, robots.txt respected,
  redirects re-validated per hop. Raw HTML is stored only in the **private** bucket under
  `imports/{workspaceId}/{importJobId}/raw/`; the job transitions
  `pending → fetching → analyzing → completed | failed | rejected`, records an `ai_analyses`
  row, and never publishes anything (draft pages only, in the content-generation phase).
  Admins inspect jobs via `GET /api/admin/import-jobs`. Full design: docs/security.md.
- **Authorization:** `requireUser`, `requireAdmin`, and `requireWorkspaceAccess` are real
  middleware — workspace routes already enforce tenant isolation (rule 18).
- **Error shape** (stable — clients rely on `code`, never on `message`):
  `{ "error": { "code": "NOT_FOUND", "message": "…" }, "requestId": "…" }`. Codes:
  `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
  `RATE_LIMITED`, `NOT_IMPLEMENTED`, `INVALID_CONFIG`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`.
- **Middleware:** request IDs (`X-Request-Id`, client-supplied when safe), structured request
  logging, security headers, CORS for the Vite dashboard (`CORS_ORIGINS`, default
  `http://localhost:5173`), per-IP rate limiting on `/api/*`
  (`RATE_LIMIT_WINDOW_SECONDS` / `RATE_LIMIT_MAX_REQUESTS`, default 300 req / 60 s), and CSRF
  protection for state-changing routes.
- **Environment:** validated with Zod in `apps/api/src/config/env.ts` — invalid configuration
  fails loudly with `INVALID_CONFIG`.
- **Function Compute:** the same app is exposed through `apps/api/src/function.ts` (HTTP-triggered
  handler); local server and FC entrypoint share `createApp()`.

### API examples (curl)

State-changing requests need a CSRF token (double-submit cookie) and a session cookie; the
examples use a cookie jar to handle both. Replace values marked `<...>`.

```bash
JAR=$(mktemp); CSRF=$(curl -s -c "$JAR" http://localhost:3000/health -o /dev/null \
  && awk '$6 == "holonet_csrf" {print $7}' "$JAR")

# Register (auto-logs in; session + CSRF cookies stored in $JAR)
curl -s -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"email":"admin@holonet.local","password":"<password>"}' \
  http://localhost:3000/api/auth/register

# Log in (seeded admin: admin@holonet.local / ADMIN_INITIAL_PASSWORD)
curl -s -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"email":"admin@holonet.local","password":"<ADMIN_INITIAL_PASSWORD>"}' \
  http://localhost:3000/api/auth/login

# Create a workspace (creator becomes owner)
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"name":"Acme","slug":"acme"}' http://localhost:3000/api/workspaces

# Create a site in the workspace
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"name":"Acme Site","slug":"acme-site"}' \
  http://localhost:3000/api/workspaces/<workspaceId>/sites

# Create a page
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"path":"/","title":"Home"}' http://localhost:3000/api/sites/<siteId>/pages

# Create a hero block (props are validated against the block type schema)
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'content-type: application/json' \
  -d '{"type":"hero","props":{"headline":"Welcome","alignment":"center"}}' \
  http://localhost:3000/api/pages/<pageId>/blocks

# Publish the site (queues a site_build job and a deployment)
curl -s -b "$JAR" -H "X-CSRF-Token: $CSRF" -X POST \
  http://localhost:3000/api/sites/<siteId>/publish
```

## Dashboard Development

The dashboard is a React 18 + Vite 5 + Tailwind CSS SPA in `apps/dashboard`
(React Router + TanStack Query + Zod):

```bash
pnpm --filter dashboard dev        # dev server on http://localhost:5173
pnpm --filter dashboard build      # typecheck + production build
pnpm --filter dashboard preview    # preview the production build
```

- **API access:** the dev server proxies `/api` (and `/storage`) to the local API on
  `http://localhost:3000` (vite.config.ts), so start the API first (`pnpm --filter api dev`).
- **Base URL:** `VITE_PUBLIC_API_BASE_URL` (see `apps/dashboard/.env.example`) defaults to
  `http://localhost:3000`; in production the dashboard is served behind
  https://holonet.section-zero.link and uses same-origin `/api`.
- **Routes:** `/login`, `/register`, `/dashboard`, `/sites`, `/sites/:siteId`,
  `/sites/:siteId/pages`, `/sites/:siteId/pages/:pageId`, `/sites/:siteId/theme`,
  `/sites/:siteId/publish`, `/sites/:siteId/forms`, `/sites/:siteId/import`, `/settings`,
  `/admin` — routing and the professional layout (sidebar, top bar with workspace selector
  placeholder) are in place; most feature pages are placeholders until their phases land.
- **API client:** `src/lib/api.ts` (fetch, cookies, CSRF header) with typed TanStack Query
  hooks for health, me, workspaces, sites, forms, and form submissions
  (`src/api/hooks.ts`). Login/register forms call the real auth endpoints, and
  `/sites/:siteId/forms` is a live submission inbox (form list + submission detail).

## 5. Environment variables

All configuration comes from environment variables — see `.env.example` (rules 10/11). Real values are never committed.

| Variable                                       | Meaning                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                     | `development` locally, `production` on Alibaba Cloud                                                |
| `PORT`                                         | Port for the local API server (default 3000)                                                        |
| `CORS_ORIGINS`                                 | Comma-separated origins allowed by CORS (local Vite dashboard by default)                           |
| `RATE_LIMIT_WINDOW_SECONDS`                    | Rate limit window for `/api/*` (default 60)                                                         |
| `RATE_LIMIT_MAX_REQUESTS`                      | Max requests per IP per window for `/api/*` (default 300)                                           |
| `BUILDER_INVOKER`                              | Builder invocation: `local` (in-process, development) or `fc` (Function Compute)                    |
| `PUBLIC_BASE_URL`                              | Fixed public base URL: `https://holonet.section-zero.link`                                          |
| `DATABASE_URL`                                 | PostgreSQL connection string (local dev default; production uses the private VPC address)           |
| `ALIBABA_CLOUD_REGION`                         | Alibaba Cloud region for Function Compute and OSS                                                   |
| `ALIBABA_CLOUD_ACCOUNT_ID`                     | Alibaba Cloud account ID (used to build ARNs)                                                       |
| `OSS_PUBLIC_BUCKET`                            | OSS bucket for public resources: JPG, CSS, JS, fonts, published sites, app assets                   |
| `OSS_PRIVATE_BUCKET`                           | OSS bucket for non-public resources: backups, form submissions, AI import snapshots                 |
| `OSS_ENDPOINT`                                 | OSS API endpoint for the chosen region                                                              |
| `OSS_PUBLIC_BASE_URL`                          | Public URL of the public bucket (static hosting origin)                                             |
| `STORAGE_PROVIDER`                             | Storage provider: `fs` (local filesystem, development) or `oss` (production)                        |
| `STORAGE_LOCAL_DIR`                            | Local storage root for `STORAGE_PROVIDER=fs` (default `.holonet-storage`)                           |
| `OSS_REGION`                                   | OSS region for the storage package (falls back to `ALIBABA_CLOUD_REGION`)                           |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`  | OSS AccessKey pair for local OSS testing only (FC uses the RAM role via STS)                        |
| `OSS_ROLE_ARN`                                 | Optional RAM role ARN for STS credentials on Function Compute                                       |
| `AUTH_SECRET`                                  | Session signing secret (min 32 chars — HS256 key size); dev placeholder, replace in production      |
| `SESSION_COOKIE_NAME`                          | Session cookie name (`holonet_session`)                                                             |
| `SESSION_MAX_AGE_SECONDS`                      | Session token lifetime in seconds (default 604800 = 7 days)                                         |
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
