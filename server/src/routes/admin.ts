import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { requireAdmin, requireAuth, type AuthVariables } from '../middleware/auth.ts';
import * as authService from '../services/auth-service.ts';
import { listTeams } from '../services/team-service.ts';
import {
  DEFAULT_CONFIG,
  getAllConfig,
  setConfigValue,
  type ConfigKey,
} from '../services/tournament-config-service.ts';

// All admin routes require a valid access token AND the admin role.
export const adminRoutes = new Hono<{ Variables: AuthVariables }>();
adminRoutes.use('*', requireAuth, requireAdmin);

// --- Competitions ---------------------------------------------------------
adminRoutes.get('/competitions', async (c) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.created_at,
            (SELECT count(*) FROM users u WHERE u.competition_id = c.id AND NOT u.is_admin) AS participant_count
     FROM competitions c ORDER BY c.created_at`,
  );
  return c.json({ competitions: rows });
});

const CompetitionSchema = z.object({ name: z.string().min(1).max(120) });

adminRoutes.post('/competitions', async (c) => {
  const body = CompetitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('Yarışma adı gerekli', 'invalid_body');
  const { rows } = await query(
    `INSERT INTO competitions (name) VALUES ($1) RETURNING id, name, created_at`,
    [body.data.name],
  );
  return c.json({ competition: rows[0] }, 201);
});

// --- Users ----------------------------------------------------------------
adminRoutes.get('/users', async (c) => {
  const { rows } = await query(
    `SELECT id, username, display_name, is_admin, competition_id, created_at
     FROM users ORDER BY created_at`,
  );
  return c.json({ users: rows });
});

const CreateUserSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(120),
  isAdmin: z.boolean().optional(),
  competitionId: z.string().uuid().nullable().optional(),
});

adminRoutes.post('/users', async (c) => {
  const body = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    throw ApiError.badRequest('Geçersiz kullanıcı bilgisi', 'invalid_body', body.error.flatten());
  }
  const user = await authService.createUser(body.data);
  return c.json({ user }, 201);
});

const SetPasswordSchema = z.object({ password: z.string().min(8).max(256) });

adminRoutes.put('/users/:id/password', async (c) => {
  const body = SetPasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('Şifre en az 8 karakter olmalı', 'invalid_body');
  await authService.setUserPassword(c.req.param('id'), body.data.password);
  return c.json({ ok: true });
});

adminRoutes.delete('/users/:id', async (c) => {
  const auth = c.get('auth');
  await authService.deleteUser(c.req.param('id'), auth.sub);
  return c.json({ ok: true });
});

// --- Teams ----------------------------------------------------------------
adminRoutes.get('/teams', async (c) => {
  const teams = await listTeams();
  return c.json({ teams });
});

// --- Tournament config (admin-editable knobs, §8.1) -----------------------
adminRoutes.get('/config', async (c) => {
  const config = await getAllConfig();
  return c.json({ config });
});

const ConfigSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

adminRoutes.put('/config', async (c) => {
  const body = ConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('Geçersiz config gövdesi', 'invalid_body');
  if (!(body.data.key in DEFAULT_CONFIG)) {
    throw ApiError.badRequest('Bilinmeyen config anahtarı', 'unknown_config_key');
  }
  await setConfigValue(body.data.key as ConfigKey, body.data.value);
  const config = await getAllConfig();
  return c.json({ config });
});
