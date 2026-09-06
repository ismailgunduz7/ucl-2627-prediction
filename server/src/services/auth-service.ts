import { getEnv } from '../config/env.ts';
import { query, withTransaction } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  type AccessTokenClaims,
} from '../lib/tokens.ts';
import { grantInitialInventory } from './joker-service.ts';
import type { Locale } from '../lib/i18n.ts';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  is_admin: boolean;
  competition_id: string | null;
  language: Locale;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  competitionId: string | null;
  /** The language this account reads the game in, on any device (§3.1). */
  language: Locale;
}

export interface SessionResult {
  user: PublicUser;
  accessToken: string;
  /** Raw refresh token to set in an httpOnly cookie. Never returned in JSON. */
  refreshToken: string;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    competitionId: row.competition_id,
    language: row.language,
  };
}

function claimsFor(row: UserRow): AccessTokenClaims {
  return { sub: row.id, isAdmin: row.is_admin, competitionId: row.competition_id };
}

async function issueRefreshToken(
  userId: string,
  meta: RequestMeta,
  replacesId?: string,
): Promise<string> {
  const { REFRESH_TOKEN_TTL_SECONDS } = getEnv();
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, hash, expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  if (replacesId) {
    await query(`UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2`, [
      rows[0]!.id,
      replacesId,
    ]);
  }
  return raw;
}

/** Authenticate by username + password. Throws ApiError(401) on any mismatch. */
export async function login(
  username: string,
  password: string,
  meta: RequestMeta = {},
): Promise<SessionResult> {
  const { rows } = await query<UserRow>(
    `SELECT id, username, password_hash, display_name, is_admin, competition_id, language
     FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  const user = rows[0];
  // Always run a hash comparison to blunt username-enumeration timing.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
  if (!user || !ok) {
    throw ApiError.unauthorized('invalid_credentials');
  }

  const accessToken = signAccessToken(claimsFor(user));
  const refreshToken = await issueRefreshToken(user.id, meta);
  return { user: toPublicUser(user), accessToken, refreshToken };
}

/**
 * Rotate a refresh token: validate the presented raw token, revoke it, and issue
 * a new access + refresh pair. Reuse of an already-rotated/revoked token throws.
 */
export async function refresh(rawToken: string, meta: RequestMeta = {}): Promise<SessionResult> {
  const tokenHash = hashRefreshToken(rawToken);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.rotated_at, rt.revoked_at,
              u.id AS u_id, u.username, u.password_hash, u.display_name,
              u.is_admin, u.competition_id, u.language
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) throw ApiError.unauthorized('invalid_refresh_token');
    if (row.revoked_at || row.rotated_at) {
      throw ApiError.unauthorized('refresh_token_reused');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw ApiError.unauthorized('refresh_token_expired');
    }

    await client.query(`UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1`, [row.id]);

    const userRow: UserRow = {
      id: row.u_id,
      username: row.username,
      password_hash: row.password_hash,
      display_name: row.display_name,
      is_admin: row.is_admin,
      competition_id: row.competition_id,
      language: row.language,
    };
    // Issue the replacement refresh token within the same transaction.
    const { REFRESH_TOKEN_TTL_SECONDS } = getEnv();
    const { raw, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userRow.id, hash, expiresAt, meta.userAgent ?? null, meta.ip ?? null],
    );
    await client.query(`UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2`, [
      inserted.rows[0]!.id,
      row.id,
    ]);

    return {
      user: toPublicUser(userRow),
      accessToken: signAccessToken(claimsFor(userRow)),
      refreshToken: raw,
    };
  });
}

/** Revoke the presented refresh token (logout). Idempotent. */
export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashRefreshToken(rawToken)],
  );
}

/** Fetch a user by id for the /me endpoint. */
export async function getUserById(id: string): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>(
    `SELECT id, username, password_hash, display_name, is_admin, competition_id, language
     FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName: string;
  isAdmin?: boolean;
  competitionId?: string | null;
}

/** Admin-only account creation (no public self-registration, §3.1/§9.1). */
export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const isAdmin = input.isAdmin ?? false;
  if (!isAdmin && !input.competitionId) {
    throw ApiError.badRequest('competition_required');
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (username, password_hash, display_name, is_admin, competition_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, password_hash, display_name, is_admin, competition_id, language`,
      [input.username, passwordHash, input.displayName, isAdmin, input.competitionId ?? null],
    );
    // Participants get their Act I joker inventory before the MW1 lock (§3.6).
    if (!isAdmin) await grantInitialInventory(rows[0]!.id);
    return toPublicUser(rows[0]!);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw ApiError.badRequest('username_taken');
    }
    throw err;
  }
}

/**
 * Admin resets a user's password. Also revokes all of that user's refresh
 * tokens so existing sessions can no longer silently refresh (forces re-login).
 */
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    const res = await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      userId,
    ]);
    if (res.rowCount === 0) {
      throw ApiError.badRequest('user_not_found');
    }
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  });
}

/**
 * Admin deletes a user. Guards against removing yourself (avoids mid-session
 * lockout) and against deleting the last remaining admin. team_selections and
 * refresh_tokens cascade via FK ON DELETE CASCADE.
 */
export async function deleteUser(userId: string, actingAdminId: string): Promise<void> {
  if (userId === actingAdminId) {
    throw ApiError.badRequest('cannot_delete_self');
  }
  await withTransaction(async (client) => {
    const target = await client.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId],
    );
    if (target.rowCount === 0) {
      throw ApiError.badRequest('user_not_found');
    }
    if (target.rows[0]!.is_admin) {
      const admins = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM users WHERE is_admin',
      );
      if (Number(admins.rows[0]!.count) <= 1) {
        throw ApiError.badRequest('cannot_delete_last_admin');
      }
    }
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  });
}

/** Remembers the language this account reads the game in, on every device. */
export async function setLanguage(userId: string, language: Locale): Promise<PublicUser> {
  const { rows } = await query<UserRow>(
    `UPDATE users SET language = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, username, password_hash, display_name, is_admin, competition_id, language`,
    [userId, language],
  );
  const row = rows[0];
  if (!row) throw ApiError.badRequest('user_not_found');
  return toPublicUser(row);
}
