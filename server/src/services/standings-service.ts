import { query } from '../db/pool.ts';
import { computeStandings, type StandingRow } from '../domain/standings.ts';

/** The league-phase table built from finished league matches (§2.2). */
export async function getLeagueStandings(): Promise<StandingRow[]> {
  const [teamsRes, matchesRes] = await Promise.all([
    query<{ id: string; name: string }>(
      'SELECT id, name FROM teams WHERE is_active ORDER BY name',
    ),
    query<{ home_team_id: string; away_team_id: string; home_score: number; away_score: number }>(
      `SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
       FROM matches m
       JOIN matchweeks mw ON mw.id = m.matchweek_id
       WHERE mw.act = 'league_phase' AND m.status = 'finished'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`,
    ),
  ]);

  return computeStandings(
    teamsRes.rows.map((t) => ({ teamId: t.id, name: t.name })),
    matchesRes.rows.map((m) => ({
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      homeScore: m.home_score,
      awayScore: m.away_score,
    })),
  );
}

/** True once every league-phase match has been played or written off (§4.6). */
export async function isLeaguePhaseComplete(): Promise<boolean> {
  const { rows } = await query<{ pending: string }>(
    `SELECT count(*)::text AS pending
     FROM matches m
     JOIN matchweeks mw ON mw.id = m.matchweek_id
     WHERE mw.act = 'league_phase' AND m.status NOT IN ('finished', 'cancelled')`,
  );
  const total = await query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM matches m JOIN matchweeks mw ON mw.id = m.matchweek_id
     WHERE mw.act = 'league_phase'`,
  );
  return Number(total.rows[0]!.total) > 0 && Number(rows[0]!.pending) === 0;
}
