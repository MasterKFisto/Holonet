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

## Authentication design

### Passwords

- Passwords are hashed with **Node.js crypto scrypt** (no native modules — deploys cleanly to
  Function Compute). Stored format embeds a random 16-byte salt:
  `scrypt$<salt hex>$<hash hex>` (64-byte derived key).
- Verification is **constant-time** (`timingSafeEqual`). Plaintext passwords are never stored or
  logged; login runs the same hashing work for unknown emails so timing does not reveal account
  existence.
- Registration enforces Zod-validated passwords (12–128 characters).
- Implementation: `packages/security/src/password.ts`.

### Sessions (JWT in HTTP-only cookies)

- Session tokens are **signed JWTs (HS256) via jose** (pure JavaScript). Claims: `sub` (user id),
  `email`, `role`, `ver` (session version). Signed with `AUTH_SECRET` (minimum 32 characters —
  the HS256 key size).
- The token is stored in an **HTTP-only cookie** (`SESSION_COOKIE_NAME`, default
  `holonet_session`): `HttpOnly`, `SameSite=Lax`, `Secure` in production, expiry
  `SESSION_MAX_AGE_SECONDS` (default 7 days).
- **Revocation:** every user carries `users.token_version`. Logout and password reset increment
  it, so previously issued tokens fail the `ver` check and are rejected — no server-side session
  store required.
- The database is authoritative for role/status: `requireUser` re-loads the user on every request
  (a disabled account or demoted role takes effect immediately).
- Implementation: `packages/security/src/session.ts`, `apps/api/src/middleware/auth.ts`.

### CSRF protection

- **Double-submit cookie:** every response sets a readable `holonet_csrf` cookie (random 256-bit
  token); state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) must echo it in the
  `X-CSRF-Token` header. Cross-origin attackers cannot read the cookie, so they cannot forge the
  header. Combined with `SameSite=Lax` this blocks CSRF across all state-changing API routes.
- Implementation: `apps/api/src/middleware/csrf.ts`.

### Login protection

- **Login rate limiting:** 5 failed attempts per IP+email within 15 minutes block further logins
  with `429 RATE_LIMITED` (`Retry-After` header). In-memory per instance; a Redis-backed limiter
  is a future upgrade path for multi-instance Function Compute.
- **Security events:** every failed login records a `security_events` row
  (`login_failed`, severity `warning`); blocks record `login_rate_limited`. Raw IPs are never
  stored — only a SHA-256 hash.
- **Audit logs:** `user_registered`, `user_logged_in`, `user_logged_out`,
  `password_reset_requested`, and `password_reset_completed` are written to `audit_logs`.
- Implementation: `apps/api/src/middleware/login-rate-limit.ts`, `apps/api/src/lib/security.ts`.

### Password reset

- `POST /api/auth/forgot-password` always returns the same success response — **whether or not
  the email exists is never revealed**.
- Reset tokens are random 256-bit values, valid for 1 hour, single-use. **Only the SHA-256 hash
  is stored** (`password_reset_tokens.token_hash`); the raw token is returned only in
  non-production environments as a dev affordance. PLACEHOLDER: an email transport arrives in a
  later phase.
- A successful reset updates the password hash, marks the token used, increments
  `users.token_version` (invalidating all sessions), and audits the event.
- Implementation: `apps/api/src/routes/auth.ts`.

### Roles and authorization

- `users.role` is `admin` | `member` (admin field prepared at registration).
- `requireUser` → resolves the session; `requireAdmin` → requires `role = 'admin'`;
  `requireWorkspaceAccess` → requires an active `workspace_members` row for the route's
  `:workspaceId`. Non-members receive `404` (not `403`) so workspace existence is never leaked —
  cross-workspace access is prevented by construction (rule 18).

### MFA (data model prepared, not yet enforced)

- `users.mfa_secret`, `users.mfa_enabled`, and `users.mfa_recovery_codes` exist in the schema.
  The full MFA enrollment/challenge flow (TOTP) arrives in a later phase; no MFA fields are ever
  returned by the API.

### Error disclosure

- All errors use the stable `{ error: { code, message, details? }, requestId? }` shape. Stack
  traces are never returned; unexpected failures log server-side only and respond with
  `INTERNAL_ERROR`.

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
