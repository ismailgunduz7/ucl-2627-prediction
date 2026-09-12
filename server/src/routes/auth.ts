import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { LOCALES } from '../lib/i18n.ts';
import { isVersion } from '../domain/releases.ts';
import {
  MAX_BROWSER_ACCOUNTS,
  clearAllRefreshCookies,
  clearLegacyRefreshCookie,
  clearRefreshCookie,
  readRefreshCookies,
  setRefreshCookie,
} from '../lib/cookies.ts';
import { checkLoginRate, resetLoginRate } from '../lib/rate-limit.ts';
import * as authService from '../services/auth-service.ts';
import { requireAuth, type AuthVariables } from '../middleware/auth.ts';

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

function clientIp(c: Parameters<typeof requireAuth>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

authRoutes.post('/login', async (c) => {
  const body = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('credentials_required');

  const ip = clientIp(c);
  const { username, password } = body.data;

  const rate = checkLoginRate(ip, username);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds));
    throw ApiError.tooManyRequests(rate.retryAfterSeconds);
  }

  const session = await authService.login(username, password, {
    ip,
    userAgent: c.req.header('user-agent'),
  });

  // Signing in does not sign the other accounts out (§9.1), so the browser
  // accumulates cookies. Cap it: a browser with dozens of them would start
  // losing them silently, and nobody plays this league from ten accounts.
  const others = readRefreshCookies(c).filter((cookie) => cookie.userId !== session.user.id);
  if (others.length >= MAX_BROWSER_ACCOUNTS) {
    throw ApiError.badRequest('too_many_accounts', { max: MAX_BROWSER_ACCOUNTS });
  }

  resetLoginRate(ip, username);
  setRefreshCookie(c, session.user.id, session.refreshToken);
  return c.json({ user: session.user, accessToken: session.accessToken });
});

const SessionsSchema = z.object({ activeUserId: z.string().uuid().optional() });

/**
 * The accounts this browser is signed into, plus a live session for one of them.
 *
 * A page load needs both, and asking for them separately would mean two round
 * trips before anything renders. Only the account being made active rotates its
 * token; the rest are merely identified (§9.1).
 */
authRoutes.post('/sessions', async (c) => {
  const body = SessionsSchema.safeParse(await c.req.json().catch(() => ({})));
  const meta = { ip: clientIp(c), userAgent: c.req.header('user-agent') };

  const accounts: authService.PublicUser[] = [];
  // Tokens are read off the request; a cookie written during this response is
  // not readable back from it, so the raw token travels in this map instead.
  const tokens = new Map<string, string>();
  for (const cookie of readRefreshCookies(c)) {
    const owner = await authService.sessionOwner(cookie.raw);
    if (!owner) {
      if (cookie.userId === null) clearLegacyRefreshCookie(c);
      else clearRefreshCookie(c, cookie.userId);
      continue;
    }
    // A session opened before accounts could be stacked carries an unnamed
    // cookie. Move the same token under the account's name and drop the old
    // one, so nobody is signed out by the upgrade.
    if (cookie.userId === null) {
      setRefreshCookie(c, owner.id, cookie.raw);
      clearLegacyRefreshCookie(c);
    }
    if (!accounts.some((a) => a.id === owner.id)) accounts.push(owner);
    tokens.set(owner.id, cookie.raw);
  }

  const wanted = body.success ? body.data.activeUserId : undefined;
  const activeId = accounts.some((a) => a.id === wanted) ? wanted : accounts[0]?.id;
  const raw = activeId ? tokens.get(activeId) : undefined;

  let active: { user: authService.PublicUser; accessToken: string } | null = null;
  if (activeId && raw) {
    try {
      const session = await authService.refresh(raw, meta);
      setRefreshCookie(c, session.user.id, session.refreshToken);
      active = { user: session.user, accessToken: session.accessToken };
    } catch {
      // Another tab got there first and spent this token. The cookie it wrote
      // in its own answer is the good one, so leave the cookie alone and say
      // there is no live session: a reload picks the new token up. Clearing it
      // here would sign the account out of both tabs over a race.
      active = null;
    }
  }

  return c.json({ accounts, active });
});

const RefreshSchema = z.object({ userId: z.string().uuid().optional() });

/**
 * Rotate one account's session. Which one is named in the body; with several
 * accounts signed in here, the cookie alone no longer says.
 */
authRoutes.post('/refresh', async (c) => {
  const body = RefreshSchema.safeParse(await c.req.json().catch(() => ({})));
  const wanted = body.success ? body.data.userId : undefined;

  const cookies = readRefreshCookies(c);
  // A browser holding one session does not have to name it, and a session from
  // before the cookie carried a name cannot name itself either.
  const cookie =
    (wanted ? cookies.find((entry) => entry.userId === wanted) : undefined) ??
    (cookies.length === 1 ? cookies[0] : undefined);
  if (!cookie) throw ApiError.unauthorized('no_refresh_cookie');

  const session = await authService.refresh(cookie.raw, {
    ip: clientIp(c),
    userAgent: c.req.header('user-agent'),
  });
  setRefreshCookie(c, session.user.id, session.refreshToken);
  if (cookie.userId === null) clearLegacyRefreshCookie(c);
  return c.json({ user: session.user, accessToken: session.accessToken });
});

/** Signs out every account in this browser at once (§9.1). */
authRoutes.post('/logout', async (c) => {
  for (const cookie of readRefreshCookies(c)) await authService.logout(cookie.raw);
  clearAllRefreshCookies(c);
  return c.json({ ok: true });
});

// Current user from a valid access token.
authRoutes.get('/me', requireAuth, async (c) => {
  const auth = c.get('auth');
  const user = await authService.getUserById(auth.sub);
  if (!user) throw ApiError.unauthorized();
  return c.json({ user });
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

/**
 * A player changes their own password. Nobody needs an admin for this.
 *
 * Every session of that account is revoked, so the reply carries a fresh pair
 * and this browser stays signed in while any other is turned out.
 */
authRoutes.put('/me/password', requireAuth, async (c) => {
  const body = ChangePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('password_required');
  const auth = c.get('auth');
  const session = await authService.changeOwnPassword(
    auth.sub,
    body.data.currentPassword,
    body.data.newPassword,
    { ip: clientIp(c), userAgent: c.req.header('user-agent') },
  );
  setRefreshCookie(c, session.user.id, session.refreshToken);
  return c.json({ user: session.user, accessToken: session.accessToken });
});

const LanguageSchema = z.object({ language: z.enum(LOCALES) });

/**
 * The language this account reads the game in.
 *
 * It is stored on the account rather than in the browser, so switching on a
 * phone switches the desktop session too the next time it loads.
 */
authRoutes.put('/me/language', requireAuth, async (c) => {
  const body = LanguageSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_language');
  const auth = c.get('auth');
  const user = await authService.setLanguage(auth.sub, body.data.language);
  return c.json({ user });
});

const ReleaseSchema = z.object({ version: z.string().refine(isVersion) });

/**
 * The newest release notes this account has read (§18.12).
 *
 * Closing the Yenilikler dialog on one device is meant to close it everywhere,
 * so the mark is on the account. It never moves backwards.
 */
authRoutes.put('/me/release', requireAuth, async (c) => {
  const body = ReleaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_release');
  const auth = c.get('auth');
  const user = await authService.setLastSeenRelease(auth.sub, body.data.version);
  return c.json({ user });
});
