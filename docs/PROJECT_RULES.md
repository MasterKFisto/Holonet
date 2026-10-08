# Holonet — Project Rules

## Project identity

- **Project name:** Holonet
- **Primary public hostname:** `https://holonet.section-zero.link`
- **Description:** Holonet is a security-first static website platform with AI-assisted website import, template-based publishing, form handling, backups, and managed static hosting.

## Rules

1. **Project name:** Holonet.
2. **Primary public hostname:** `https://holonet.section-zero.link`.
3. **Language:** TypeScript with strict mode enabled.
4. **Runtime:** Node.js 20.
5. **Package manager:** pnpm.
6. **Repository layout:** pnpm monorepo.
7. **Database:** PostgreSQL deployed using Docker.
8. **Production compute:** Alibaba Cloud Function Compute.
9. **Production object storage:** Alibaba Cloud OSS.
10. **Secrets:** Do not store real secrets, AccessKeys, passwords, database credentials, or private keys in code or documentation.
11. **Configuration:** Use environment variables and `.env.example` files for configuration.
12. **Code style:** Prefer simple, auditable, maintainable code over clever abstractions.
13. **Documentation:** Every phase must include documentation updates.
14. **Quality gates:** Every phase must include type checking and test commands.
15. **Phase gate:** Do not move to the next phase unless the current phase passes type checking and tests.
16. **External services:** If an external service detail is uncertain, create a clearly marked placeholder and document the assumption.
17. **Untrusted data:** Treat imported website content and AI-generated output as untrusted data.
18. **Tenant isolation:** All tenant data must be isolated by workspace.
19. **Static assets:** Public static assets such as JPG, CSS, JS, fonts, and published site files must be stored in OSS in production.
20. **Deployment target:** The dashboard, API, builder, and background jobs must be designed for eventual deployment to Alibaba Cloud Function Compute.

## Intended architecture (summary)

- **Monorepo:** A single pnpm monorepo holds all Holonet packages (e.g. dashboard, API, builder, background jobs, shared libraries).
- **Dashboard & API:** The dashboard is the operator/tenant-facing web UI. The API is a stateless HTTP service that mediates all writes. Both are built as function-oriented entry points so they can be deployed to Alibaba Cloud Function Compute.
- **Builder:** A background pipeline that composes static sites from imported content and templates, treats all imported/AI-generated input as untrusted, and publishes the resulting static files (HTML, CSS, JS, fonts, images) to Alibaba Cloud OSS.
- **Background jobs:** Small, invocable functions for form handling, backups, and builder work — also designed to run on Function Compute.
- **Data:** PostgreSQL (run via Docker locally and in development) stores metadata: workspaces, sites, templates, forms, backups, and job state. All tenant data is isolated by workspace.
- **Object storage:** Alibaba Cloud OSS is the only home for public static assets and published site files in production.
- **Security:** No real secrets in code or docs; configuration comes from environment variables with `.env.example` templates. Imported content and AI output are treated as untrusted.
