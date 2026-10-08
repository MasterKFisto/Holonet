-- Holonet PostgreSQL initialization.
--
-- Executed once, on first container start (empty data directory), before
-- Drizzle migrations are applied. The role and database are created by the
-- postgres image from POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD;
-- application schema is managed exclusively by Drizzle (pnpm db:migrate).

-- Baseline extension: gen_random_uuid() and related crypto utilities for
-- workspace/site/tenant identifier generation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
