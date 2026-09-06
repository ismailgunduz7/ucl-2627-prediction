import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors.ts';
import { matchweekLabel } from '../lib/labels.ts';
import { requireAuth, type AuthVariables } from '../middleware/auth.ts';
import { listTeamsByPot } from '../services/team-service.ts';
import { getSquad, setSquad } from '../services/selection-service.ts';
import {
  getCurrentMatchweek,
  getFirstLeagueMatchweek,
  getOrderedMatchweeks,
  getSelectionLockState,
  lineupEditability,
  lockStateFor,
  type MatchweekRow,
} from '../services/matchweek-lifecycle-service.ts';
import { getConfigValue } from '../services/tournament-config-service.ts';
import { getRulesMatrix, getTeamDetail } from '../services/scoring-service.ts';
import { getEffectiveSquad, getLineup, setLineup } from '../services/lineup-service.ts';
import { getParticipantWeekScore } from '../services/matchweek-scoring-service.ts';
import { getLeaderboard, getRankMovement } from '../services/leaderboard-service.ts';
import { getPlayerPoints } from '../services/player-points-service.ts';
import { getLeagueStandings } from '../services/standings-service.ts';
import { isSeasonComplete } from '../services/knockout-service.ts';
import { getActTransfer, setActTransfer } from '../services/act-service.ts';
import {
  activate as activateJoker,
  cancel as cancelJoker,
  getActiveJoker,
  getInventory,
} from '../services/joker-service.ts';
import { getBriefing, getOpenPicks } from '../services/briefing-service.ts';
import { getWeekPredictions, savePrediction } from '../services/prediction-service.ts';
import { getRoundFixtures } from '../services/fixture-service.ts';
import { getWeekDeltas } from '../services/delta-service.ts';
import { getSeasonReplay } from '../services/season-replay-service.ts';
import { matchweekMenuEntry, roundOptions } from '../domain/matchweek-menu.ts';
import type { JokerCode } from '../domain/joker.ts';
import { query } from '../db/pool.ts';
import { SQUAD_SIZE } from '../domain/constants.ts';

export const participantRoutes = new Hono<{ Variables: AuthVariables }>();
participantRoutes.use('*', requireAuth);

// --- Teams (pots + clubs) -------------------------------------------------
participantRoutes.get('/teams', async (c) => {
  const pots = await listTeamsByPot();
  return c.json({
    pots: pots.map(({ tier, teams }) => ({
      tierId: tier.id,
      tierName: tier.name,
      sortOrder: tier.sort_order,
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        shortName: t.short_name,
        crestUrl: t.crest_url,
        country: t.country,
        isActive: t.is_active,
        eliminated: t.eliminated_at !== null,
      })),
    })),
  });
});

// --- Team detail (club page) ---------------------------------------------
participantRoutes.get('/teams/:id', async (c) => {
  const detail = await getTeamDetail(c.req.param('id'));
  return c.json(detail);
});

// --- Scoring rules matrix (read-only) ------------------------------------
participantRoutes.get('/scoring-rules', async (c) => {
  const [rules, predictionPointsPerCorrect, jokerGrants] = await Promise.all([
    getRulesMatrix(),
    getConfigValue('prediction_points_per_correct'),
    // The per-act grant counts, so the rules page states the real numbers.
    getConfigValue('joker_inventory_defaults'),
  ]);
  return c.json({ rules, predictionPointsPerCorrect, jokerGrants });
});

// --- Tournament status ----------------------------------------------------
participantRoutes.get('/tournament/status', async (c) => {
  const now = new Date();
  const [currentAct, mw1, current, selectionLock, mwRows, ordered, seasonComplete] = await Promise.all([
    getConfigValue('current_act'),
    getFirstLeagueMatchweek(),
    getCurrentMatchweek(),
    getSelectionLockState(now),
    query<MatchweekRow>(
      // Play order, league before knockout. A plain ORDER BY act would sort the
      // text values instead and put 'knockout' first.
      `SELECT id, act, sort_order, label, status, first_kickoff_at, completed_at
       FROM matchweeks ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END, sort_order`,
    ),
    getOrderedMatchweeks(),
    isSeasonComplete(),
  ]);

  return c.json({
    serverTime: now.toISOString(),
    currentAct,
    squadSize: SQUAD_SIZE,
    selectionLock: {
      firstKickoffAt: selectionLock.firstKickoffAt?.toISOString() ?? null,
      lockAt: selectionLock.lockAt?.toISOString() ?? null,
      locked: selectionLock.locked,
    },
    matchweeks: mwRows.rows.map((mw) => {
      const ls = lockStateFor(mw, now);
      const edit = lineupEditability(ordered, mw.id, now);
      const menu = matchweekMenuEntry({
        id: mw.id,
        act: mw.act,
        sortOrder: mw.sort_order,
        label: mw.label,
      });
      return {
        id: mw.id,
        act: mw.act,
        sortOrder: mw.sort_order,
        label: matchweekLabel(mw),
        // How a week picker should file this week (§10.1).
        menu,
        status: mw.status,
        firstKickoffAt: mw.first_kickoff_at ? new Date(mw.first_kickoff_at).toISOString() : null,
        lockAt: ls.lockAt?.toISOString() ?? null,
        locked: ls.locked,
        opened: edit.opened,
        editable: edit.editable,
      };
    }),
    // Ready-made options for a picker that opens a whole round (§10.1).
    rounds: roundOptions(
      mwRows.rows.map((mw) => ({
        id: mw.id,
        act: mw.act,
        sortOrder: mw.sort_order,
        label: mw.label,
      })),
    ),
    mw1Id: mw1?.id ?? null,
    currentMatchweekId: current?.id ?? null,
    /** The final has been played, so the season replay has something to show. */
    seasonComplete,
  });
});

// --- Weekly lineup (bench/captain) ----------------------------------------
participantRoutes.get('/matchweeks/:id/lineup', async (c) => {
  const auth = c.get('auth');
  const mwId = c.req.param('id');
  const [lineup, squad] = await Promise.all([getLineup(auth.sub, mwId), getEffectiveSquad(auth.sub, mwId)]);
  if (!lineup) return c.json({ lineup: null, squad: [] });
  return c.json({
    lineup: {
      benchTeamId: lineup.benchTeamId,
      captainTeamId: lineup.captainTeamId,
      saved: lineup.saved,
      lockAt: lineup.editability.lockAt?.toISOString() ?? null,
      locked: lineup.editability.locked,
      opened: lineup.editability.opened,
      editable: lineup.editability.editable,
    },
    squad,
  });
});

const LineupSchema = z.object({
  benchTeamId: z.string().uuid(),
  captainTeamId: z.string().uuid(),
});

participantRoutes.put('/matchweeks/:id/lineup', async (c) => {
  const auth = c.get('auth');
  const body = LineupSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('lineup_body_required');
  const lineup = await setLineup(auth.sub, c.req.param('id'), body.data.benchTeamId, body.data.captainTeamId);
  return c.json({
    lineup: {
      benchTeamId: lineup.benchTeamId,
      captainTeamId: lineup.captainTeamId,
      saved: true,
      lockAt: lineup.editability.lockAt?.toISOString() ?? null,
      locked: lineup.editability.locked,
    },
  });
});

// --- Participant matchweek score (provisional or final) -------------------
participantRoutes.get('/matchweeks/:id/score', async (c) => {
  const auth = c.get('auth');
  const mwId = c.req.param('id');
  const score = await getParticipantWeekScore(auth.sub, mwId);
  if (!score) return c.json({ score: null, rankMove: null });
  // The wrap card's rank delta (§18.3): only a completed week has one.
  const rankMove =
    score.final && auth.competitionId
      ? await getRankMovement(auth.competitionId, auth.sub, mwId)
      : null;
  return c.json({ score, rankMove });
});

// --- Live delta feed (§18.6) ----------------------------------------------
participantRoutes.get('/matchweeks/:id/deltas', async (c) => {
  const auth = c.get('auth');
  return c.json(await getWeekDeltas(auth.sub, c.req.param('id')));
});

// --- Fixtures + multi-live (§18.5) ----------------------------------------
// Addressed by round, so a two-legged tie is one page with two sections.
participantRoutes.get('/rounds/:key/fixtures', async (c) => {
  const auth = c.get('auth');
  const fixtures = await getRoundFixtures(auth.sub, c.req.param('key'));
  return c.json(fixtures);
});

// --- Ahtapot Paul: 1X2 predictions (§18.9) --------------------------------
participantRoutes.get('/matchweeks/:id/predictions', async (c) => {
  const auth = c.get('auth');
  const predictions = await getWeekPredictions(auth.sub, c.req.param('id'));
  return c.json(predictions);
});

const PredictionSchema = z.object({
  matchId: z.string().uuid(),
  // null clears a call the participant no longer wants to make.
  pick: z.enum(['home', 'draw', 'away']).nullable(),
});

participantRoutes.put('/matchweeks/:id/predictions', async (c) => {
  const auth = c.get('auth');
  const body = PredictionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_prediction_request');
  const predictions = await savePrediction(
    auth.sub,
    c.req.param('id'),
    body.data.matchId,
    body.data.pick,
  );
  return c.json(predictions);
});

// --- Jokers (§3.6) --------------------------------------------------------
participantRoutes.get('/matchweeks/:id/jokers', async (c) => {
  const auth = c.get('auth');
  const mwId = c.req.param('id');
  const [inventory, active] = await Promise.all([
    getInventory(auth.sub),
    getActiveJoker(auth.sub, mwId),
  ]);
  return c.json({ inventory, active });
});

const ActivateJokerSchema = z.object({
  code: z.enum(['weekly_swap', 'triple_boost', 'clean_sheet_shield', 'bench_boost']),
  payload: z.record(z.unknown()).default({}),
});

participantRoutes.post('/matchweeks/:id/jokers', async (c) => {
  const auth = c.get('auth');
  const body = ActivateJokerSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_joker_request');
  const active = await activateJoker(auth.sub, c.req.param('id'), body.data.code as JokerCode, body.data.payload);
  return c.json({ active });
});

participantRoutes.delete('/matchweeks/:id/jokers', async (c) => {
  const auth = c.get('auth');
  await cancelJoker(auth.sub, c.req.param('id'));
  return c.json({ ok: true });
});

// --- Briefing + open picks (§18.1, §18.4) ---------------------------------
participantRoutes.get('/matchweeks/:id/briefing', async (c) => {
  const auth = c.get('auth');
  const briefing = await getBriefing(auth.sub, c.req.param('id'));
  return c.json({ briefing });
});

participantRoutes.get('/matchweeks/:id/open-picks', async (c) => {
  const auth = c.get('auth');
  if (!auth.competitionId) return c.json({ available: false, picks: [] });
  const result = await getOpenPicks(auth.competitionId, c.req.param('id'));
  return c.json(result);
});

// --- Player season breakdown ---------------------------------------------
participantRoutes.get('/players/:id/points', async (c) => {
  const auth = c.get('auth');
  const data = await getPlayerPoints(c.req.param('id'), auth.competitionId);
  return c.json(data);
});

// --- League table (§2.2) --------------------------------------------------
participantRoutes.get('/standings', async (c) => {
  const standings = await getLeagueStandings();
  return c.json({ standings });
});

// --- Season replay (§18.8) ------------------------------------------------
participantRoutes.get('/season/replay', async (c) => {
  const auth = c.get('auth');
  return c.json(await getSeasonReplay(auth.sub, auth.competitionId));
});

// --- Act transfer (§3.7) --------------------------------------------------
participantRoutes.get('/act-transfer', async (c) => {
  const auth = c.get('auth');
  return c.json(await getActTransfer(auth.sub));
});

const ActTransferSchema = z.object({
  fromTeamId: z.string().uuid(),
  toTeamId: z.string().uuid(),
  // Confirmed answer to a 409 joker_squad_conflict: cancel + refund, then apply.
  cancelJokers: z.boolean().optional(),
});

participantRoutes.put('/act-transfer', async (c) => {
  const auth = c.get('auth');
  const body = ActTransferSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw ApiError.badRequest('invalid_transfer_request');
  return c.json(
    await setActTransfer(auth.sub, body.data.fromTeamId, body.data.toTeamId, body.data.cancelJokers),
  );
});

// --- Leaderboard (§4.8) ---------------------------------------------------
participantRoutes.get('/leaderboard', async (c) => {
  const auth = c.get('auth');
  if (!auth.competitionId) return c.json({ leaderboard: [], competitionId: null });
  const leaderboard = await getLeaderboard(auth.competitionId);
  return c.json({ leaderboard, competitionId: auth.competitionId, meId: auth.sub });
});

// --- Permanent squad ------------------------------------------------------
participantRoutes.get('/squad', async (c) => {
  const auth = c.get('auth');
  const [squad, lock] = await Promise.all([getSquad(auth.sub), getSelectionLockState()]);
  return c.json({
    squad: squad.map((s) => ({ ...s, eliminated: s.eliminatedAt !== null })),
    locked: lock.locked,
    lockAt: lock.lockAt?.toISOString() ?? null,
  });
});

const PutSquadSchema = z.object({
  teamIds: z.array(z.string().uuid()).length(SQUAD_SIZE),
  // Confirmed answer to a 409 joker_squad_conflict: cancel + refund, then apply.
  cancelJokers: z.boolean().optional(),
});

participantRoutes.put('/squad', async (c) => {
  const auth = c.get('auth');
  const body = PutSquadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    throw ApiError.badRequest('squad_size_required', { size: SQUAD_SIZE });
  }
  const squad = await setSquad(auth.sub, body.data.teamIds, body.data.cancelJokers);
  return c.json({ squad: squad.map((s) => ({ ...s, eliminated: s.eliminatedAt !== null })) });
});
