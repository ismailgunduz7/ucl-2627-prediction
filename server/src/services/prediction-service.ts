import { query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import {
  isOutcome,
  outcomeOf,
  tallyPredictions,
  type Outcome,
  type PredictionTally,
} from '../domain/prediction.ts';
import { getConfigValue } from './tournament-config-service.ts';
import { getOrderedMatchweeks, lineupEditability } from './matchweek-lifecycle-service.ts';

/**
 * Ahtapot Paul (§18.9): a 1X2 call on every match of the matchweek. Picks share
 * the lineup's deadline, one for the whole week, and pay out as part of that
 * week's participant score.
 */

export interface PredictionMatch {
  matchId: string;
  homeTeamId: string;
  homeName: string;
  awayTeamId: string;
  awayName: string;
  kickoffAt: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  /** The participant's call, if made. */
  pick: Outcome | null;
  /** What happened, once there is a score to read. */
  result: Outcome | null;
}

export interface WeekPredictions {
  matches: PredictionMatch[];
  editable: boolean;
  lockAt: string | null;
  pointsPerCorrect: number;
  tally: PredictionTally;
}

interface MatchRow {
  id: string;
  home_team_id: string;
  home_name: string;
  away_team_id: string;
  away_name: string;
  kickoff_at: Date | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

async function matchesOfWeek(mwId: string): Promise<MatchRow[]> {
  const { rows } = await query<MatchRow>(
    `SELECT m.id, m.home_team_id, ht.name AS home_name, m.away_team_id, at.name AS away_name,
            m.kickoff_at, m.status, m.home_score, m.away_score
     FROM matches m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE m.matchweek_id = $1
     ORDER BY m.kickoff_at, ht.name`,
    [mwId],
  );
  return rows;
}

async function picksOf(userId: string, matchIds: string[]): Promise<Map<string, Outcome>> {
  if (matchIds.length === 0) return new Map();
  const { rows } = await query<{ match_id: string; pick: Outcome }>(
    `SELECT match_id, pick FROM match_predictions
     WHERE user_id = $1 AND match_id = ANY($2::uuid[])`,
    [userId, matchIds],
  );
  return new Map(rows.map((r) => [r.match_id, r.pick]));
}

/**
 * Results so far. A live match counts on its current score, the same way club
 * points are drafted while a match is in play (§4.3 Option A). A cancelled or
 * postponed match never counts.
 */
function resultsOf(matches: MatchRow[]): Map<string, Outcome | null> {
  return new Map(
    matches.map((m) => [
      m.id,
      m.status === 'finished' || m.status === 'live' ? outcomeOf(m.home_score, m.away_score) : null,
    ]),
  );
}

/** The matches whose result can still change before the whistle. */
function liveIdsOf(matches: MatchRow[]): Set<string> {
  return new Set(matches.filter((m) => m.status === 'live').map((m) => m.id));
}

export async function getWeekPredictions(userId: string, mwId: string): Promise<WeekPredictions> {
  const [matches, ordered, pointsPerCorrect] = await Promise.all([
    matchesOfWeek(mwId),
    getOrderedMatchweeks(),
    getConfigValue('prediction_points_per_correct'),
  ]);
  const picks = await picksOf(userId, matches.map((m) => m.id));
  const results = resultsOf(matches);
  const editability = lineupEditability(ordered, mwId);

  return {
    matches: matches.map((m) => ({
      matchId: m.id,
      homeTeamId: m.home_team_id,
      homeName: m.home_name,
      awayTeamId: m.away_team_id,
      awayName: m.away_name,
      kickoffAt: m.kickoff_at ? new Date(m.kickoff_at).toISOString() : null,
      status: m.status,
      homeScore: m.home_score,
      awayScore: m.away_score,
      pick: picks.get(m.id) ?? null,
      result: results.get(m.id) ?? null,
    })),
    editable: editability.editable,
    lockAt: editability.lockAt?.toISOString() ?? null,
    pointsPerCorrect,
    tally: tallyPredictions(picks, results, pointsPerCorrect, liveIdsOf(matches)),
  };
}

/** Save (or clear) one call. Rejected once the week's deadline has passed. */
export async function savePrediction(
  userId: string,
  mwId: string,
  matchId: string,
  pick: string | null,
): Promise<WeekPredictions> {
  const ordered = await getOrderedMatchweeks();
  const editability = lineupEditability(ordered, mwId);
  if (!editability.editable) {
    throw ApiError.badRequest('Tahminler kilitlendi', 'predictions_locked');
  }

  const belongs = await query<{ id: string }>(
    'SELECT id FROM matches WHERE id = $1 AND matchweek_id = $2',
    [matchId, mwId],
  );
  if (!belongs.rows[0]) throw ApiError.badRequest('Maç bu haftaya ait değil', 'match_not_in_week');

  if (pick === null) {
    await query('DELETE FROM match_predictions WHERE user_id = $1 AND match_id = $2', [
      userId,
      matchId,
    ]);
  } else {
    if (!isOutcome(pick)) throw ApiError.badRequest('Geçersiz tahmin', 'invalid_pick');
    await query(
      `INSERT INTO match_predictions (user_id, match_id, pick) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET pick = EXCLUDED.pick, updated_at = now()`,
      [userId, matchId, pick],
    );
  }

  return getWeekPredictions(userId, mwId);
}

/** What Ahtapot Paul is worth to this participant this week (§18.9). */
export async function getPredictionTally(userId: string, mwId: string): Promise<PredictionTally> {
  const [matches, pointsPerCorrect] = await Promise.all([
    matchesOfWeek(mwId),
    getConfigValue('prediction_points_per_correct'),
  ]);
  const picks = await picksOf(userId, matches.map((m) => m.id));
  return tallyPredictions(picks, resultsOf(matches), pointsPerCorrect, liveIdsOf(matches));
}
