/**
 * Thin fetch wrapper.
 *
 * - Access token lives in memory only (not localStorage) → not readable by XSS.
 * - The refresh token is an httpOnly cookie the browser sends automatically to
 *   /api/auth/refresh (credentials: 'include').
 * - On a 401 for a normal call, we transparently try one refresh + retry.
 */
/**
 * Where the API lives. Empty means same origin, which is what a deploy that
 * proxies `/api/*` through the static host wants: the refresh cookie stays
 * first-party and CORS never comes into it.
 *
 * A production build with nothing configured therefore talks to its own origin
 * rather than falling back to a localhost that cannot exist there.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set false to skip the automatic refresh-and-retry (used by refresh itself). */
  retryOnUnauthorized?: boolean;
}

async function rawRequest<T>(path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data?.error ?? {}) as ApiErrorShape;
    throw new ApiRequestError(
      res.status,
      err.code ?? 'error',
      err.message ?? `İstek başarısız (${res.status})`,
      err.details,
    );
  }
  return data as T;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const data = await rawRequest<{ accessToken: string }>('/api/auth/refresh', {
          method: 'POST',
          retryOnUnauthorized: false,
        });
        setAccessToken(data.accessToken);
        return true;
      } catch {
        setAccessToken(null);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, opts);
  } catch (err) {
    const retry = opts.retryOnUnauthorized !== false;
    if (retry && err instanceof ApiRequestError && err.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) return rawRequest<T>(path, opts);
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
