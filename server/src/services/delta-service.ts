import { query } from '../db/pool.ts';
import { scoreMatchDraft } from '../domain/scoring.ts';
import { resolveLineup } from './lineup-service.ts';
import { getActiveJoker } from './joker-service.ts';
import { getTierRules } from './rule-loader.ts';
import { shieldDeltaForTarget } from './matchweek-scoring-service.ts';

/**
 * The live delta feed (§18.6): the week's point events for the participant's
 * SCORING clubs, one line per rule (`+3 galibiyet`, `-1 gol yedi`), with the
 * captain's multiplier as a line of its own. Finished matches contribute
 * definitive lines. Live matches contribute drafts marked provisional, scored
 * with the same rules (§4.3 Option A). It all comes from our own tables (§5.6).
 */

export interface DeltaEvent {
  ruleCode: string;
  label: string;
  points: number;
  /** From a match still in play, so the number can move until it finishes. */
  provisional: boolean;
}

export interface ClubDeltas {
  teamId: string;
  name: string;
  shortName: string;
  captain: boolean;
  events: DeltaEvent[];
}

export interface WeekDeltas {
  matchweekId: string;
  /** Any match of the week in play right now (the client polls while true). */
  live: boolean;
  clubs: ClubDeltas[];
}

interface EntryRow {
  team_id: string;
  rule_code: string;
  label: string;
  points: number;
}

interface LiveMatchRow {
  home_team_id: string;
  away_team_id: string;
  home_tier_id: number;
  away_tier_id: number;
  home_score: number | null;
  away_score: number | null;
}

export async function getWeekDeltas(userId: string, mwId: string): Promise<WeekDeltas> {
  const lineup = await resolveLineup(userId, mwId);
  const liveCountRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM matches WHERE matchweek_id = $1 AND status = 'live'`,
    [mwId],
  );
  const weekLive = (liveCountRes.rows[0]?.n ?? 0) > 0;
  if (!lineup) return { matchweekId: mwId, live: weekLive, clubs: [] };

  const joker = await getActiveJoker(userId, mwId);
  const benchBoost = joker?.code === 'bench_boost';
  const scoring = lineup.squad.filter((c) => benchBoost || c.teamId !== lineup.benchTeamId);
  const scoringIds = scoring.map((c) => c.teamId);

  // Definitive lines: finished matches plus any one-time bonus of the week.
  const entries = await query<EntryRow>(
    `SELECT e.team_id, e.rule_code, rt.label, e.points
     FROM team_point_entries e
     JOIN scoring_rule_types rt ON rt.code = e.rule_code
     WHERE e.matchweek_id = $1 AND e.team_id = ANY($2::uuid[])
     ORDER BY rt.sort_order, e.created_at`,
    [mwId, scoringIds],
  );

  const eventsByTeam = new Map<string, DeltaEvent[]>();
  const push = (teamId: string, e: DeltaEvent) => {
    const list = eventsByTeam.get(teamId) ?? [];
    list.push(e);
    eventsByTeam.set(teamId, list);
  };
  for (const r of entries.rows) {
    push(r.team_id, { ruleCode: r.rule_code, label: r.label, points: r.points, provisional: false });
  }

  // Live drafts, same rules as a finished match (§4.3).
  const liveMatches = await query<LiveMatchRow>(
    `SELECT m.home_team_id, m.away_team_id, ht.tier_id AS home_tier_id, at.tier_id AS away_tier_id,
            m.home_score, m.away_score
     FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
     WHERE m.matchweek_id = $1 AND m.status = 'live'
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       AND (m.home_team_id = ANY($2::uuid[]) OR m.away_team_id = ANY($2::uuid[]))`,
    [mwId, scoringIds],
  );
  const liveTeams = new Set<string>();
  if (liveMatches.rows.length > 0) {
    const rules = await getTierRules();
    const labels = await ruleLabels();
    const mine = new Set(scoringIds);
    for (const m of liveMatches.rows) {
      const lines = scoreMatchDraft(
        {
          homeTeamId: m.home_team_id,
          awayTeamId: m.away_team_id,
          homeTierId: m.home_tier_id,
          awayTierId: m.away_tier_id,
          homeScore: m.home_score!,
          awayScore: m.away_score!,
        },
        rules,
      );
      for (const side of [m.home_team_id, m.away_team_id]) if (mine.has(side)) liveTeams.add(side);
      for (const l of lines) {
        if (!mine.has(l.teamId)) continue;
        push(l.teamId, {
          ruleCode: l.ruleCode,
          label: labels.get(l.ruleCode) ?? l.ruleCode,
          points: l.points,
          provisional: true,
        });
      }
    }
  }

  // The shield's adjustment, shown where it lands (§3.6).
  if (joker?.code === 'clean_sheet_shield') {
    const targetId = String(joker.payload.teamId ?? '');
    if (targetId && scoringIds.includes(targetId)) {
      const delta = await shieldDeltaForTarget(mwId, targetId);
      if (delta !== 0) {
        push(targetId, {
          ruleCode: 'clean_sheet_shield',
          label: 'Gol yememe kalkanı',
          points: delta,
          provisional: liveTeams.has(targetId),
        });
      }
    }
  }

  // The captain's bonus as a line of its own: base x (multiplier - 1).
  const multiplier = joker?.code === 'triple_boost' ? 3 : 2;
  const captainEvents = eventsByTeam.get(lineup.captainTeamId);
  if (captainEvents && captainEvents.length > 0) {
    const base = captainEvents.reduce((acc, e) => acc + e.points, 0);
    const extra = base * (multiplier - 1);
    if (extra !== 0) {
      push(lineup.captainTeamId, {
        ruleCode: 'captain',
        label: `Kaptan ×${multiplier}`,
        points: extra,
        provisional: captainEvents.some((e) => e.provisional),
      });
    }
  }

  return {
    matchweekId: mwId,
    live: weekLive,
    clubs: scoring
      .filter((c) => (eventsByTeam.get(c.teamId)?.length ?? 0) > 0)
      .map((c) => ({
        teamId: c.teamId,
        name: c.name,
        shortName: c.shortName,
        captain: c.teamId === lineup.captainTeamId,
        events: eventsByTeam.get(c.teamId)!,
      })),
  };
}

async function ruleLabels(): Promise<Map<string, string>> {
  const { rows } = await query<{ code: string; label: string }>(
    'SELECT code, label FROM scoring_rule_types',
  );
  return new Map(rows.map((r) => [r.code, r.label]));
}
