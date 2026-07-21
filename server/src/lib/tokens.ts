import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env.ts';

export interface AccessTokenClaims {
  sub: string; // user id
  isAdmin: boolean;
  competitionId: string | null;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const { JWT_SECRET, ACCESS_TOKEN_TTL_SECONDS } = getEnv();
  return jwt.sign(claims, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const { JWT_SECRET } = getEnv();
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('Malformed access token');
  return {
    sub: String(decoded.sub),
    isAdmin: Boolean((decoded as jwt.JwtPayload).isAdmin),
    competitionId: ((decoded as jwt.JwtPayload).competitionId as string | null) ?? null,
  };
}

/**
 * A refresh token is a high-entropy opaque string handed to the client (in an
 * httpOnly cookie). We persist only its SHA-256 hash, so a DB leak cannot be
 * replayed. Returns both the raw value (for the cookie) and its hash (for the row).
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
