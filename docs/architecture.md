# Holonet — Architecture

> Status: scaffold phase. No business logic is implemented yet; entrypoints and interfaces are
> placeholders marked as such. This document describes the intended architecture in detail.

## Overview

Holonet is a security-first static website platform with AI-assisted website import,
template-based publishing, form handling, backups, and managed static hosting. The same
TypeScript code runs in two environments:

- **Local development** — a Node.js API, a React dashboard on a Vite dev server, PostgreSQL in
  Docker, and local filesystem storage (optionally MinIO as an OSS stand-in).
- **Production** — Alibaba Cloud Function Compute hosts the API/dashboard entrypoint and a
  separate build function; PostgreSQL runs in Docker on a Docker host inside a VPC; OSS stores all
  objects.

## Components

| Package                     | Responsibility                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                  | Hono HTTP API. Two entrypoints: `src/index.ts` (local Node server via `@hono/node-server`) and `src/function.ts` (Function Compute HTTP-triggered handler). |
| `apps/dashboard`            | React dashboard built with Vite. Calls the API; never talks to the database directly.                                                                       |
| `apps/builder`              | Static site build worker. Deployed as its own Function Compute function; loads site data, generates static files, publishes to OSS.                         |
| `packages/core`             | Shared constants (service name, public base URL) and domain identifier types (`WorkspaceId`, `SiteId`).                                                     |
| `packages/db`               | Drizzle ORM schema, migrations, and a PostgreSQL client factory.                                                                                            |
| `packages/storage`          | Storage abstraction with `local` (development/tests) and `oss` (production) backends.                                                                       |
| `packages/templates`        | Template manifest and block schemas (Zod) — the contract templates and the generator agree on.                                                              |
| `packages/static-generator` | Turns Holonet site data into static website files (HTML, CSS, JS, assets).                                                                                  |
| `packages/ai`               | AI import provider interfaces (`AiImportProvider`) plus a provider registry.                                                                                |
| `packages/security`         | Validation (Zod), rate limiting, audit logging, and security event utilities.                                                                               |

## Local development architecture

| Piece                        | How it runs                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| API (`apps/api`)             | Node.js 20 process via `pnpm dev` — Hono app served by `@hono/node-server` on port 3000.                                                            |
| Dashboard (`apps/dashboard`) | Vite dev server on port 5173; proxies API calls to the local Node API.                                                                              |
| PostgreSQL                   | Docker Compose (`infra/docker/docker-compose.yml`), port 5432, credentials matching the local `DATABASE_URL`.                                       |
| Storage                      | Local filesystem backend (`packages/storage`, `kind: 'local'`) rooted at a workspace-local directory.                                               |
| Optional MinIO               | S3-compatible object server in Docker (port 9000) that simulates OSS, so the OSS code path can be exercised locally without touching Alibaba Cloud. |
| Builder (`apps/builder`)     | Runs as a local worker (`pnpm --filter @holonet/builder dev`), reading from PostgreSQL and writing artifacts to local storage.                      |

```mermaid
flowchart LR
    subgraph DevMachine["Local development machine"]
        Browser["Browser"]
        Dashboard["apps/dashboard<br/>Vite dev server :5173"]
        API["apps/api<br/>Hono on Node.js 20 :3000"]
        Builder["apps/builder<br/>local worker"]
        PG[("PostgreSQL 16<br/>Docker Compose :5432")]
        LocalFS[("Local filesystem storage")]
        MinIO[("Optional: MinIO<br/>OSS simulation :9000")]
    end
    Browser --> Dashboard
    Dashboard -->|"API calls (dev proxy)"| API
    API -->|"SQL on localhost"| PG
    API -->|"put/get objects"| LocalFS
    Builder -->|"read site data"| PG
    Builder -->|"publish artifacts"| LocalFS
    API -.->|"optional OSS simulation"| MinIO
    Builder -.->|"optional OSS simulation"| MinIO
```

Development state: PostgreSQL data persists in a Docker volume; all object data lives on the local
disk; no Alibaba Cloud resources are required to develop or test.

## Production architecture

| Piece                      | Alibaba Cloud service                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| API + dashboard entrypoint | Function Compute function `holonet-app` (`FC_FUNCTION_NAME_APP`)                  |
| Static site builds         | Separate Function Compute function `holonet-builder` (`FC_FUNCTION_NAME_BUILDER`) |
| Metadata database          | PostgreSQL 16 running in Docker on a Docker host (ECS) inside the VPC             |
| Public objects             | OSS public bucket: JPG, CSS, JS, fonts, published static websites, app assets     |
| Non-public objects         | OSS private bucket: backups, form submissions, AI import snapshots                |
| Deployment identity        | Dedicated RAM user (AccessKey pair only in the deployer's environment)            |
| Function identity          | RAM role assumed by Function Compute, granting OSS and SLS log access             |
| Public entry               | Custom domain https://holonet.section-zero.link                                   |

- The `holonet-app` function serves the **dashboard HTML** (from the OSS-stored SPA bundle) and
  the **API** behind the custom domain.
- The `holonet-builder` function performs static site builds: it reads site data from PostgreSQL,
  generates files via `packages/static-generator`, and uploads them to OSS.
- PostgreSQL runs in Docker on a Docker host inside the VPC. Function Compute reaches it over the
  VPC **private network** (`VPC_ID`/`VSWITCH_IDS`/`SECURITY_GROUP_ID`); the database has no public
  endpoint (explicit constraints in docs/infrastructure.md).
- All object data is in OSS: public resources in the public bucket, everything else in the private
  bucket.
- Deployment is performed by a dedicated **RAM user**; the running functions use a **RAM role**
  with least-privilege OSS and SLS access (templates in `infra/alibaba/`).
- The custom domain https://holonet.section-zero.link fronts the platform; published sites are
  served from the OSS public bucket (optionally via CDN — see future upgrade paths).

```mermaid
flowchart TB
    subgraph Users["End users"]
        Browser["Browser"]
        Visitors["Published site visitors"]
    end

    subgraph Cloud["Alibaba Cloud account"]
        RAMUser["Deployer RAM user<br/>CLI / console"]
        FCApp["Function Compute: holonet-app<br/>API + dashboard HTML entrypoint"]
        FCBuilder["Function Compute: holonet-builder<br/>static site build worker"]
        OSSPub[("OSS public bucket<br/>published sites, app assets<br/>JPG / CSS / JS / fonts")]
        OSSPriv[("OSS private bucket<br/>backups, form submissions,<br/>AI import snapshots")]
        SLS["SLS — function logs"]
        subgraph VPC["VPC"]
            DockerHost["Docker host (ECS)<br/>PostgreSQL 16 in Docker<br/>private IP only"]
        end
    end

    Browser -->|"https://holonet.section-zero.link"| FCApp
    FCApp -->|"SQL over private network"| DockerHost
    FCBuilder -->|"SQL over private network"| DockerHost
    FCApp -->|"RAM role"| OSSPub
    FCApp -->|"RAM role"| OSSPriv
    FCBuilder -->|"RAM role"| OSSPub
    FCApp -->|"RAM role"| SLS
    FCBuilder -->|"RAM role"| SLS
    Visitors -->|"published sites"| OSSPub
    RAMUser -->|"deploys functions"| FCApp
    RAMUser -->|"deploys functions"| FCBuilder
    RAMUser -->|"uploads app assets"| OSSPub
```

## Request flow

1. A browser visits https://holonet.section-zero.link.
2. Function Compute (`holonet-app`) returns the dashboard HTML or an API response.
3. Static assets (dashboard JS/CSS and other app assets) are loaded from the OSS public bucket.
4. API calls read from and write to PostgreSQL over the VPC private network.
5. A publish action invokes the `holonet-builder` Function Compute function.
6. The builder loads the site data, generates the static site, and uploads the files to the OSS
   public bucket.
7. The published site is served from OSS (or a CDN/OSS-backed domain).

```mermaid
sequenceDiagram
    participant B as Browser
    participant FC as Function Compute holonet-app
    participant OSS as OSS public bucket
    participant DB as PostgreSQL (Docker, VPC)
    participant BU as Function Compute holonet-builder
    participant CDN as CDN / OSS-backed domain

    B->>FC: 1. GET https://holonet.section-zero.link/
    FC->>DB: read workspace/site data (private network)
    FC-->>B: 2. dashboard HTML or API response
    B->>OSS: 3. load dashboard JS/CSS/assets
    OSS-->>B: static assets
    B->>FC: 4. API call (e.g. update site)
    FC->>DB: write to PostgreSQL
    FC-->>B: response
    B->>FC: 5. POST publish
    FC->>BU: invoke builder function
    BU->>DB: read site data (private network)
    BU->>BU: 6. generate static site
    BU->>OSS: upload published files
    BU-->>FC: build result
    FC-->>B: publish complete
    B->>CDN: 7. visit published site
    CDN->>OSS: origin fetch
    OSS-->>B: static pages
```

## Key decisions

1. **Function-first entrypoints.** The API, builder, and background jobs expose small entrypoints
   (local server wrapper + FC handler) so the same code runs locally and on Function Compute.
2. **Stateless compute.** Function Compute instances are ephemeral; all durable state lives in
   PostgreSQL and OSS.
3. **Database is infrastructure.** Function Compute cannot host a persistent PostgreSQL database;
   PostgreSQL runs in Docker on a host inside the VPC (see docs/infrastructure.md).
4. **Source-based internal packages.** Internal packages are consumed directly from `src/` via
   workspace links (`workspace:*` + `exports` pointing at `src/index.ts`); no internal publishing
   step.
5. **Tenant isolation by workspace.** Every tenant-scoped table carries a `workspaceId`; every API
   route is workspace-scoped; every storage key is workspace-prefixed (rule 18).
6. **Untrusted content.** Imported websites and AI output are treated as untrusted data and
   sanitized at the generation boundary (rule 17).

## Future upgrade paths

| Today                                 | Planned upgrade                                  | Why                                                                                                 |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| PostgreSQL in Docker on an ECS host   | Managed PostgreSQL (ApsaraDB RDS for PostgreSQL) | Managed backups, HA, patching — same private VPC connectivity, no application change                |
| Direct OSS-backed domain / FC domain  | CDN (Alibaba Cloud CDN/DCDN)                     | Edge caching, TLS termination, DDoS protection for the dashboard and published sites                |
| Direct function invocation for builds | Redis queue (ApsaraDB for Redis / Tair)          | Decouples publisher from builder; adds retries, backpressure, and job observability                 |
| Docker host on a single ECS           | Kubernetes (ACK)                                 | Orchestrates builders, workers, and the database with declarative infrastructure                    |
| Manual billing                        | Merchant-of-record payment integration           | Subscriptions and invoicing handled by a merchant of record (e.g. Paddle, Stripe, Lemon Squeezy)    |
| External AI provider (`AI_PROVIDER`)  | Internally hosted AI model                       | A self-hosted model (e.g. vLLM-served LLM on GPU ECS inside the VPC) keeps imported data in-network |

## Placeholders and assumptions

Open questions (marked `PLACEHOLDER` in the relevant files) are tracked in
docs/infrastructure.md: FC HTTP-trigger signature, deployment tooling, Docker host specifics,
MinIO add-on packaging, and the OSS SDK choice.
