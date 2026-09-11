import { scoreMatchDraft, type PointLine, type TierRules } from '@domain/scoring.ts';
import { computeShieldDelta } from '@domain/joker.ts';

/**
 * The what-if calculator behind the fixtures page (PLAN.md §18.10).
 *
 * It does not reimplement scoring. `scoreMatchDraft` and `computeShieldDelta`
 * are the server's own domain modules, imported through the `@domain` alias, so
 * a scoreline typed here is put through exactly the arithmetic the season is
 * scored with. If the two ever disagree it is a bug in one shared function
 * rather than a difference between two copies of it.
 */

/** A row of the rules matrix as `/api/scoring-rules` sends it. */
export interface RuleRow {
  code: string;
  /** Already in the reader's language: the API derives it, we do not. */
  label: string;
  points: Record<number, number>;
}

/** The rules matrix in the shape the scoring domain reads. */
export function tierRulesFrom(rows: RuleRow[], pots: number[]): TierRules {
  const rules: TierRules = new Map();
  for (const pot of pots) {
    const forPot = new Map<string, number>();
    for (const row of rows) forPot.set(row.code, row.points[pot] ?? 0);
    rules.set(pot, forPot);
  }
  return rules;
}

/** What each rule is called, so the working can be read back in words. */
export function ruleLabelsFrom(rows: RuleRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.code, row.label]));
}

/** One club's haul from one scoreline, before and after the week's extras. */
export interface SideOutcome {
  /** Club-layer points for the scoreline, the figure the club itself earns. */
  base: number;
  /** What the shield is worth here: 0 when it is off, or when it breaks. */
  shieldDelta: number;
  /** 1, or 2 as captain, or 3 under triple captain. */
  multiplier: number;
  /** What reaches the player: (base + shield) x multiplier. */
  total: number;
  /** The club-layer lines behind `base`, for showing the working. */
  lines: PointLine[];
}

export interface SideInput {
  teamId: string;
  tierId: number;
  goalsFor: number;
  goalsAgainst: number;
  /** 1 unless this club holds the captaincy this week. */
  multiplier: number;
  shielded: boolean;
}

/**
 * What a scoreline is worth to each side. Both sides go through one
 * `scoreMatchDraft` call, because a match is scored as a match: the two sides
 * are read from the same result.
 */
export function calcFixture(
  home: SideInput,
  away: SideInput,
  rules: TierRules,
): { home: SideOutcome; away: SideOutcome } {
  const lines = scoreMatchDraft(
    {
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeTierId: home.tierId,
      awayTierId: away.tierId,
      homeScore: home.goalsFor,
      awayScore: away.goalsFor,
    },
    rules,
  );
  return { home: outcomeFor(home, lines, rules), away: outcomeFor(away, lines, rules) };
}

function outcomeFor(side: SideInput, lines: PointLine[], rules: TierRules): SideOutcome {
  const own = lines.filter((l) => l.teamId === side.teamId);
  const base = own.reduce((acc, l) => acc + l.points, 0);
  const forPot = rules.get(side.tierId);
  const shieldDelta = side.shielded
    ? computeShieldDelta(
        [side.goalsAgainst],
        forPot?.get('clean_sheet') ?? 0,
        forPot?.get('goals_conceded') ?? 0,
      )
    : 0;
  return {
    base,
    shieldDelta,
    multiplier: side.multiplier,
    total: (base + shieldDelta) * side.multiplier,
    lines: own,
  };
}
