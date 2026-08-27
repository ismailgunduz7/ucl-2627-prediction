import { query } from '../db/pool.ts';
import { rankOf } from '../domain/ranking.ts';
import { computeParticipantMatchweek } from './matchweek-scoring-service.ts';

export interface RankMovement {
  rank: number;
  /** Null on the season's first completed week; there is nothing to move from. */
  prevRank: number | null;
}

/**
 * Where a participant stood after a completed matchweek versus after the one
 * before it (§18.3, the wrap card's rank delta). FINAL scores only, over
 * completed weeks in play order.
 *
 * Ranking goes through `rankOf` for the same reason the leaderboard does: a
 * tie-break orders tied rows on a page but must never hand them different rank
 * numbers, or the week wrap and the leaderboard disagree about where a player
 * finished.
 */
export async function getRankMovement(
  competitionId: string,
  userId: string,
  mwId: string,
): Promise<RankMovement | null> {
  const weeks = await query<{ id: string }>(
    `SELECT id FROM matchweeks WHERE status = 'complete'
     ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END, sort_order`,
  );
  const order = weeks.rows.map((r) => r.id);
  const idx = order.indexOf(mwId);
  if (idx === -1) return null;

  const scores = await query<{ user_id: string; matchweek_id: string; points: number }>(
    `SELECT s.user_id, s.matchweek_id, s.points
     FROM player_matchday_scores s
     JOIN users u ON u.id = s.user_id
     WHERE u.competition_id = $1 AND NOT u.is_admin`,
    [competitionId],
  );
  if (!scores.rows.some((r) => r.user_id === userId)) return null;

  const rankAfter = (weekIndex: number): number | null => {
    const included = new Set(order.slice(0, weekIndex + 1));
    const totals = new Map<string, number>();
    for (const r of scores.rows) {
      if (!included.has(r.matchweek_id)) continue;
      totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + r.points);
    }
    const mine = totals.get(userId);
    if (mine === undefined) return null;
    return rankOf(mine, totals.values());
  };

  const rank = rankAfter(idx);
  if (rank === null) return null;
  return { rank, prevRank: idx > 0 ? rankAfter(idx - 1) : null };
}

export interface LeaderboardSquadClub {
  teamId: string;
  tierId: number;
  name: string;
  shortName: string;
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  finalPoints: number;
  provisionalPoints: number;
  total: number;
  rank: number;
  /** The PERMANENT four in pot order; an act transfer rewrites it, a weekly swap never shows here. */
  squad: LeaderboardSquadClub[];
}

/**
 * Competition leaderboard (§4.8). Sums each participant's FINAL completed-week
 * scores plus a PROVISIONAL computed total for any in-progress week. Admins are
 * excluded.
 *
 * Ranks are standard competition ranking (1, 2, 2, 4). Points in the most
 * recent completed matchweek and then display_name decide the order tied rows
 * are LISTED in, never the rank they are given.
 */
export async function getLeaderboard(competitionId: string): Promise<LeaderboardEntry[]> {
  const participants = await query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users
     WHERE competition_id = $1 AND NOT is_admin ORDER BY display_name`,
    [competitionId],
  );

  const finals = await query<{ user_id: string; total: string }>(
    `SELECT s.user_id, sum(s.points)::text AS total
     FROM player_matchday_scores s
     JOIN users u ON u.id = s.user_id
     WHERE u.competition_id = $1 GROUP BY s.user_id`,
    [competitionId],
  );
  const finalByUser = new Map(finals.rows.map((r) => [r.user_id, Number(r.total)]));

  // Most recent completed matchweek, for tie-break.
  const lastComplete = await query<{ id: string }>(
    `SELECT id FROM matchweeks WHERE status = 'complete'
     ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END DESC, sort_order DESC LIMIT 1`,
  );
  const lastCompleteId = lastComplete.rows[0]?.id ?? null;
  const lastWeekPoints = new Map<string, number>();
  if (lastCompleteId) {
    const rows = await query<{ user_id: string; points: number }>(
      `SELECT user_id, points FROM player_matchday_scores WHERE matchweek_id = $1`,
      [lastCompleteId],
    );
    for (const r of rows.rows) lastWeekPoints.set(r.user_id, r.points);
  }

  // In-progress weeks contribute provisional totals.
  const inProgress = await query<{ id: string }>(
    `SELECT id FROM matchweeks WHERE status = 'in_progress'`,
  );

  // Everyone's permanent four, one query for the whole competition.
  const squadRows = await query<{
    user_id: string;
    team_id: string;
    tier_id: number;
    name: string;
    short_name: string;
  }>(
    `SELECT ts.user_id, ts.team_id, ts.tier_id, t.name, t.short_name
     FROM team_selections ts
     JOIN teams t ON t.id = ts.team_id
     JOIN users u ON u.id = ts.user_id
     WHERE u.competition_id = $1
     ORDER BY ts.tier_id`,
    [competitionId],
  );
  const squadByUser = new Map<string, LeaderboardSquadClub[]>();
  for (const r of squadRows.rows) {
    const list = squadByUser.get(r.user_id) ?? [];
    list.push({ teamId: r.team_id, tierId: r.tier_id, name: r.name, shortName: r.short_name });
    squadByUser.set(r.user_id, list);
  }

  const entries: Omit<LeaderboardEntry, 'rank'>[] = [];
  for (const p of participants.rows) {
    const finalPoints = finalByUser.get(p.id) ?? 0;
    let provisionalPoints = 0;
    for (const mw of inProgress.rows) {
      const score = await computeParticipantMatchweek(p.id, mw.id);
      if (score) provisionalPoints += score.total;
    }
    entries.push({
      userId: p.id,
      displayName: p.display_name,
      finalPoints,
      provisionalPoints,
      total: finalPoints + provisionalPoints,
      squad: squadByUser.get(p.id) ?? [],
    });
  }

  // Sort: total desc, last completed week desc, display_name asc.
  entries.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const la = lastWeekPoints.get(a.userId) ?? 0;
    const lb = lastWeekPoints.get(b.userId) ?? 0;
    if (lb !== la) return lb - la;
    return a.displayName.localeCompare(b.displayName, 'tr');
  });

  // Standard competition ranking. The sort above only decides display order;
  // the number itself comes from the shared helper (§4.8).
  const totals = entries.map((e) => e.total);
  return entries.map((e) => ({ ...e, rank: rankOf(e.total, totals) }));
}
