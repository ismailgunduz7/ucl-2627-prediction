import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { getEnv } from '../config/env.ts';

export const REFRESH_COOKIE = 'ucl_refresh';

export function setRefreshCookie(c: Context, raw: string): void {
  const { REFRESH_TOKEN_TTL_SECONDS, NODE_ENV } = getEnv();
  setCookie(c, REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearRefreshCookie(c: Context): void {
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth' });
}
