import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { matchweekLabel } from '../lib/labels.ts';
import { requireAdmin, requireAuth, type AuthVariables } from '../middleware/auth.ts';
import * as authService from '../services/auth-service.ts';
import { listTeams } from '../services/team-service.ts';
import {
  DEFAULT_CONFIG,
  getAllConfig,
  setConfigValues,
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
import { lastJobRun } from '../services/job-claim.ts';
import { getEnv } from '../config/env.ts';
import { progressSeason } from '../services/act-service.ts';
import { getLeagueStandings } from '../services/standings-service.ts';
import { getInventory, setInventoryCount } from '../services/joker-service.ts';
import type { JokerCode } from '../domain/joker.ts';
import { SQUAD_SIZE } from '../domain/constants.ts';

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

const CompetitionSchema = z.object({ name: z.string().trim().min(1).max(120) });

adminRoutes.post('/competitions', async (c) => {
  const body = CompetitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('competition_name_required');
  const { rows } = await query(
    `INSERT INTO competitions (name) VALUES ($1) RETURNING id, name, created_at`,
    [body.data.name],
  );
  return c.json({ competition: rows[0] }, 201);
});

/** Rename only: a competition is a name and the people in it, and moving people is the users API (§9.3). */
adminRoutes.put('/competitions/:id', async (c) => {
  const body = CompetitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('competition_name_required');
  const { rows } = await query(
    `UPDATE competitions SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
    [body.data.name, c.req.param('id')],
  );
  if (rows.length === 0) throw ApiError.badRequest('competition_not_found');
  return c.json({ competition: rows[0] });
});

adminRoutes.delete('/competitions/:id', async (c) => {
  const id = c.req.param('id');

  // users.competition_id is ON DELETE SET NULL, so deleting a competition that
  // still has people in it would quietly unscope them: a participant with no
  // competition sees no leaderboard and appears on nobody else's. Refuse, and
  // say how many accounts have to be moved first.
  const members = await query<{ n: string }>(
    'SELECT count(*)::text AS n FROM users WHERE competition_id = $1',
    [id],
  );
  const count = Number(members.rows[0]!.n);
  if (count > 0) throw ApiError.badRequest('competition_in_use', { count });

  const deleted = await query('DELETE FROM competitions WHERE id = $1', [id]);
  if (deleted.rowCount === 0) throw ApiError.badRequest('competition_not_found');
  return c.json({ ok: true });
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
  // No length policy: this is a private league and the admin hands the password
  // to the player. The upper bound is there so a paste accident cannot become a
  // hashing job. Brute force is answered by the login rate limiter (§12).
  password: z.string().min(1).max(256),
  displayName: z.string().min(1).max(120),
  isAdmin: z.boolean().optional(),
  competitionId: z.string().uuid().nullable().optional(),
});

adminRoutes.post('/users', async (c) => {
  const body = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    throw ApiError.badRequest('invalid_user_body', undefined, body.error.flatten());
  }
  const user = await authService.createUser(body.data);
  return c.json({ user }, 201);
});

const UpdateUserSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    competitionId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.competitionId !== undefined, {
    message: 'nothing to update',
  });

adminRoutes.put('/users/:id', async (c) => {
  const body = UpdateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    throw ApiError.badRequest('invalid_user_body', undefined, body.error.flatten());
  }
  const user = await authService.updateUser(c.req.param('id'), body.data);
  return c.json({ user });
});

const SetPasswordSchema = z.object({ password: z.string().min(1).max(256) });

adminRoutes.put('/users/:id/password', async (c) => {
  const body = SetPasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('password_required');
  await authService.setUserPassword(c.req.param('id'), body.data.password);
  return c.json({ ok: true });
});

adminRoutes.delete('/users/:id', async (c) => {
  const auth = c.get('auth');
  await authService.deleteUser(c.req.param('id'), auth.sub);
  return c.json({ ok: true });
});

// --- Who picked what (§9.3) -----------------------------------------------

interface SquadClubRow {
  user_id: string;
  display_name: string;
  username: string;
  competition_name: string | null;
  entry_matchweek_id: string | null;
  entry_matchweek_label: string | null;
  tier_id: number | null;
  team_id: string | null;
  team_name: string | null;
  short_name: string | null;
  crest_url: string | null;
  eliminated_at: Date | null;
}

/**
 * Every participant's permanent squad, in one table.
 *
 * A participant with no rows is listed all the same, because the whole point of
 * looking is to find the ones who never picked (§3.2). The four clubs come back
 * in pot order, so a column stays a pot.
 */
adminRoutes.get('/squads', async (c) => {
  const { rows } = await query<SquadClubRow>(
    `SELECT u.id AS user_id, u.display_name, u.username, comp.name AS competition_name,
            u.entry_matchweek_id, mw.label AS entry_matchweek_label,
            ts.tier_id, t.id AS team_id, t.name AS team_name, t.short_name,
            t.crest_url, t.eliminated_at
       FROM users u
       LEFT JOIN competitions comp ON comp.id = u.competition_id
       LEFT JOIN matchweeks mw ON mw.id = u.entry_matchweek_id
       LEFT JOIN team_selections ts ON ts.user_id = u.id
       LEFT JOIN teams t ON t.id = ts.team_id
      WHERE NOT u.is_admin
      ORDER BY comp.name NULLS LAST, u.display_name, ts.tier_id`,
  );

  const byUser = new Map<string, {
    userId: string;
    displayName: string;
    username: string;
    competitionName: string | null;
    entryMatchweek: string | null;
    clubs: {
      tierId: number;
      teamId: string;
      name: string;
      shortName: string;
      crestUrl: string | null;
      eliminated: boolean;
    }[];
  }>();

  for (const r of rows) {
    let entry = byUser.get(r.user_id);
    if (!entry) {
      entry = {
        userId: r.user_id,
        displayName: r.display_name,
        username: r.username,
        competitionName: r.competition_name,
        // A late entrant's season starts here; null means from the first week.
        entryMatchweek: r.entry_matchweek_id
          ? matchweekLabel({ id: r.entry_matchweek_id, label: r.entry_matchweek_label ?? '' })
          : null,
        clubs: [],
      };
      byUser.set(r.user_id, entry);
    }
    if (r.team_id && r.tier_id !== null) {
      entry.clubs.push({
        tierId: r.tier_id,
        teamId: r.team_id,
        name: r.team_name ?? '',
        shortName: r.short_name ?? '',
        crestUrl: r.crest_url,
        eliminated: r.eliminated_at !== null,
      });
    }
  }

  // Jokers, read for everybody at once rather than per row: what is left of
  // each one, and which weeks the played ones went on (a cancelled activation
  // was refunded and never happened as far as the season is concerned, §3.6).
  const inventory = await query<{ user_id: string; code: string; remaining: number }>(
    `SELECT ji.user_id, ji.joker_type_code AS code, ji.remaining_count AS remaining
       FROM joker_inventory ji
       JOIN users u ON u.id = ji.user_id AND NOT u.is_admin`,
  );
  const played = await query<{ user_id: string; code: string; matchweek_id: string; label: string }>(
    `SELECT ja.user_id, ja.joker_type_code AS code, ja.matchweek_id, mw.label
       FROM joker_activations ja
       JOIN matchweeks mw ON mw.id = ja.matchweek_id
       JOIN users u ON u.id = ja.user_id AND NOT u.is_admin
      WHERE ja.cancelled_at IS NULL
      ORDER BY CASE mw.act WHEN 'league_phase' THEN 0 ELSE 1 END, mw.sort_order`,
  );

  const types = await query<{ code: string; sort_order: number }>(
    'SELECT code, sort_order FROM joker_types ORDER BY sort_order',
  );

  const jokersByUser = new Map<string, Map<string, { remaining: number; played: string[] }>>();
  function jokersFor(userId: string): Map<string, { remaining: number; played: string[] }> {
    let held = jokersByUser.get(userId);
    if (!held) {
      held = new Map(types.rows.map((t) => [t.code, { remaining: 0, played: [] }]));
      jokersByUser.set(userId, held);
    }
    return held;
  }
  for (const r of inventory.rows) {
    const slot = jokersFor(r.user_id).get(r.code);
    if (slot) slot.remaining = r.remaining;
  }
  for (const r of played.rows) {
    const slot = jokersFor(r.user_id).get(r.code);
    if (slot) slot.played.push(matchweekLabel({ id: r.matchweek_id, label: r.label }));
  }

  const squads = [...byUser.values()].map((squad) => ({
    ...squad,
    jokers: types.rows.map((type) => {
      const held = jokersFor(squad.userId).get(type.code)!;
      return { code: type.code, remaining: held.remaining, played: held.played };
    }),
  }));

  return c.json({ squads, squadSize: SQUAD_SIZE });
});

// --- Joker inventory repair (§9.3) ----------------------------------------
adminRoutes.get('/users/:id/jokers', async (c) => {
  const inventory = await getInventory(c.req.param('id'));
  return c.json({ inventory });
});

const JOKER_CODES = ['weekly_swap', 'triple_boost', 'clean_sheet_shield', 'bench_boost'] as const;
const JokerInventorySchema = z.object({
  counts: z.record(z.enum(JOKER_CODES), z.number().int().min(0).max(99)),
});

adminRoutes.put('/users/:id/jokers', async (c) => {
  const body = JokerInventorySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_joker_counts');
  const userId = c.req.param('id');
  const user = await query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (user.rowCount === 0) throw ApiError.badRequest('user_not_found');
  for (const [code, remaining] of Object.entries(body.data.counts)) {
    await setInventoryCount(userId, code as JokerCode, remaining);
  }
  return c.json({ inventory: await getInventory(userId) });
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

const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
});
// One knob, or a whole form's worth. A form is a single decision by the admin,
// so its keys are written in one transaction rather than one request each.
const ConfigBodySchema = z.union([
  ConfigEntrySchema,
  z.object({ updates: z.array(ConfigEntrySchema).min(1) }),
]);

adminRoutes.put('/config', async (c) => {
  const body = ConfigBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_config_body');
  const entries = 'updates' in body.data ? body.data.updates : [body.data];
  for (const entry of entries) {
    if (!(entry.key in DEFAULT_CONFIG)) {
      throw ApiError.badRequest('unknown_config_key', { key: entry.key });
    }
  }
  await setConfigValues(entries.map((e) => ({ key: e.key as ConfigKey, value: e.value })));
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
  if (!body.success) throw ApiError.badRequest('invalid_rule_update');
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
  const { rows } = await query<{ matchweek_id: string; matchweek_label: string }>(
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
  return c.json({
    matches: rows.map((m) => ({
      ...m,
      matchweek_label: matchweekLabel({ id: m.matchweek_id, label: m.matchweek_label }),
    })),
  });
});

const MatchResultSchema = z.object({
  homeScore: z.number().int().min(0).nullable(),
  awayScore: z.number().int().min(0).nullable(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
});

adminRoutes.put('/matches/:id/result', async (c) => {
  const body = MatchResultSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_match_result');
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
  if (!body.success) throw ApiError.badRequest('invalid_sync_request');
  const summary = await runSync({
    providerName: body.data.provider,
    simulatedNow: body.data.simulatedNow ? new Date(body.data.simulatedNow) : undefined,
    trigger: 'manual',
  });
  return c.json({ summary });
});

adminRoutes.get('/sync/runs', async (c) => {
  const [runs, timer, claimed] = await Promise.all([
    listSyncRuns(),
    Promise.resolve(getSyncSchedulerStatus()),
    lastJobRun('provider_sync'),
  ]);

  // What is actually driving the season. An in-process timer only exists on a
  // host that stays awake; elsewhere an external cron pings /api/cron/tick, and
  // reporting that as "off" would call a working season broken.
  const driver = timer.enabled ? 'timer' : getEnv().CRON_SECRET ? 'cron' : 'off';

  return c.json({
    runs,
    scheduler: {
      ...timer,
      driver,
      // The claim row is written by whichever driver ran, so it is the honest
      // answer to "when did this last poll" under either of them.
      lastRunAt: claimed?.toISOString() ?? timer.lastRunAt,
    },
  });
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
