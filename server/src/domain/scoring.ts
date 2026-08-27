/**
 * Pure club-layer match scoring (PLAN.md §4.2, §4.3).
 *
 * `scoreMatchDraft` treats a scoreline as if the match had ended now. The same
 * rules apply to a finished match and to a live provisional draft (§4.3). The
 * only difference elsewhere is whether the result gets stored.
 * This function has no DB or time dependency, so it is fully unit-testable.
 */

export type TierRules = Map<number, Map<string, number>>; // tierId -> ruleCode -> points

export interface ScoreableMatch {
  homeTeamId: string;
  awayTeamId: string;
  homeTierId: number;
  awayTierId: number;
  homeScore: number;
  awayScore: number;
}

export interface PointLine {
  teamId: string;
  ruleCode: string;
  points: number;
  metadata: Record<string, number | string>;
}

function ruleValue(rules: TierRules, tierId: number, code: string): number {
  return rules.get(tierId)?.get(code) ?? 0;
}

/** Lines for one side of a match, from that team's perspective. */
function sideLines(
  teamId: string,
  tierId: number,
  goalsFor: number,
  goalsAgainst: number,
  rules: TierRules,
): PointLine[] {
  const lines: PointLine[] = [];
  const outcome = goalsFor > goalsAgainst ? 'win' : goalsFor < goalsAgainst ? 'loss' : 'draw';

  // Outcome line (always recorded, even if 0, for a complete breakdown).
  lines.push({
    teamId,
    ruleCode: outcome,
    points: ruleValue(rules, tierId, outcome),
    metadata: { gf: goalsFor, ga: goalsAgainst },
  });

  // Goals scored (aggregated: per-goal value × goals). Emit only if it matters.
  if (goalsFor > 0) {
    const per = ruleValue(rules, tierId, 'goals_scored');
    if (per !== 0) {
      lines.push({ teamId, ruleCode: 'goals_scored', points: per * goalsFor, metadata: { goals: goalsFor } });
    }
  }

  // Goals conceded (typically negative).
  if (goalsAgainst > 0) {
    const per = ruleValue(rules, tierId, 'goals_conceded');
    if (per !== 0) {
      lines.push({ teamId, ruleCode: 'goals_conceded', points: per * goalsAgainst, metadata: { goals: goalsAgainst } });
    }
  }

  // Clean sheet (GA = 0). Shield (§3.6) may later treat GA = 1 as a clean sheet
  // too, but that is a participant-layer adjustment applied on top, not here.
  if (goalsAgainst === 0) {
    const cs = ruleValue(rules, tierId, 'clean_sheet');
    if (cs !== 0) {
      lines.push({ teamId, ruleCode: 'clean_sheet', points: cs, metadata: {} });
    }
  }

  return lines;
}

export function scoreMatchDraft(match: ScoreableMatch, rules: TierRules): PointLine[] {
  return [
    ...sideLines(match.homeTeamId, match.homeTierId, match.homeScore, match.awayScore, rules),
    ...sideLines(match.awayTeamId, match.awayTierId, match.awayScore, match.homeScore, rules),
  ];
}

/** Sum of a team's lines (helper for provisional/live totals). */
export function sumLinesForTeam(lines: PointLine[], teamId: string): number {
  return lines.filter((l) => l.teamId === teamId).reduce((acc, l) => acc + l.points, 0);
}
