# Holonet — Assumptions

Assumptions about external systems that the code relies on, each with a
verification step. Resolved placeholders move here from the code (rule 16).

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
