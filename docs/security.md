# Holonet — Security

Holonet is security-first. This document records the standing security posture; it is updated in every phase (rule 13).

## Hardening status (launch verification)

| Area            | Control                                                                       | Status                                                                                                               |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Authentication  | scrypt password hashing (constant-time verify)                                | ✅ `packages/security/src/password.ts`                                                                               |
| Authentication  | HTTP-only, `Secure` (prod), `SameSite=Lax` session cookie                     | ✅ `apps/api/src/lib/session-cookie.ts`                                                                              |
| Authentication  | Login rate limiting (5 fails / 15 min per IP+email)                           | ✅ `apps/api/src/middleware/login-rate-limit.ts`                                                                     |
| Authentication  | Failed-login security events                                                  | ✅ `security_events` (`login_failed`, `login_rate_limited`)                                                          |
| Authentication  | **Admin MFA**                                                                 | ⚠️ Placeholder — data model exists, TOTP flow not yet enforced (see "MFA"). Blocking launch risk; mitigations below. |
| API             | Zod validation on all inputs                                                  | ✅ route schemas via `z` from `@holonet/security`                                                                    |
| API             | Tenant isolation checks                                                       | ✅ `requireSiteAccess` / `requirePageAccess` / `requireBlockAccess` / `requireFormAccess` + `workspaceFilter`        |
| API             | CSRF protection for state-changing routes                                     | ✅ double-submit cookie (`/forms` public route exempted by design)                                                   |
| API             | Security headers                                                              | ✅ `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP, HSTS (prod)            |
| API             | Error responses without stack traces                                          | ✅ `errorHandler` → stable JSON, `INTERNAL_ERROR` only                                                               |
| API             | Request logging                                                               | ✅ `X-Request-Id` + structured request logs                                                                          |
| API             | Audit logging                                                                 | ✅ `audit_logs` (auth, workspace, site, import events)                                                               |
| Storage         | Public bucket for intended public assets only                                 | ✅ bucket-scoped storage providers                                                                                   |
| Storage         | Private bucket for backups/imports/forms/AI raw snapshots                     | ✅ private provider + `imports/{ws}/{job}/raw/…` keys                                                                |
| Storage         | Database backups never public                                                 | ✅ backups stored locally / private bucket only (see "Network and storage")                                          |
| Storage         | No private media public                                                       | ✅ private provider issues no public URLs                                                                            |
| Storage         | Signed URLs for private assets                                                | ✅ `StorageProvider.getSignedUrl` (fs → plain URL; OSS → signed)                                                     |
| AI import       | SSRF protection (URL validation, private-IP blocking, redirect re-validation) | ✅ `packages/ai/src/url-guard.ts` + fetcher                                                                          |
| AI import       | robots.txt consideration                                                      | ✅ respected where practical                                                                                         |
| AI import       | Ownership confirmation                                                        | ✅ mandatory `ownershipConfirmed`                                                                                    |
| AI import       | Untrusted content handling                                                    | ✅ sanitization + length caps + HTML escaping (rule 17)                                                              |
| AI import       | AI output schema validation                                                   | ✅ Zod `importAnalysisOutputSchema` + re-validation before draft creation                                            |
| AI import       | No automatic publish                                                          | ✅ imports create draft pages only; no deployments/`current.json`                                                    |
| Published sites | Static output only                                                            | ✅ `packages/static-generator`                                                                                       |
| Published sites | Security headers for published output                                         | ✅ `headers.json` (CDN/OSS layer) + strict CSP `<meta>` baked into every page                                        |
| Published sites | No public database access                                                     | ✅ static files only                                                                                                 |
| Published sites | No CMS login exposed on public site                                           | ✅ dashboard is a separate origin; published sites expose only the public `POST /forms/:formId` endpoint             |
| Published sites | CSP recommendations                                                           | ✅ see "Published site security"                                                                                     |

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
- **CSRF-exempt public endpoints:** `POST /forms/:formId` is intentionally exempt (static sites
  submit cross-origin and cannot carry the token). It carries its own abuse protection instead —
  see "Public form submissions" below.
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

### Public form submissions

`POST /forms/:formId` is the one fully public, cross-origin state-changing endpoint. Published
static sites POST visitor submissions to `https://holonet.section-zero.link/forms/{formId}`.
Because it is public it is hardened against abuse:

- **Input validation** — the form ID must be a UUID; payloads are accepted as JSON or
  `application/x-www-form-urlencoded` only.
- **Payload size caps** — 64 KiB per submission (`413 PAYLOAD_TOO_LARGE` above that), max 50
  fields, max 10 KiB per field value. Oversized or malformed bodies are rejected before any
  storage.
- **Honeypot field** — generated forms include a hidden `website` input (CSS-positioned off
  screen, `tabindex="-1"`, `autocomplete="off"`). Submissions with a non-empty honeypot are
  **silently discarded** — the response is identical to a real success.
- **Rate limiting by IP + form ID** — 10 submissions per minute per IP per form. Tripped limits
  are also silently discarded (generic success) so the limit is not discoverable.
- **Generic responses** — `{ "ok": true }` for stored submissions, discarded spam, rate-limited
  requests, and unknown-but-well-formed form IDs alike; a malformed form ID returns a generic
  `404 NOT_FOUND`. Form existence and spam handling are never revealed.
- **Storage** — submissions are stored in `form_submissions` (PostgreSQL, behind the API — not
  in any publicly readable bucket). Raw client IPs are never stored; only a SHA-256 hash
  (`ip_hash`) for abuse analysis.
- **No public exposure** — `GET /api/forms/:formId/submissions` requires an authenticated
  workspace member (via form → site → workspace access control); non-members receive `404`.
- **Security events for repeated abuse** — honeypot-triggered spam records
  `form_spam_detected`; rate-limit blocks record `form_rate_limited` (severity `warning`) on
  the first block and every 5th block thereafter, so repeated abuse escalates in the security
  event stream.
- **Webhook placeholder** — when a form sets `notification_email`, a `form_notification` job is
  enqueued in the `jobs` table for future delivery; no external webhook is invoked yet.
- **Limits** — the IP+form limiter is in-memory per instance; like the login limiter it moves to
  a shared store (Redis) for multi-instance Function Compute deployments.

Implementation: `apps/api/src/routes/forms.ts`, `packages/static-generator/src/html.ts`
(`formActionUrl`), `apps/api/src/middleware/access.ts` (`requireFormAccess`).

### AI website import

`POST /api/sites/:siteId/import` fetches an external website into the platform
(foundation phase: fetch + analysis only). Because it makes server-side requests to
user-supplied URLs it is treated as a high-risk SSRF surface and hardened accordingly:

- **Ownership confirmation** — `ownershipConfirmed` must be `true` or the request is
  rejected with `400` before any work happens.
- **URL validation** (`packages/ai/src/url-guard.ts`) — only `http`/`https`; no
  credentials in URLs; only default ports (80/443); syntactically valid domains with a
  real TLD; hostname blocklist (`localhost`, `*.localhost`, cloud metadata hostnames).
- **IP allowlist** — literal IPs and **every DNS answer** are checked against the public
  unicast ranges: `localhost`, loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`,
  `192.168/16`, `fc00::/7`), link-local (`169.254/16` — which covers the cloud metadata
  endpoint `169.254.169.254` — and `fe80::/10`), CGNAT (`100.64/10`), multicast,
  TEST-NET, and reserved ranges are all refused. DNS is re-resolved and re-validated for
  every redirect hop, so redirects cannot smuggle requests to internal hosts.
- **Bounded fetcher** (`packages/ai/src/fetcher.ts`) — max 3 pages per import, 5 MiB per
  page, 20 s per request (AbortSignal timeout), fixed user agent `HolonetImporter/0.1`,
  HTML content types only, no JavaScript execution, redirects followed manually with
  per-hop re-validation.
- **No credential support** — the importer never sends cookies, authorization headers,
  or any credentials. `401`/`403` responses abort the import (`auth-required`); `402`
  responses abort as `paywall` — paywalls are never bypassed.
- **robots.txt** — checked where practical; paths disallowed for `User-agent: *` refuse
  the import (`robots-disallowed` → job status `rejected`).
- **Job lifecycle** — every attempt creates an `import_jobs` row that transitions
  `pending → fetching → analyzing → completed | failed | rejected`; policy violations
  (invalid URL, blocked host, robots) land as `rejected`, runtime failures as `failed`,
  both with `error_message` and `finished_at` set — failures are stored safely, never
  half-published.
- **Raw content stays private** — fetched HTML is stored only in the **private** storage
  bucket under `imports/{workspaceId}/{importJobId}/raw/` (with a manifest). It is never
  written to the public bucket and no public URL is issued for it. Admin-only access to
  job metadata is via `GET /api/admin/import-jobs` (`requireAdmin`).
- **Untrusted content (rule 17)** — fetched HTML and AI output are untrusted data;
  `ai_analyses.output` is JSONB that downstream rendering must escape like any visitor
  content. The heuristic analyzer only extracts plain text/titles/headings.
- **Nothing is published automatically** — the importer creates no deployments, touches
  no `current.json`, and never publishes. Imported content may only ever become **draft
  pages** (`pages.status = 'draft'`), in the content-generation phase.
- **Audit** — every import attempt is recorded in `audit_logs` (`site_import`) with the
  outcome (`completed` | `rejected` | `failed`) and hashed IP.
- **Limits** — the API runs imports inline within the request (bounded by the fetcher
  limits above); production can move this into the `jobs` queue on Function Compute
  without changing the route contract.

Implementation: `apps/api/src/routes/sites.ts` (`importSiteHandler`),
`apps/api/src/routes/admin.ts`, `packages/ai/src/{url-guard,fetcher,analyze}.ts`.

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
- **Launch consideration:** admin MFA is the one blocking hardening gap (see the hardening
  status table). Until the TOTP flow lands, mitigate with:
  1. a dedicated admin account with a unique, high-entropy password not used anywhere else;
  2. failed-login alerts via the `security_events` stream (`login_failed` /
     `login_rate_limited` — monitor them in SLS);
  3. admin logins only from a trusted network path (no shared dashboards);
  4. implement the TOTP enrollment/challenge flow before granting admin to anyone beyond the
     single bootstrap operator.

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
- **Backups are stored in the private OSS bucket (or locally on the Docker host)** — a database
  dump must never land in the public bucket, in the repository (`backups/` is git-ignored), or on
  any public URL. Restore is an explicit, audited operation.
- **Private media stays private:** the private storage provider issues no public URLs; when
  private objects need to be shown, use `StorageProvider.getSignedUrl` (time-limited; OSS-signed,
  local fs returns the plain URL — nothing to sign).

## Published site security

Published sites are fully static (`packages/static-generator`) and carry their own hardening:

- **Strict CSP baked into every page** as a `<meta http-equiv="Content-Security-Policy">`:
  `default-src 'none'; style-src 'self'; img-src 'self' data: https:; script-src 'self';
font-src 'self'; base-uri 'self'; form-action <site origin>; frame-ancestors 'none'`.
  Generated pages contain no inline scripts or styles, so no `'unsafe-inline'` is needed.
- **`headers.json`** in every release recommends the same header set for the CDN/OSS layer
  (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`,
  CSP), plus per-path cache rules (`*.html` → `no-cache`, `/assets/*` → immutable).
- **No database access from the public site** — visitors only ever receive static files from
  OSS and the public `POST /forms/:formId` endpoint (abuse-protected, see above).
- **No CMS surface on the public site** — the dashboard and its login live on a separate
  origin; published pages contain no admin links, no `/api` references, and no CMS markup.
- Form submissions are constrained by the page CSP (`form-action`) to the site's configured
  base origin.

## Placeholder / upcoming

- Full threat model document and security checklist — later phase.
- CSP, HSTS, and cookie hardening details for the dashboard — dashboard phase.
- Secret rotation procedure for `AUTH_SECRET` and Alibaba Cloud credentials — deployment phase.
