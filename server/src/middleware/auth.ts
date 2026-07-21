import type { Context, Next } from 'hono';
import { ApiError } from '../lib/errors.ts';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/tokens.ts';

// Typed variables stored on the Hono context for downstream handlers.
export interface AuthVariables {
  auth: AccessTokenClaims;
}

function extractBearer(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

/** Requires a valid access token; attaches claims as `c.get('auth')`. */
export async function requireAuth(c: Context, next: Next): Promise<void | Response> {
  const token = extractBearer(c);
  if (!token) throw ApiError.unauthorized();
  try {
    c.set('auth', verifyAccessToken(token));
  } catch {
    throw ApiError.unauthorized('Erişim anahtarı geçersiz veya süresi dolmuş', 'invalid_access_token');
  }
  await next();
}

/** Requires an authenticated admin. Must run after requireAuth. */
export async function requireAdmin(c: Context, next: Next): Promise<void | Response> {
  const auth = c.get('auth') as AccessTokenClaims | undefined;
  if (!auth) throw ApiError.unauthorized();
  if (!auth.isAdmin) throw ApiError.forbidden();
  await next();
}
