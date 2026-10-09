import { z } from 'zod';

/**
 * Dashboard environment configuration (Vite). Only VITE_* variables are
 * exposed to the client. The API base URL defaults to http://localhost:3000
 * for local development (requirement 8).
 */
const envSchema = z.object({
  VITE_PUBLIC_API_BASE_URL: z.string().url().optional(),
});

export function apiBaseUrl(): string {
  const parsed = envSchema.safeParse(import.meta.env);
  const configured = parsed.success ? parsed.data.VITE_PUBLIC_API_BASE_URL : undefined;
  return (configured ?? 'http://localhost:3000').replace(/\/+$/, '');
}
