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
import {
  getRulesMatrix,
  updateRules,
  recalculateAll,
  setMatchResult,
  clearMatchOverride,
  getMatchAudits,
  type MatchStatus,
} from '../services/scoring-service.ts';
import { runSync, listSyncRuns } from '../services/score-sync-service.ts';
import { getSyncSchedulerStatus } from '../services/sync-scheduler.ts';
import { progressSeason } from '../services/act-service.ts';
import { getLeagueStandings } from '../services/standings-service.ts';

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

// --- Scoring rules editor (§4.2, §16) -------------------------------------
adminRoutes.get('/scoring-rules', async (c) => {
  const rules = await getRulesMatrix();
  return c.json({ rules });
});

const UpdateRulesSchema = z.object({
  updates: z
    .array(
      z.object({
        ruleCode: z.string(),
        tierId: z.number().int().min(1).max(4),
        points: z.number().int(),
      }),
    )
    .min(1),
});

adminRoutes.put('/scoring-rules', async (c) => {
  const body = UpdateRulesSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('Geçersiz kural güncellemesi', 'invalid_body');
  const rules = await updateRules(body.data.updates);
  return c.json({ rules });
});

// --- Matches list + manual result (minimal slice of §5.3) -----------------
adminRoutes.get('/matches', async (c) => {
  const matchweekId = c.req.query('matchweek');
  const params: unknown[] = [];
  let where = '';
  if (matchweekId) {
    params.push(matchweekId);
    where = 'WHERE m.matchweek_id = $1';
  }
  const { rows } = await query(
    `SELECT m.id, m.matchweek_id, mw.label AS matchweek_label, m.kickoff_at, m.status,
            m.home_team_id, ht.name AS home_name, ht.short_name AS home_short,
            m.away_team_id, at.name AS away_name, at.short_name AS away_short,
            m.home_score, m.away_score, m.is_manual_override
     FROM matches m
     JOIN matchweeks mw ON mw.id = m.matchweek_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     ${where}
     ORDER BY m.kickoff_at
     LIMIT 500`,
    params,
  );
  return c.json({ matches: rows });
});

const MatchResultSchema = z.object({
  homeScore: z.number().int().min(0).nullable(),
  awayScore: z.number().int().min(0).nullable(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
});

adminRoutes.put('/matches/:id/result', async (c) => {
  const body = MatchResultSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('Geçersiz maç sonucu', 'invalid_body');
  await setMatchResult(
    c.req.param('id'),
    body.data.homeScore,
    body.data.awayScore,
    body.data.status as MatchStatus,
    c.get('auth').sub,
  );
  return c.json({ ok: true });
});

adminRoutes.post('/matches/:id/clear-override', async (c) => {
  await clearMatchOverride(c.req.param('id'), c.get('auth').sub);
  return c.json({ ok: true });
});

adminRoutes.get('/matches/:id/audits', async (c) => {
  const audits = await getMatchAudits(c.req.param('id'));
  return c.json({ audits });
});

// --- Provider sync (§5.2) -------------------------------------------------
const SyncSchema = z.object({
  provider: z.enum(['mock', 'football_data']).optional(),
  // Mock-only: simulate the clock so seeded future fixtures can advance.
  simulatedNow: z.string().datetime().optional(),
});

adminRoutes.post('/sync', async (c) => {
  const body = SyncSchema.safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!body.success) throw ApiError.badRequest('Geçersiz sync isteği', 'invalid_body');
  const summary = await runSync({
    providerName: body.data.provider,
    simulatedNow: body.data.simulatedNow ? new Date(body.data.simulatedNow) : undefined,
    trigger: 'manual',
  });
  return c.json({ summary });
});

adminRoutes.get('/sync/runs', async (c) => {
  const runs = await listSyncRuns();
  return c.json({ runs, scheduler: getSyncSchedulerStatus() });
});

// --- Season progression (§9.3 manual fallback) ----------------------------
adminRoutes.post('/acts/advance', async (c) => {
  await progressSeason();
  return c.json({ ok: true });
});

adminRoutes.get('/standings', async (c) => {
  const standings = await getLeagueStandings();
  return c.json({ standings });
});

// --- Full recalculate (§4.7) ----------------------------------------------
adminRoutes.post('/recalculate', async (c) => {
  const result = await recalculateAll();
  return c.json(result);
});
