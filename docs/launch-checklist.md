# Holonet — Launch Checklist

Run through this list before every launch (initial and each major update).
Tracked against the hardening status table in [docs/security.md](security.md).

## Local checks

```bash
pnpm install                      # dependencies resolve
pnpm lint                         # 0 errors
pnpm typecheck                    # all packages pass
pnpm test                         # full suite green (incl. integration tests with DATABASE_URL)
```

- [ ] `docker compose -f infra/docker/docker-compose.yml up -d` starts PostgreSQL
      (and the database container responds on the configured port)
- [ ] `pnpm db:migrate` applies all migrations cleanly
- [ ] `pnpm db:seed` runs (admin user + pilot workspace created; idempotent on re-run)
- [ ] Dashboard loads locally (`pnpm dev`, open `http://localhost:5173`) — login and
      register forms render and call the API
- [ ] API health passes:
  - `curl http://localhost:3000/health` → `{"ok":true,"service":"holonet"}`
  - `curl http://localhost:3000/api/health` → `{"ok":true,...}`
- [ ] `bash infra/scripts/deploy-check.sh` passes (tooling check)

## Production checks

### Identity, network, storage

- [ ] RAM user `holonet-deployer` created (programmatic access; AccessKey local only —
      never in Git) — see [docs/alibaba-cloud-setup.md](alibaba-cloud-setup.md)
- [ ] RAM role `holonet-fc-role` created with the Function Compute trust policy and the
      least-privilege OSS/SLS policy
- [ ] OSS buckets created: `holonet-section-zero-public` (public read policy applied) and
      `holonet-section-zero-private` (never public)
- [ ] VPC, vSwitch, and security group configured; identifiers in `infra/alibaba/.env.deploy`
- [ ] PostgreSQL Docker host reachable **privately** (TCP 5432 from the FC attachment only;
      no public exposure) — `pnpm db:migrate` succeeds against the production `DATABASE_URL`
- [ ] Function Compute functions deployed via Serverless Devs (`bash infra/scripts/deploy.sh`
      or `s deploy`): `holonet-app` and `holonet-builder`
- [ ] Function Compute environment variables configured (never committed):
      `DATABASE_URL`, `PUBLIC_BASE_URL`, `OSS_PUBLIC_BUCKET`, `OSS_PRIVATE_BUCKET`,
      `OSS_ENDPOINT`, `OSS_REGION`, `AUTH_SECRET`, `AI_PROVIDER` (+ `AI_ENDPOINT`/`AI_MODEL`)
- [ ] Dashboard assets uploaded to OSS (`pnpm dashboard:upload`) and the HTML shell at `/`
      references them
- [ ] Custom domain configured: DNS CNAME → FC endpoint, domain verified, HTTPS
      certificate bound, `/*` routed to `holonet-app`
- [ ] HTTPS certificate valid (browser padlock + `openssl s_client` expiry check)
- [ ] `https://holonet.section-zero.link/health` returns `{"ok":true,"service":"holonet"}`

### Runtime behavior

- [ ] Public form endpoint works: submit `POST /forms/<formId>` from a published form →
      `{"ok":true}` and the submission appears in the dashboard inbox (honeypot fill is
      silently discarded)
- [ ] Publish creates an OSS release: publish a site → deployment `live`,
      `sites/{siteId}/current.json` updated, release files exist under
      `sites/{siteId}/releases/{deploymentId}/…`
- [ ] Rollback works: `POST /api/sites/:siteId/rollback` repoints `current.json` at the
      previous release and the site serves it
- [ ] Backup script works: `infra/scripts/db-backup.sh` produces a dump; upload a copy to
      the **private** bucket
- [ ] Restore script works in staging: `infra/scripts/db-restore.sh <dump>` restores a
      working database (test on a staging environment, not production first)
- [ ] Security event logs visible: trigger a failed login → `login_failed` (and eventually
      `login_rate_limited`) rows in `security_events`; viewable in SLS/console
- [ ] Admin login works: the bootstrap admin signs in to the dashboard and can access
      `/api/admin/*` routes
- [ ] Normal user cannot access admin routes: a non-admin member gets `401/404/403` on
      `/api/admin/*` (never data)
- [ ] Cross-workspace access is blocked: user A cannot read/modify user B's workspaces,
      sites, pages, blocks, forms, or submissions (expect `404`, never data)

### Security acceptance

- [ ] `AUTH_SECRET` replaced with a strong production value (deploy-check enforces this)
- [ ] No real AccessKeys/secrets in Git (`git grep -E "AKIA|LTAI"` returns nothing)
- [ ] Admin MFA gap accepted **with mitigations** or TOTP flow implemented — see
      docs/security.md "MFA (data model prepared, not yet enforced)"
- [ ] Published site CSP meta + `headers.json` present in a released site (view-source)
- [ ] Imported website content never auto-publishes (draft pages only)

## Known gaps

- **Admin MFA** — TOTP enrollment/challenge not yet implemented (data model ready).
  Mitigations until implemented: dedicated admin account with a unique high-entropy
  password, security-event alerting on admin login failures, no shared admin logins.
- **FC builder invocation** — `BUILDER_INVOKER=fc` (FcBuilderInvoker) returns 501 until
  the FC invoker SDK is wired; use `BUILDER_INVOKER=local` in the meantime.
- **Multi-instance rate limiting** — in-memory limiters are per-instance; move to a shared
  store (Redis) before scaling past one instance.
- **FC HTTP trigger signature** — confirm the Web `Request`/`Response` signature against
  the deployed runtime before go-live.
