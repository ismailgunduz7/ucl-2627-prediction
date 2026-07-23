import { createHash } from 'node:crypto';

/**
 * Knockout tie resolution (PLAN.md §2.4). Ties are decided on aggregate across
 * the legs. There is no away-goals rule; a level aggregate goes to a shootout,
 * which the mock settles deterministically from the tie id so replays and
 * recalculations always reach the same winner.
 */

export interface TieLeg {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface TieResult {
  winnerTeamId: string;
  loserTeamId: string;
  aggregateFor: number;
  aggregateAgainst: number;
  /** True when the aggregate was level and a shootout decided it. */
  onPenalties: boolean;
}

/** Goals a club scored and conceded across the legs of a tie. */
export function aggregateFor(legs: TieLeg[], teamId: string): { scored: number; conceded: number } {
  let scored = 0;
  let conceded = 0;
  for (const leg of legs) {
    if (leg.homeTeamId === teamId) {
      scored += leg.homeScore;
      conceded += leg.awayScore;
    } else if (leg.awayTeamId === teamId) {
      scored += leg.awayScore;
      conceded += leg.homeScore;
    }
  }
  return { scored, conceded };
}

export function resolveTie(
  legs: TieLeg[],
  teamAId: string,
  teamBId: string,
  tieId: string,
): TieResult {
  const a = aggregateFor(legs, teamAId);
  const b = aggregateFor(legs, teamBId);

  if (a.scored !== b.scored) {
    const aWins = a.scored > b.scored;
    return {
      winnerTeamId: aWins ? teamAId : teamBId,
      loserTeamId: aWins ? teamBId : teamAId,
      aggregateFor: aWins ? a.scored : b.scored,
      aggregateAgainst: aWins ? b.scored : a.scored,
      onPenalties: false,
    };
  }

  // Level on aggregate — a shootout, seeded so it never changes on a re-run.
  const coin = createHash('sha256').update(tieId).digest()[0]! % 2 === 0;
  return {
    winnerTeamId: coin ? teamAId : teamBId,
    loserTeamId: coin ? teamBId : teamAId,
    aggregateFor: a.scored,
    aggregateAgainst: b.scored,
    onPenalties: true,
  };
}

/** Standard bracket pairing: best seed against worst (9v24, 10v23, …). */
export function pairSeeds<T>(seeds: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < seeds.length / 2; i++) {
    pairs.push([seeds[i]!, seeds[seeds.length - 1 - i]!]);
  }
  return pairs;
}
