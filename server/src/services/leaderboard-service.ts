import { query } from '../db/pool.ts';
import { computeParticipantMatchweek } from './matchweek-scoring-service.ts';

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  finalPoints: number;
  provisionalPoints: number;
  total: number;
  rank: number;
}

/**
 * Competition leaderboard (§4.8). Sums each participant's FINAL completed-week
 * scores plus a PROVISIONAL computed total for any in-progress week. Admins are
 * excluded. Standard competition ranking (1,2,2,4); tie-break = points in the
 * most recent completed matchweek, then display_name.
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

  // Standard competition ranking (ties share a rank; next rank skips).
  const ranked: LeaderboardEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prev = ranked[i - 1];
    const rank = prev && prev.total === e.total ? prev.rank : i + 1;
    ranked.push({ ...e, rank });
  }
  return ranked;
}
