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
  competition_name: string | null;
  language: Locale;
}

/**
 * Every read of an account carries the competition's name beside its id: the
 * account switcher names the competition under each account (§9.1), and an id
 * would mean the client fetching a list it has no business reading.
 */
const USER_SELECT = `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_admin,
          u.competition_id, u.language, c.name AS competition_name
     FROM users u LEFT JOIN competitions c ON c.id = u.competition_id`;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  competitionId: string | null;
  /** Named, not just referenced, so the account switcher can label a row. */
  competitionName: string | null;
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
    competitionName: row.competition_name ?? null,
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
  const { rows } = await query<UserRow>(`${USER_SELECT} WHERE lower(u.username) = lower($1)`, [
    username,
  ]);
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
              u.is_admin, u.competition_id, u.language, c.name AS competition_name
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       LEFT JOIN competitions c ON c.id = u.competition_id
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
      competition_name: row.competition_name,
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

/**
 * Who a refresh token belongs to, without spending it.
 *
 * The sessions endpoint (§9.1) reads the accounts a browser is carrying, and
 * reading that list must not rotate anything: a browser holding four accounts
 * would otherwise burn four tokens on every page load. Returns null for a token
 * that is revoked, already rotated, expired or simply unknown.
 */
export async function sessionOwner(rawToken: string): Promise<PublicUser | null> {
  const { rows } = await query<UserRow & { expires_at: Date }>(
    `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_admin,
            u.competition_id, u.language, c.name AS competition_name, rt.expires_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       LEFT JOIN competitions c ON c.id = u.competition_id
      WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.rotated_at IS NULL`,
    [hashRefreshToken(rawToken)],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return toPublicUser(row);
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
  const { rows } = await query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
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
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, password_hash, display_name, is_admin, competition_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.username, passwordHash, input.displayName, isAdmin, input.competitionId ?? null],
    );
    // Participants get their Act I joker inventory before the MW1 lock (§3.6).
    if (!isAdmin) await grantInitialInventory(rows[0]!.id);
    return (await getUserById(rows[0]!.id))!;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw ApiError.badRequest('username_taken');
    }
    throw err;
  }
}

export interface UpdateUserInput {
  displayName?: string;
  competitionId?: string | null;
}

/**
 * Admin edits the parts of an account that are not credentials: the name
 * everyone sees and the competition the player is grouped into.
 *
 * A competition only decides who is listed beside whom, so moving somebody is
 * a grouping change and nothing more; the rules, scoring and jokers are global
 * (§3.1). A participant always belongs to one, an admin never does.
 */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<PublicUser> {
  const { rows } = await query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [
    userId,
  ]);
  const target = rows[0];
  if (!target) throw ApiError.badRequest('user_not_found');

  const competitionId = target.is_admin ? null : input.competitionId;
  if (!target.is_admin && competitionId === null) {
    throw ApiError.badRequest('competition_required');
  }

  await query(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            competition_id = COALESCE($3, competition_id),
            updated_at = now()
      WHERE id = $1`,
    [userId, input.displayName ?? null, competitionId ?? null],
  );
  return (await getUserById(userId))!;
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

/**
 * A player changes their own password.
 *
 * The current one has to be right, so a walked-away session cannot take the
 * account over. Every refresh token is revoked, this device included, and the
 * caller is handed a fresh pair: the browser doing the change stays signed in,
 * anything else signed in as that account does not.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta = {},
): Promise<SessionResult> {
  const { rows } = await query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
  const user = rows[0];
  if (!user) throw ApiError.unauthorized();
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw ApiError.badRequest('current_password_wrong');
  }

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      userId,
    ]);
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  });

  const refreshToken = await issueRefreshToken(userId, meta);
  return { user: toPublicUser(user), accessToken: signAccessToken(claimsFor(user)), refreshToken };
}

/** Remembers the language this account reads the game in, on every device. */
export async function setLanguage(userId: string, language: Locale): Promise<PublicUser> {
  const { rows } = await query<{ id: string }>(
    `UPDATE users SET language = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [userId, language],
  );
  if (!rows[0]) throw ApiError.badRequest('user_not_found');
  return (await getUserById(userId))!;
}
