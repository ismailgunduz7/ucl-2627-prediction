import { query } from '../db/pool.ts';
import { isSeasonComplete } from './knockout-service.ts';
import { getLeaderboard } from './leaderboard-service.ts';
import { matchweekLabel } from '../lib/labels.ts';

/**
 * Season replay (§18.8): the end-of-season retrospective. Everything is read
 * from what the season already wrote: final week scores, joker activations, the
 * act transfer row. The replay only summarises, it never recomputes. It unlocks
 * when the final's matchweek completes.
 */

export interface ReplayWeek {
  matchweekId: string;
  label: string;
  points: number;
  cumulative: number;
}

export interface ReplayJoker {
  code: string;
  weekLabel: string;
}

export interface SeasonReplay {
  /** The final has been played; the story has an ending. */
  finished: boolean;
  rank: number | null;
  total: number;
  bestWeek: { label: string; points: number } | null;
  worstWeek: { label: string; points: number } | null;
  /** Weeks where the captain was the week's top-scoring club of the four. */
  captainHits: number;
  captainWeeks: number;
  jokers: ReplayJoker[];
  transfer: 'committed' | 'expired' | 'unavailable';
  timeline: ReplayWeek[];
  podium: { userId: string; displayName: string; total: number; rank: number }[];
}

interface BreakdownLine {
  basePoints: number;
  benched: boolean;
  captain: boolean;
}

interface WeekRow {
  matchweek_id: string;
  label: string;
  points: number;
  breakdown: { lines?: BreakdownLine[]; jokerCode?: string | null };
}

export async function getSeasonReplay(
  userId: string,
  competitionId: string | null,
): Promise<SeasonReplay> {
  const finished = await isSeasonComplete();

  const weeks = await query<WeekRow>(
    `SELECT s.matchweek_id, mw.label, s.points, s.breakdown
     FROM player_matchday_scores s
     JOIN matchweeks mw ON mw.id = s.matchweek_id
     WHERE s.user_id = $1 AND mw.status = 'complete'
     ORDER BY CASE mw.act WHEN 'league_phase' THEN 0 ELSE 1 END, mw.sort_order`,
    [userId],
  );

  let cumulative = 0;
  const timeline: ReplayWeek[] = weeks.rows.map((w) => {
    cumulative += w.points;
    return {
      matchweekId: w.matchweek_id,
      label: matchweekLabel({ id: w.matchweek_id, label: w.label }),
      points: w.points,
      cumulative,
    };
  });

  let bestWeek: SeasonReplay['bestWeek'] = null;
  let worstWeek: SeasonReplay['worstWeek'] = null;
  for (const w of timeline) {
    if (!bestWeek || w.points > bestWeek.points) bestWeek = { label: w.label, points: w.points };
    if (!worstWeek || w.points < worstWeek.points) worstWeek = { label: w.label, points: w.points };
  }

  // Captain hit: the captained club out-scored (or tied) every other club that
  // counted that week, judged on base points before the multiplier.
  let captainHits = 0;
  let captainWeeks = 0;
  for (const w of weeks.rows) {
    const lines = w.breakdown.lines ?? [];
    const benchBoost = w.breakdown.jokerCode === 'bench_boost';
    const scoring = lines.filter((l) => benchBoost || !l.benched);
    const captain = scoring.find((l) => l.captain);
    if (!captain || scoring.length === 0) continue;
    captainWeeks++;
    const top = Math.max(...scoring.map((l) => l.basePoints));
    if (captain.basePoints >= top) captainHits++;
  }

  const jokerRows = await query<{ code: string; matchweek_id: string; week_label: string }>(
    `SELECT a.joker_type_code AS code, a.matchweek_id, mw.label AS week_label
     FROM joker_activations a
     JOIN matchweeks mw ON mw.id = a.matchweek_id
     WHERE a.user_id = $1 AND a.cancelled_at IS NULL
     ORDER BY CASE mw.act WHEN 'league_phase' THEN 0 ELSE 1 END, mw.sort_order`,
    [userId],
  );

  const transferRow = await query<{ status: 'available' | 'committed' | 'expired' }>(
    'SELECT status FROM act_transfers WHERE user_id = $1',
    [userId],
  );
  // By replay time the window is long shut: an untouched grant reads expired.
  const transfer =
    transferRow.rows[0] === undefined
      ? 'unavailable'
      : transferRow.rows[0].status === 'committed'
        ? 'committed'
        : 'expired';

  let rank: number | null = null;
  let podium: SeasonReplay['podium'] = [];
  if (competitionId) {
    const leaderboard = await getLeaderboard(competitionId);
    rank = leaderboard.find((e) => e.userId === userId)?.rank ?? null;
    podium = leaderboard.slice(0, 3).map((e) => ({
      userId: e.userId,
      displayName: e.displayName,
      total: e.total,
      rank: e.rank,
    }));
  }

  return {
    finished,
    rank,
    total: cumulative,
    bestWeek,
    worstWeek,
    captainHits,
    captainWeeks,
    jokers: jokerRows.rows.map((r) => ({
      code: r.code,
      weekLabel: matchweekLabel({ id: r.matchweek_id, label: r.week_label }),
    })),
    transfer,
    timeline,
    podium,
  };
}
