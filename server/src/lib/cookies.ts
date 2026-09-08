import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { getEnv } from '../config/env.ts';

/**
 * Refresh cookies, one per signed-in account.
 *
 * A browser can hold several accounts at once (§9.1), so the account id is part
 * of the cookie name: `ucl_refresh_<user id>`. Each account then rotates its own
 * token without touching anybody else's, and the set of cookies IS the list of
 * accounts signed in here, which is what the sessions endpoint reads back.
 *
 * The id in the name is not a secret. It is already in the access token this
 * browser carries, and the cookie itself stays httpOnly.
 */
const PREFIX = 'ucl_refresh_';

/**
 * The single-session cookie from before accounts could be stacked. It is read
 * on refresh so a browser signed in at deploy time keeps its session, and
 * cleared as soon as that session rotates into a named cookie. Nothing writes
 * it any more; drop this once no live browser can still be carrying one.
 */
const LEGACY_COOKIE = 'ucl_refresh';

const PATH = '/api/auth';

/**
 * How many accounts one browser may hold at once. Nobody in a friend league
 * plays from more than a couple, and a browser has a hard cookie budget per
 * domain that silently drops the overflow.
 */
export const MAX_BROWSER_ACCOUNTS = 5;

export function refreshCookieName(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function setRefreshCookie(c: Context, userId: string, raw: string): void {
  const { REFRESH_TOKEN_TTL_SECONDS, NODE_ENV } = getEnv();
  setCookie(c, refreshCookieName(userId), raw, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'Lax',
    path: PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearRefreshCookie(c: Context, userId: string): void {
  deleteCookie(c, refreshCookieName(userId), { path: PATH });
}

export function readLegacyRefreshCookie(c: Context): string | undefined {
  return getCookie(c, LEGACY_COOKIE);
}

export function clearLegacyRefreshCookie(c: Context): void {
  deleteCookie(c, LEGACY_COOKIE, { path: PATH });
}

export interface RefreshCookie {
  /** The account the cookie is named for; null for the legacy single-session one. */
  userId: string | null;
  raw: string;
}

/** Every refresh token this browser is carrying, in no particular order. */
export function readRefreshCookies(c: Context): RefreshCookie[] {
  const all = getCookie(c);
  const found: RefreshCookie[] = [];
  for (const [name, raw] of Object.entries(all)) {
    if (name.startsWith(PREFIX)) found.push({ userId: name.slice(PREFIX.length), raw });
    else if (name === LEGACY_COOKIE) found.push({ userId: null, raw });
  }
  return found;
}

/** Sign every account out of this browser (§9.1). */
export function clearAllRefreshCookies(c: Context): void {
  for (const cookie of readRefreshCookies(c)) {
    if (cookie.userId === null) clearLegacyRefreshCookie(c);
    else clearRefreshCookie(c, cookie.userId);
  }
}
