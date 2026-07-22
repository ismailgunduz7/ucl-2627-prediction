import { query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { getParticipantWeekScore } from './matchweek-scoring-service.ts';

export interface RuleEntry {
  ruleCode: string;
  ruleLabel: string;
  points: number;
}

/** One fixture the club plays that matchweek (may be unplayed). */
export interface ClubFixture {
  opponentName: string;
  home: boolean;
  status: string;
  teamScore: number | null;
  opponentScore: number | null;
}

export interface ClubBreakdown {
  teamId: string;
  name: string;
  shortName: string;
  basePoints: number;
  benched: boolean;
  captain: boolean;
  multiplier: number;
  contributed: number;
  fixtures: ClubFixture[];
  entries: RuleEntry[];
}

export interface WeekBreakdown {
  matchweekId: string;
  label: string;
  status: string;
  final: boolean;
  total: number;
  jokerCode: string | null;
  clubs: ClubBreakdown[];
}

export interface PlayerPoints {
  player: { id: string; displayName: string; totalPoints: number };
  weeks: WeekBreakdown[];
}

/**
 * Full season breakdown for one participant: every matchweek, the clubs that
 * scored, and the individual rule lines behind each club's points.
 *
 * Visibility follows the competition scope — you can only open players from
 * your own competition, and admins are not participants.
 */
export async function getPlayerPoints(
  playerId: string,
  viewerCompetitionId: string | null,
): Promise<PlayerPoints> {
  const userRes = await query<{ id: string; display_name: string; competition_id: string | null; is_admin: boolean }>(
    'SELECT id, display_name, competition_id, is_admin FROM users WHERE id = $1',
    [playerId],
  );
  const user = userRes.rows[0];
  if (!user || user.is_admin) throw ApiError.badRequest('Oyuncu bulunamadı', 'player_not_found');
  if (!viewerCompetitionId || user.competition_id !== viewerCompetitionId) {
    throw ApiError.forbidden('Bu oyuncuyu görüntüleyemezsin', 'different_competition');
  }

  const mwRes = await query<{ id: string; label: string; status: string }>(
    `SELECT id, label, status FROM matchweeks
     ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END, sort_order`,
  );

  // Score each matchweek first; the club list per week depends on that week's
  // effective squad (a weekly swap changes it).
  const scored = [];
  for (const mw of mwRes.rows) {
    const score = await getParticipantWeekScore(playerId, mw.id);
    if (score) scored.push({ mw, score });
  }

  // Fetch every rule line for the weeks/teams involved in one go.
  const mwIds = scored.map((s) => s.mw.id);
  const teamIds = [...new Set(scored.flatMap((s) => s.score.lines.map((l) => l.teamId)))];
  const hasScope = mwIds.length > 0 && teamIds.length > 0;

  const entryRows = hasScope
    ? (
        await query<{
          matchweek_id: string;
          team_id: string;
          rule_code: string;
          rule_label: string;
          points: number;
        }>(
          `SELECT e.matchweek_id, e.team_id, e.rule_code, rt.label AS rule_label, e.points
           FROM team_point_entries e
           JOIN scoring_rule_types rt ON rt.code = e.rule_code
           WHERE e.matchweek_id = ANY($1::text[]) AND e.team_id = ANY($2::uuid[])
           ORDER BY rt.sort_order`,
          [mwIds, teamIds],
        )
      ).rows
    : [];

  const entriesByKey = new Map<string, RuleEntry[]>();
  for (const r of entryRows) {
    const key = `${r.matchweek_id}|${r.team_id}`;
    const list = entriesByKey.get(key) ?? [];
    list.push({ ruleCode: r.rule_code, ruleLabel: r.rule_label, points: r.points });
    entriesByKey.set(key, list);
  }

  // Fixtures for the same weeks, including ones not played yet, so future weeks
  // still show who the club is up against.
  const fixtureRows = hasScope
    ? (
        await query<{
          matchweek_id: string;
          status: string;
          home_team_id: string;
          away_team_id: string;
          home_name: string;
          away_name: string;
          home_score: number | null;
          away_score: number | null;
        }>(
          `SELECT m.matchweek_id, m.status, m.home_team_id, m.away_team_id,
                  ht.name AS home_name, at.name AS away_name, m.home_score, m.away_score
           FROM matches m
           JOIN teams ht ON ht.id = m.home_team_id
           JOIN teams at ON at.id = m.away_team_id
           WHERE m.matchweek_id = ANY($1::text[])
             AND (m.home_team_id = ANY($2::uuid[]) OR m.away_team_id = ANY($2::uuid[]))
           ORDER BY m.kickoff_at`,
          [mwIds, teamIds],
        )
      ).rows
    : [];

  const teamSet = new Set(teamIds);
  const fixturesByKey = new Map<string, ClubFixture[]>();
  for (const r of fixtureRows) {
    for (const side of ['home', 'away'] as const) {
      const teamId = side === 'home' ? r.home_team_id : r.away_team_id;
      if (!teamSet.has(teamId)) continue;
      const key = `${r.matchweek_id}|${teamId}`;
      const list = fixturesByKey.get(key) ?? [];
      list.push({
        opponentName: side === 'home' ? r.away_name : r.home_name,
        home: side === 'home',
        status: r.status,
        teamScore: side === 'home' ? r.home_score : r.away_score,
        opponentScore: side === 'home' ? r.away_score : r.home_score,
      });
      fixturesByKey.set(key, list);
    }
  }

  const weeks: WeekBreakdown[] = scored.map(({ mw, score }) => ({
    matchweekId: mw.id,
    label: mw.label,
    status: mw.status,
    final: score.final,
    total: score.total,
    jokerCode: score.jokerCode ?? null,
    clubs: score.lines.map((l) => ({
      teamId: l.teamId,
      name: l.name,
      shortName: l.shortName,
      basePoints: l.basePoints,
      benched: l.benched,
      captain: l.captain,
      multiplier: l.multiplier,
      contributed: l.contributed,
      fixtures: fixturesByKey.get(`${mw.id}|${l.teamId}`) ?? [],
      entries: entriesByKey.get(`${mw.id}|${l.teamId}`) ?? [],
    })),
  }));

  const totalPoints = weeks.reduce((acc, w) => acc + w.total, 0);
  return {
    player: { id: user.id, displayName: user.display_name, totalPoints },
    weeks,
  };
}
