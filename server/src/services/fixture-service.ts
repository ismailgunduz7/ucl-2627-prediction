import { query } from '../db/pool.ts';
import { scoreMatchDraft } from '../domain/scoring.ts';
import { outcomeOf, type Outcome } from '../domain/prediction.ts';
import { resolveLineup } from './lineup-service.ts';
import { getTierRules } from './rule-loader.ts';
import { getActiveJoker } from './joker-service.ts';
import { compareMatchweekMenu, legHeading, matchweekMenuEntry } from '../domain/matchweek-menu.ts';

/**
 * The matchweek seen as a fixture list (§18.5): every match of the week, the
 * participant's own clubs marked, and what each of those clubs has earned so
 * far. It all comes from our own tables, so participant traffic never reaches
 * the provider (§5.6).
 */

export interface FixtureSide {
  teamId: string;
  name: string;
  shortName: string;
  /** The club's badge, so a fixture row is scannable by crest (§18.5). */
  crestUrl: string | null;
  tierId: number;
  score: number | null;
  /** In the participant's effective squad for this week. */
  mine: boolean;
  /** On their bench, and therefore not scoring unless bench boost is live. */
  benched: boolean;
  captain: boolean;
  /** Whether what this club did in this match reaches the participant's score. */
  counts: boolean;
  /** Points from this match, or null when they do not count for the participant. */
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
  /** Null for a single-legged round or a league week; else İlk maçlar / Rövanş maçları. */
  legLabel: string | null;
  fixtures: Fixture[];
  /** ×3 while triple boost is live, so the captain badge tells the truth. */
  captainMultiplier: 2 | 3;
  /** Bench boost makes the benched club score like the rest (§3.6). */
  benchBoost: boolean;
}

/**
 * A whole round as one page: a league week is a single section, a two-legged
 * tie is two, the first legs and then the returns. Each leg keeps its own joker
 * context, because a leg is still its own matchweek (§2.4).
 */
export interface RoundFixtures {
  roundKey: string;
  roundLabel: string;
  sections: WeekFixtures[];
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
  home_crest: string | null;
  home_tier: number;
  away_team_id: string;
  away_name: string;
  away_short: string;
  away_crest: string | null;
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
  const [matchRes, lineup, points, rules, joker, legRow] = await Promise.all([
    query<MatchRow>(
      `SELECT m.id, m.kickoff_at, m.status, m.stage, m.home_score, m.away_score,
              m.home_team_id, ht.name AS home_name, ht.short_name AS home_short,
              ht.crest_url AS home_crest, ht.tier_id AS home_tier,
              m.away_team_id, at.name AS away_name, at.short_name AS away_short,
              at.crest_url AS away_crest, at.tier_id AS away_tier
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
    query<{ id: string; act: string; sort_order: number; label: string }>(
      'SELECT id, act, sort_order, label FROM matchweeks WHERE id = $1',
      [mwId],
    ),
  ]);
  const mw = legRow.rows[0];

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

    const benchBoost = joker?.code === 'bench_boost';
    const side = (which: 'home' | 'away'): FixtureSide => {
      const teamId = which === 'home' ? m.home_team_id : m.away_team_id;
      const squadClub = mine.get(teamId);
      const benched = squadClub !== undefined && teamId === lineup?.benchTeamId;
      // A benched club still earns club-layer points; they just do not reach
      // the participant, so the row does not offer them a number (§3.5).
      const counts = squadClub !== undefined && (!benched || benchBoost);
      return {
        teamId,
        name: which === 'home' ? m.home_name : m.away_name,
        shortName: which === 'home' ? m.home_short : m.away_short,
        crestUrl: which === 'home' ? m.home_crest : m.away_crest,
        tierId: which === 'home' ? m.home_tier : m.away_tier,
        score: which === 'home' ? m.home_score : m.away_score,
        mine: squadClub !== undefined,
        benched,
        captain: squadClub !== undefined && teamId === lineup?.captainTeamId,
        counts,
        points: !counts ? null : live ? draftFor(teamId) : (points.get(`${m.id}:${teamId}`) ?? null),
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
    legLabel: mw
      ? legHeading({ id: mw.id, act: mw.act, sortOrder: mw.sort_order, label: mw.label })
      : null,
    fixtures,
    captainMultiplier: joker?.code === 'triple_boost' ? 3 : 2,
    benchBoost: joker?.code === 'bench_boost',
  };
}

/** Every matchweek of a round, in the order the legs are played. */
export async function getRoundFixtures(userId: string, roundKey: string): Promise<RoundFixtures> {
  const { rows } = await query<{ id: string; act: string; sort_order: number; label: string }>(
    'SELECT id, act, sort_order, label FROM matchweeks',
  );
  const inRound = rows
    .map((mw) => ({
      mw,
      menu: matchweekMenuEntry({ id: mw.id, act: mw.act, sortOrder: mw.sort_order, label: mw.label }),
    }))
    .filter((r) => r.menu.roundKey === roundKey)
    .sort((a, b) => compareMatchweekMenu(a.menu, b.menu));

  if (inRound.length === 0) {
    return { roundKey, roundLabel: roundKey, sections: [], lastSyncAt: await lastSyncAt() };
  }

  const sections = await Promise.all(inRound.map((r) => getWeekFixtures(userId, r.mw.id)));
  const first = inRound[0]!;
  return {
    roundKey,
    // A single-week round is called what it is ("Final", "Hafta 8"); a tie
    // takes the round's own name with its legs as sections under it.
    roundLabel: inRound.length === 1 ? first.menu.option : first.menu.group,
    sections,
    lastSyncAt: await lastSyncAt(),
  };
}

async function lastSyncAt(): Promise<string | null> {
  const { rows } = await query<{ finished_at: Date }>(
    `SELECT finished_at FROM sync_runs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ? new Date(rows[0].finished_at).toISOString() : null;
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
