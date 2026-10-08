# Holonet — Security

Holonet is security-first. This document records the standing security posture; it is updated in every phase (rule 13).

## Secrets and configuration (rules 10/11)

- No real secrets, AccessKeys, passwords, database credentials, or private keys are stored in code or documentation — ever.
- All configuration comes from environment variables; `.env.example` contains only placeholders and local development defaults.
- The local development `DATABASE_URL` in `.env.example` is a localhost-only default and must not be reused in production.
- `AUTH_SECRET` in `.env.example` is a placeholder (`change-me`) and must be replaced for any non-local environment.

## Untrusted data (rule 17)

- Imported website content and AI-generated output are **untrusted**.
- All imported content is validated against schemas (`packages/templates`, `packages/security`) before storage.
- Generated output is sanitized at the generation boundary in `packages/static-generator`; nothing imported or AI-generated is ever executed as code or template logic.
- Stored HTML is rendered only as static content, with CSP and output-encoding applied when displayed in the dashboard.

## Tenant isolation (rule 18)

- Every tenant-scoped table carries a `workspaceId`; all queries are workspace-scoped.
- Every API route requires a workspace context derived from authentication — cross-workspace access is rejected.
- Storage keys are workspace-prefixed (`<workspaceId>/…`) so a workspace can never read or list another workspace's objects.
- OSS buckets are separate by sensitivity: public bucket for published sites, private bucket for imports, form data, and backups.

## Authentication and sessions

- Sessions are signed with `AUTH_SECRET` and use the `SESSION_COOKIE_NAME` cookie (`holonet_session`).
- `COOKIE_SECURE=true` in production — cookies are HTTPS-only.
- Authorization is per-workspace; roles (owner/editor) arrive with the auth phase.

## Abuse prevention and audit (packages/security)

- **Rate limiting** — per-workspace and per-IP limits on API routes (`createRateLimiter`, currently a placeholder).
- **Audit logging** — security-relevant events (login, publish, backup, configuration changes) are recorded with workspace, actor, action, and outcome (`logAuditEvent`, currently a placeholder).
- **Validation** — all inputs validated with Zod at the API boundary.

## Network and storage

- Traffic is HTTPS-only; the fixed hostname `https://holonet.section-zero.link` fronts the platform.
- OSS private bucket has no public read; the public bucket policy allows `GetObject` only (see `infra/alibaba/oss/oss-bucket-policy.example.json`).
- Function Compute runs in the VPC (`VPC_ID`/`VSWITCH_IDS`/`SECURITY_GROUP_ID`) with a least-privilege RAM role (`infra/alibaba/ram/`).
- Backups are stored in the private OSS bucket; restore is an explicit, audited operation.

## Placeholder / upcoming

- Full threat model document and security checklist — later phase.
- CSP, HSTS, and cookie hardening details for the dashboard — dashboard phase.
- Secret rotation procedure for `AUTH_SECRET` and Alibaba Cloud credentials — deployment phase.
