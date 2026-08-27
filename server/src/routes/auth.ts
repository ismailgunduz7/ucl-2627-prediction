import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
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
  if (!body.success) throw ApiError.badRequest('Kullanıcı adı ve şifre gerekli', 'invalid_body');

  const ip = clientIp(c);
  const { username, password } = body.data;

  const rate = checkLoginRate(ip, username);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds));
    throw ApiError.tooManyRequests(
      `Çok fazla deneme yaptın, ${Math.ceil(rate.retryAfterSeconds / 60)} dakika sonra tekrar dene`,
      rate.retryAfterSeconds,
    );
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
  if (!raw) throw ApiError.unauthorized('Oturum bulunamadı', 'no_refresh_cookie');
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
