# Holonet — Assumptions

Assumptions about external systems that the code relies on, each with a
verification step. Resolved placeholders move here from the code (rule 16).
The canonical inventory of remaining intentional placeholders is at the bottom.

## Function Compute 3.0 HTTP trigger event shape

**Assumption:** `apps/api/src/function.ts` parses the fc3 (component `fc3`)
HTTP trigger event as an API-Gateway-style JSON object:

```json
{
  "version": "v1",
  "rawPath": "/api/health",
  "body": "<string or null>",
  "isBase64Encoded": true,
  "queryParameters": { "key": "value" },
  "headers": { "host": "holonet.section-zero.link" },
  "requestContext": {
    "http": { "method": "GET", "path": "/api/health" },
    "requestId": "…"
  }
}
```

- The event arrives as a **JSON string or Buffer** (plain objects are also
  tolerated for console testing).
- The response contract is
  `{ "statusCode": number, "headers": { … }, "isBase64Encoded": boolean, "body": string }`
  with binary bodies base64-encoded. Repeated header values (e.g. multiple
  `Set-Cookie`) are emitted as arrays.
- The handler is `index.handler`, exported as CommonJS by the packaging step
  (`infra/scripts/package-api.sh` bundles `function.ts` to CJS).
- The FC `context` argument (credentials, region, accountId, requestId) is
  captured into a module-scoped holder (`getFcContext()`) for request-time STS
  access. Caveat: module scope is shared per warm instance — treat the holder
  as best-effort for concurrent requests.

**Verification step:** after the first deploy, send a test event from the
Function Compute console **Test Function** page (or
`s holonet-app invoke`) and compare the received event JSON against the
`parseFcEvent` parser in `apps/api/src/function.ts`:

1. Invoke with `{}` (or an empty event) — the function must return
   `statusCode 400` with the structured JSON error body (no crash).
2. Invoke with a full mock event for `GET /api/health` — the function must
   return `statusCode 200` with `{"ok":true,"service":"holonet"}`.
3. Compare the console's actual event shape (field names, casing, base64
   flags) with the fields consumed above; adjust `parseFcEvent` if FC3 ships
   a different envelope.

## FC3 built-in runtime (Node.js 20)

**Assumption:** the fc3 Node.js 20 built-in runtime loads CommonJS
`index.js` and invokes `exports.handler(event, context)`. The packaging step
writes a CommonJS bundle, so ESM-only syntax must never reach the bundle
(`import.meta.url` guards exist in the app and builder sources).

**Verification step:** covered by the Test Function step above; additionally
`node -e "require('./infra/alibaba/dist/holonet-app/index.js')"` must load
without error after packaging.

## FC3 event-function payload (holonet-builder)

**Assumption:** when the API's `FcBuilderInvoker` invokes `holonet-builder`
asynchronously via the fc3 SDK (`invokeFunction`, `x-fc-invocation-type: Async`),
the Node.js 20 runtime delivers the invoke body to `handler(event, context)`
in `apps/builder/src/handler.ts` as a **Buffer** whose UTF-8 content is the
JSON payload `{ "siteId": "...", "deploymentId": "..." }` (a JSON string is
also tolerated; plain objects work for console testing).

**Verification step:** after the first deploy, invoke `holonet-builder` from
the Function Compute console **Test Function** page with a test event
`{ "siteId": "<uuid>", "deploymentId": "<uuid>" }`:

1. The function must reach `buildSite` (a "deployment not found" or build
   error proves parsing succeeded); an `invalid build event` error means FC3
   delivered a different envelope — adjust `parseBuildEvent`.
2. Then publish a test site with `BUILDER_INVOKER=fc` and confirm the
   deployment/job transition out of `queued` (the builder ran).

## OSS credentials via the FC execution role (STS)

**Assumption:** on Function Compute, `context.credentials`
(`accessKeyId` / `accessKeySecret` / `securityToken`) are present on every
invocation of both functions and carry the OSS permissions granted to
`holonet-fc-role`. `packages/storage` resolves them per operation via the
registered credentials provider (`setOssCredentialsProvider`) and rebuilds the
ali-oss client on a 4-minute TTL so rotated credentials are picked up.

**Verification step:** publish a test site in production and confirm release
files appear under `sites/{siteId}/releases/{deploymentId}/` in the OSS
public bucket (and `current.json` updates). An `InvalidAccessKeyId` /
`AccessDenied` OSS error means the credentials flow or the role policy needs
adjustment.

## Remaining intentional placeholders

These `PLACEHOLDER` markers are deliberate future-phase items, kept by design:

| Placeholder                            | Location                                                       | Reason                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MinIO Compose add-on                   | docs/infrastructure.md                                         | Optional local OSS simulation; the `fs` storage provider is the default dev backend, so nothing is blocked.                                                                          |
| Docker host specifics (ECS size/image) | docs/infrastructure.md                                         | Chosen at deploy time per budget/region; the compose files are host-agnostic.                                                                                                        |
| `OllamaProvider`                       | packages/ai/src/provider.ts, docs/architecture.md              | Future self-hosted AI model; the import pipeline falls back to `ManualProvider`, so Ollama is never required.                                                                        |
| Redis-backed rate limiting             | apps/api/src/middleware/rate-limit.ts, infra/alibaba/README.md | In-memory limiters are correct for a single instance; a shared store is only needed at multi-instance scale (documented upgrade path).                                               |
| Password reset email transport         | apps/api/src/routes/auth.ts, docs/security.md                  | Notification provider choice pending; the reset flow is fully implemented (hashed single-use tokens, audit + security events) with a dev-only debug token until transport is chosen. |
