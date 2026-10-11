# Alibaba Cloud Setup — Holonet

Step-by-step setup of Alibaba Cloud for Holonet: RAM identities, OSS buckets,
VPC + PostgreSQL, Function Compute, and the custom domain. This document is
the **account/infrastructure setup guide**; once the resources exist, day-to-day
deploys follow [docs/deployment.md](deployment.md) and
[infra/alibaba/README.md](../infra/alibaba/README.md).

> **Security rule:** no real credentials, AccessKeys, or secrets appear in this
> document or anywhere in the repository (docs/PROJECT_RULES.md rule 10). Values
> like `<ALIBABA_CLOUD_ACCOUNT_ID>` are placeholders you replace locally.

---

## 1. Prerequisites

| Item                       | Required? | Notes                                                                                                                                 |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Alibaba Cloud account      | Yes       | Real-name verified account with billing enabled.                                                                                      |
| Domain `section-zero.link` | Yes       | The fixed public hostname is `https://holonet.section-zero.link`.                                                                     |
| DNS management access      | Yes       | The domain must be resolvable by Alibaba Cloud DNS (or a DNS provider you can update) to verify ownership and bind the custom domain. |
| Node.js 20                 | Yes       | Function runtime and local tooling (`node -v` ≥ 20).                                                                                  |
| pnpm                       | Yes       | Monorepo package manager (`pnpm -v` ≥ 9).                                                                                             |
| Docker                     | Yes       | PostgreSQL runs in Docker on the Docker host inside the VPC.                                                                          |
| Serverless Devs CLI        | Yes       | `npm install -g @serverless-devs/s` — drives Function Compute deploys from `infra/alibaba/s.yaml`.                                    |
| Alibaba Cloud CLI          | Optional  | Useful for one-off queries and manual steps (`aliyun`).                                                                               |

## 2. Create the deployment RAM user (`holonet-deployer`)

1. In the Alibaba Cloud console open **RAM → Users → Create User**.
2. User name: `holonet-deployer`.
3. Access mode: **programmatic access** (OpenAPI AccessKey) — this user never
   signs in to the console.
4. After creation, download/store the AccessKey pair **once**:

   - The AccessKey ID and AccessKey Secret exist **only on your local machine**
     (e.g. in the Serverless Devs access profile, `~/.s/access.yaml`, or your
     password manager). They are never committed to Git, never pasted into
     `.env.deploy`, and never placed in CI logs.

```bash
s config add --AccessKeyID <RAM_USER_AK> --AccessKeySecret <RAM_USER_SK> -a holonet
```

Rotate this key pair periodically (RAM console → the user → AccessKeys).

## 3. Attach policies to `holonet-deployer`

### Initial setup (broad — bootstrap only)

During the first setup the deployer must create buckets, the FC role, and
functions. Attach these managed policies temporarily:

- `AliyunFCFullAccess` — create/update Function Compute services, functions, triggers.
- `AliyunOSSFullAccess` — create buckets and upload assets.
- `AliyunRAMReadOnlyAccess` — read the FC role; replace with a limited RAM
  policy scoped to `holonet-fc-role` once it exists (see section 10).
- `AliyunVPCReadOnlyAccess` — read VPC/vSwitch/security group configuration.
- `AliyunECSReadOnlyAccess` — only if the Docker host (ECS) is managed from this
  account; otherwise skip.
- `AliyunLogFullAccess` — only if the deployer also creates the SLS project/logstores;
  otherwise skip.

### Production (least privilege — recommended)

After setup completes, replace the broad policies with a custom policy that
allows only what `infra/scripts/deploy.sh` needs: Function Compute management,
OSS writes to the public bucket (dashboard assets), OSS writes to the private
bucket (backup uploads), and read access to the FC role. A full example is in
section 10 (`holonet-deployer` production policy). Review it against the latest
Alibaba Cloud RAM documentation before applying.

## 4. Create the RAM role for Function Compute (`holonet-fc-role`)

1. RAM console → **Roles → Create Role → Service role**.
2. Trusted service: **Function Compute** (`fc.aliyuncs.com`).
3. Role name: `holonet-fc-role`.
4. Purpose: allow Function Compute to **read/write the two OSS buckets**, **write
   logs to SLS**, and **use VPC network interfaces** (to reach PostgreSQL).

Trust policy (also available as a starting point in
`infra/alibaba/ram/`):

```json
{
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Effect": "Allow",
      "Principal": {
        "Service": ["fc.aliyuncs.com"]
      }
    }
  ],
  "Version": "1"
}
```

Attach the role's permission policy from section 10 (`holonet-fc-role` policy —
OSS access to the two Holonet buckets plus SLS log writes). The role ARN looks
like:

```
acs:ram::<ALIBABA_CLOUD_ACCOUNT_ID>:role/holonet-fc-role
```

This value goes into `FC_ROLE_ARN` (`.env.deploy` / Function Compute
environment) and is referenced by `infra/alibaba/s.yaml`.

## 5. Create the OSS buckets

Create two buckets in the same region as Function Compute
(`ALIBABA_CLOUD_REGION`):

| Bucket                         | Purpose                                                             | Public?                                                                              |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `holonet-section-zero-public`  | Published static sites, dashboard SPA assets (JS/CSS/fonts/images). | Yes — read-only object access for visitors (`oss/oss-bucket-policy.example.json`).   |
| `holonet-section-zero-private` | Backups, form-submission/import raw data, snapshots.                | **No.** Never enable public read; only the FC role (and the deployer) can access it. |

Notes:

- **Public bucket** — apply the bucket policy in
  `infra/alibaba/oss/oss-bucket-policy.example.json` (allows `GetObject` only).
  Use the OSS static-website/CDN endpoint as `OSS_PUBLIC_BASE_URL`.
- **Private bucket** — leave the ACL private and issue no public endpoints.
  `packages/storage` addresses it only through the RAM role (STS) or the
  deployer's credentials.
- **Lifecycle rules** — optional: configure rules in the **private** bucket to
  transition or expire old backups (e.g. expire after N days); keep at least
  the latest daily/weekly backups.
- **Encryption** — enable server-side encryption (SSE-OSS/KMS) on both buckets
  if available in your region; it is transparent to `packages/storage`.

## 6. Create the VPC and security group

1. **VPC** — create a VPC in `ALIBABA_CLOUD_REGION` with a private CIDR
   (e.g. `10.0.0.0/16`). Note the `VPC_ID`.
2. **vSwitch** — create a vSwitch inside the VPC (e.g. `10.0.1.0/24`). Note the
   `VSWITCH_IDS`.
3. **Security group** — create a security group `holonet-sg`. Note the
   `SECURITY_GROUP_ID`.
4. **Docker host (ECS)** — provision an ECS instance **inside the VPC** (no
   public IP / no public exposure) to run PostgreSQL in Docker.
5. **PostgreSQL access** — in the security group, allow **TCP 5432 only** from
   the Function Compute attachment (restrict the source to that security group
   or the VPC private range).
6. **Never expose PostgreSQL publicly** — no public IP, no port forwarding, no
   `0.0.0.0/0` rule. Function Compute reaches the database only over the VPC
   private network.

The three network identifiers go into `.env.deploy`:
`VPC_ID`, `VSWITCH_IDS`, `SECURITY_GROUP_ID`.

## 7. Deploy PostgreSQL in Docker

On the Docker host inside the VPC (see `infra/docker/docker-compose.prod.yml` —
it publishes **no ports** by default; bind PostgreSQL to the private VPC
interface only):

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

Then apply the schema from inside the VPC (or through a private tunnel):

```bash
pnpm db:migrate   # DATABASE_URL=postgres://holonet:<DB_PASSWORD>@<DB_PRIVATE_HOST>:5432/holonet
```

**Backups** (pg_dump custom format; upload the dump to the private OSS bucket):

```bash
infra/scripts/db-backup.sh        # also: infra/scripts/backup-db.sh [backup-dir]
```

**Restore** (test this regularly — an untested backup is not a backup):

```bash
infra/scripts/db-restore.sh <dump-file>   # also: infra/scripts/restore-db.sh <dump-file>
```

## 8. Configure Function Compute environment variables

The functions receive configuration **only** through environment variables
(rules 10/11). In production, enter them either in the Function Compute
console or — preferably — in `infra/alibaba/.env.deploy` (copied from
`.env.deploy.example`), which `infra/scripts/deploy.sh` exports before
Serverless Devs deploys `infra/alibaba/s.yaml`.

| Variable             | Meaning                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Private PostgreSQL URL — `postgres://holonet:<DB_PASSWORD>@<DB_PRIVATE_HOST>:5432/holonet` (private host only). |
| `PUBLIC_BASE_URL`    | `https://holonet.section-zero.link` (fixed hostname — never change it).                                         |
| `OSS_PUBLIC_BUCKET`  | `holonet-section-zero-public`.                                                                                  |
| `OSS_PRIVATE_BUCKET` | `holonet-section-zero-private`.                                                                                 |
| `OSS_ENDPOINT`       | `https://oss-<ALIBABA_CLOUD_REGION>.aliyuncs.com`.                                                              |
| `OSS_REGION`         | The bucket region (`ALIBABA_CLOUD_REGION`).                                                                     |
| `AUTH_SECRET`        | Strong random session-signing secret (≥32 chars) — replace the development placeholder.                         |
| `AI_PROVIDER`        | `manual` (default), `http` (OpenAI/Qwen-compatible), or `ollama` (placeholder).                                 |
| `AI_ENDPOINT`        | Chat-completions endpoint when `AI_PROVIDER=http`.                                                              |
| `AI_MODEL`           | Model name (e.g. `qwen-plus`) or `holonet-heuristics` for manual.                                               |

Secrets (`DATABASE_URL`, `AUTH_SECRET`, `AI_API_KEY`, …) are entered in the
Function Compute console or in your local `.env.deploy` — **never committed to
Git**. `deploy-check.sh --production` refuses placeholder values and a
non-fixed `PUBLIC_BASE_URL`.

## 9. Configure the custom domain

Domain: **holonet.section-zero.link** (CNAME on `section-zero.link`).

1. **DNS record** — point `holonet.section-zero.link` at the Function Compute
   HTTP-trigger endpoint (CNAME; the target is shown on the trigger in the FC
   console).
2. **Verify domain ownership** — verify `section-zero.link` in the SSL/DNS
   console (TXT record or file verification) before certificates can be issued.
3. **HTTPS certificate** — issue a free DV certificate for
   `holonet.section-zero.link` (SSL Certificates Service), then bind it.
4. **Bind the custom domain** — in Function Compute (or the `customDomains`
   block in `infra/alibaba/s.yaml`), bind the domain with protocol HTTPS and
   the certificate, routing **`/*` to `holonet-app`**.
5. **Test** — `curl -i https://holonet.section-zero.link/health` → `200`
   `{ "ok": true, "service": "holonet" }`.

> **ICP filing (mainland China regions).** If `ALIBABA_CLOUD_REGION` is in
> mainland China, binding a custom domain to a public endpoint may require an
> ICP (备案) filing for the domain. If no ICP filing exists, consider a
> non-mainland region (e.g. Hong Kong or Singapore) where legally appropriate
> for your use case. Always verify the current requirements for your region
> before going live.

## 10. Least-privilege RAM policy examples

Templates also live under `infra/alibaba/ram/`. Replace
`<ALIBABA_CLOUD_ACCOUNT_ID>` and bucket names with real values; review against
the latest RAM/OSS/SLS documentation before applying.

### `holonet-deployer` (production policy)

What `deploy.sh` actually does: manage FC services/functions/triggers, upload
dashboard assets + backups to OSS, and read the FC role:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "fc:CreateService",
        "fc:UpdateService",
        "fc:GetService",
        "fc:ListServices",
        "fc:CreateFunction",
        "fc:UpdateFunction",
        "fc:GetFunction",
        "fc:ListFunctions",
        "fc:CreateTrigger",
        "fc:UpdateTrigger",
        "fc:GetTrigger",
        "fc:ListTriggers",
        "fc:InvokeFunction"
      ],
      "Resource": ["acs:fc:*:<ALIBABA_CLOUD_ACCOUNT_ID>:*/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["ram:GetRole"],
      "Resource": ["acs:ram::<ALIBABA_CLOUD_ACCOUNT_ID>:role/holonet-fc-role"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject", "oss:ListObjects", "oss:DeleteObject"],
      "Resource": [
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-public/*",
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-private/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["vpc:DescribeVpcs", "vpc:DescribeVSwitches", "vpc:DescribeSecurityGroups"],
      "Resource": ["*"]
    }
  ]
}
```

### `holonet-fc-role` (function execution policy)

OSS object access to the two buckets only, plus SLS log writes:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject", "oss:ListObjects"],
      "Resource": [
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-public",
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-public/*",
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-private",
        "acs:oss:*:<ALIBABA_CLOUD_ACCOUNT_ID>:holonet-section-zero-private/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["log:PostLogStoreLogs"],
      "Resource": ["acs:log:*:<ALIBABA_CLOUD_ACCOUNT_ID>:project/holonet-sls/logstore/*"]
    }
  ]
}
```

> The VPC network interfaces used by Function Compute are created by the FC
> service itself; if your region's FC documentation requires explicit VPC
> permissions on the role, add the read actions
> (`vpc:DescribeVSwitchAttributes` etc.) scoped to your vSwitch.

---

## After setup

Continue with [docs/deployment.md](deployment.md) for the deployment procedure
(`deploy-check.sh --production` → `deploy.sh`), and use
[infra/alibaba/README.md](../infra/alibaba/README.md) for the deployment
checklist, local packaging, and builder invocation.
