import { query } from '../db/pool.ts';
import { scoreMatchDraft } from '../domain/scoring.ts';
import { outcomeOf, type Outcome } from '../domain/prediction.ts';
import { resolveLineup } from './lineup-service.ts';
import { getTierRules } from './rule-loader.ts';
import { getActiveJoker } from './joker-service.ts';

/**
 * The matchweek seen as a fixture list (§18.5): every match of the week, the
 * participant's own clubs marked, and what each of those clubs has earned so
 * far. Read entirely from our own tables — participant traffic never reaches
 * the provider (§5.6).
 */

export interface FixtureSide {
  teamId: string;
  name: string;
  shortName: string;
  tierId: number;
  score: number | null;
  /** In the participant's effective squad for this week. */
  mine: boolean;
  /** On their bench, and therefore not scoring unless bench boost is live. */
  benched: boolean;
  captain: boolean;
  /** Club-layer points from this match; null when the club is not theirs. */
  points: number | null;
}

export interface Fixture {
  matchId: string;
  kickoffAt: string | null;
  status: string;
  stage: string;
  /** Definitive once finished, drafted while live, null before kickoff. */
  result: Outcome | null;
  /** The participant's call on this match, if they made one (§18.9). */
  pick: Outcome | null;
  home: FixtureSide;
  away: FixtureSide;
}

export interface WeekFixtures {
  matchweekId: string;
  fixtures: Fixture[];
  /** ×3 while triple boost is live, so the captain badge tells the truth. */
  captainMultiplier: 2 | 3;
  /** Bench boost makes the benched club score like the rest (§3.6). */
  benchBoost: boolean;
  /** When the provider was last read successfully, for a "son güncelleme" line. */
  lastSyncAt: string | null;
}

interface MatchRow {
  id: string;
  kickoff_at: Date | null;
  status: string;
  stage: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  home_name: string;
  home_short: string;
  home_tier: number;
  away_team_id: string;
  away_name: string;
  away_short: string;
  away_tier: number;
}

/** Definitive club points for this week, per (match, team). */
async function pointsByMatch(mwId: string): Promise<Map<string, number>> {
  const { rows } = await query<{ match_id: string; team_id: string; points: number }>(
    `SELECT match_id, team_id, sum(points)::int AS points
     FROM team_point_entries WHERE matchweek_id = $1 AND match_id IS NOT NULL
     GROUP BY match_id, team_id`,
    [mwId],
  );
  return new Map(rows.map((r) => [`${r.match_id}:${r.team_id}`, r.points]));
}

export async function getWeekFixtures(userId: string, mwId: string): Promise<WeekFixtures> {
  const [matchRes, lineup, points, rules, joker, lastSync] = await Promise.all([
    query<MatchRow>(
      `SELECT m.id, m.kickoff_at, m.status, m.stage, m.home_score, m.away_score,
              m.home_team_id, ht.name AS home_name, ht.short_name AS home_short, ht.tier_id AS home_tier,
              m.away_team_id, at.name AS away_name, at.short_name AS away_short, at.tier_id AS away_tier
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.matchweek_id = $1
       ORDER BY m.kickoff_at, ht.name`,
      [mwId],
    ),
    resolveLineup(userId, mwId),
    pointsByMatch(mwId),
    getTierRules(),
    getActiveJoker(userId, mwId),
    query<{ finished_at: Date }>(
      `SELECT finished_at FROM sync_runs WHERE status = 'success'
       ORDER BY created_at DESC LIMIT 1`,
    ),
  ]);

  const mine = new Map((lineup?.squad ?? []).map((s) => [s.teamId, s]));
  const picks = await picksOf(userId, matchRes.rows.map((m) => m.id));

  const fixtures = matchRes.rows.map((m): Fixture => {
    const live = m.status === 'live' && m.home_score !== null && m.away_score !== null;
    // A live match has no stored entries yet, so draft them the same way the
    // provisional week score does (§4.3 Option A).
    const draft = live
      ? scoreMatchDraft(
          {
            homeTeamId: m.home_team_id,
            awayTeamId: m.away_team_id,
            homeTierId: m.home_tier,
            awayTierId: m.away_tier,
            homeScore: m.home_score!,
            awayScore: m.away_score!,
          },
          rules,
        )
      : [];
    const draftFor = (teamId: string) =>
      draft.filter((l) => l.teamId === teamId).reduce((acc, l) => acc + l.points, 0);

    const side = (which: 'home' | 'away'): FixtureSide => {
      const teamId = which === 'home' ? m.home_team_id : m.away_team_id;
      const squadClub = mine.get(teamId);
      return {
        teamId,
        name: which === 'home' ? m.home_name : m.away_name,
        shortName: which === 'home' ? m.home_short : m.away_short,
        tierId: which === 'home' ? m.home_tier : m.away_tier,
        score: which === 'home' ? m.home_score : m.away_score,
        mine: squadClub !== undefined,
        benched: squadClub !== undefined && teamId === lineup?.benchTeamId,
        captain: squadClub !== undefined && teamId === lineup?.captainTeamId,
        points: squadClub === undefined
          ? null
          : live
            ? draftFor(teamId)
            : (points.get(`${m.id}:${teamId}`) ?? null),
      };
    };

    return {
      matchId: m.id,
      kickoffAt: m.kickoff_at ? new Date(m.kickoff_at).toISOString() : null,
      status: m.status,
      stage: m.stage,
      result:
        m.status === 'finished' || m.status === 'live'
          ? outcomeOf(m.home_score, m.away_score)
          : null,
      pick: picks.get(m.id) ?? null,
      home: side('home'),
      away: side('away'),
    };
  });

  return {
    matchweekId: mwId,
    fixtures,
    captainMultiplier: joker?.code === 'triple_boost' ? 3 : 2,
    benchBoost: joker?.code === 'bench_boost',
    lastSyncAt: lastSync.rows[0] ? new Date(lastSync.rows[0].finished_at).toISOString() : null,
  };
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
