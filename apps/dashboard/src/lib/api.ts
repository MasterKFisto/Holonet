import { apiBaseUrl } from './env';

/**
 * Minimal fetch-based API client for the Holonet API.
 *
 * - Sends cookies (credentials: 'include') so the session cookie flows.
 * - Adds the double-submit CSRF token (X-CSRF-Token from the holonet_csrf
 *   cookie) to state-changing requests — see docs/security.md.
 * - Normalizes API errors into ApiError with the stable error code.
 */

const BASE_URL = apiBaseUrl();
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | undefined {
  const row = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return row ? row.slice(name.length + 1) : undefined;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };

  if (STATE_CHANGING.has(method)) {
    const token = readCookie('holonet_csrf');
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
  }
  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  if (response.ok) {
    return (await response.json()) as T;
  }

  let code = 'INTERNAL_ERROR';
  let message = `request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    // Non-JSON error body — keep the generic message.
  }
  throw new ApiError(response.status, code, message);
}
