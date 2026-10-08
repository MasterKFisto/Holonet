# Alibaba Cloud infrastructure

Configuration and policy templates for production on Alibaba Cloud.
Every value is a placeholder — real values come from environment variables
(`.env.example`), never from committed files (docs/PROJECT_RULES.md rules 10/11).

| Directory | Contents                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `fc/`     | Function Compute service and function configuration (app + builder).                                                 |
| `oss/`    | OSS bucket policies (public bucket: static assets and published sites; private bucket: imports, form data, backups). |
| `ram/`    | RAM role policies for the Function Compute execution role.                                                           |

Deployment procedure: [docs/deployment.md](../../docs/deployment.md).
Assumptions and placeholders: [docs/infrastructure.md](../../docs/infrastructure.md).

## Placeholder notes

- **PLACEHOLDER — FC trigger signature.** The `holonet-app` function's HTTP
  trigger is assumed to pass a Web `Request` and expect a Web `Response`
  (`apps/api/src/function.ts`). Confirm before deployment.
- **PLACEHOLDER — deployment tooling.** Serverless Devs (`s` CLI), Alibaba
  Cloud CLI, or the console; to be finalized in the deployment phase.
