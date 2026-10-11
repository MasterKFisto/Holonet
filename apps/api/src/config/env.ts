import { z } from '@holonet/security';
import { AppError } from '../lib/errors.js';

/**
 * Environment configuration, validated with Zod (rule 11).
 * Invalid configuration fails loudly with INVALID_CONFIG.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('https://holonet.section-zero.link'),
  /** Required once the database is wired into the API (db phase). */
  DATABASE_URL: z.string().min(1).optional(),
  /**
   * Session signing secret — must be at least 32 characters (HS256 key
   * size). The default is a DEVELOPMENT placeholder; replace in production.
   */
  AUTH_SECRET: z.string().min(32).default('holonet-dev-secret-change-me-0000000000'),
  /** Session cookie name (rule: HTTP-only cookie). */
  SESSION_COOKIE_NAME: z.string().min(1).default('holonet_session'),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(604800),
  /** Comma-separated origins allowed by CORS (local Vite dashboard by default). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),
  /** Public base URL of the OSS public bucket (dashboard asset origin). */
  OSS_PUBLIC_BASE_URL: z.string().url().optional(),
  /** Path to the uploaded dashboard asset manifest (GET / shell). */
  DASHBOARD_ASSET_MANIFEST_PATH: z.string().min(1).optional(),
  /** Builder invocation mode: 'local' (in-process) or 'fc' (Function Compute). */
  BUILDER_INVOKER: z.enum(['local', 'fc']).default('local'),
  /**
   * AI model label recorded on ai_analyses rows (foundation uses the
   * built-in heuristics model; external AI providers arrive later).
   */
  AI_MODEL: z.string().min(1).default('holonet-heuristics'),
  /**
   * AI analysis provider: 'manual' (offline heuristics, default), 'http'
   * (OpenAI/Qwen-compatible endpoint), or 'ollama' (placeholder).
   */
  AI_PROVIDER: z.enum(['manual', 'http', 'ollama']).default('manual'),
  /** OpenAI- or Qwen-compatible chat completions endpoint (AI_PROVIDER=http). */
  AI_ENDPOINT: z.string().url().optional(),
  /** Bearer token for the AI endpoint (AI_PROVIDER=http). */
  AI_API_KEY: z.string().min(1).optional(),
  /** Future local Ollama endpoint (AI_PROVIDER=ollama placeholder). */
  OLLAMA_ENDPOINT: z.string().url().optional(),
  /**
   * Website importer limits (pages, bytes, timeout). Kept conservative:
   * the importer fetches at most 3 pages of at most 5 MiB each, 20 s each.
   */
  IMPORT_MAX_PAGES: z.coerce.number().int().min(1).max(10).default(3),
  IMPORT_MAX_PAGE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
  IMPORT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(20_000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(processEnv);
  if (!result.success) {
    throw new AppError(
      'INVALID_CONFIG',
      'environment configuration is invalid',
      500,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Parses CORS_ORIGINS into a list of allowed origins. */
export function corsOriginList(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
