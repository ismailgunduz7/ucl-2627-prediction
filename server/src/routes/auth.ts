import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { LOCALES } from '../lib/i18n.ts';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '../lib/cookies.ts';
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

  resetLoginRate(ip, username);
  setRefreshCookie(c, session.refreshToken);
  return c.json({ user: session.user, accessToken: session.accessToken });
});

authRoutes.post('/refresh', async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  if (!raw) throw ApiError.unauthorized('no_refresh_cookie');
  const session = await authService.refresh(raw, {
    ip: clientIp(c),
    userAgent: c.req.header('user-agent'),
  });
  setRefreshCookie(c, session.refreshToken);
  return c.json({ user: session.user, accessToken: session.accessToken });
});

authRoutes.post('/logout', async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  await authService.logout(raw);
  clearRefreshCookie(c);
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
  setRefreshCookie(c, session.refreshToken);
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
