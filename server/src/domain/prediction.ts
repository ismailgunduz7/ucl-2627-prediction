/**
 * Ahtapot Paul: one 1X2 call per match of the matchweek (§18.9).
 *
 * Picks are written from the home side's point of view, the way the fixture
 * itself is written, so the pick survives any later reshuffle of the fixture
 * list. Every correct call is worth the same, admin-configurable points.
 */

export type Outcome = 'home' | 'draw' | 'away';

export const OUTCOMES: Outcome[] = ['home', 'draw', 'away'];

export function isOutcome(value: string): value is Outcome {
  return (OUTCOMES as string[]).includes(value);
}

/** The result of a match as an outcome, or null while it has no score yet. */
export function outcomeOf(homeScore: number | null, awayScore: number | null): Outcome | null {
  if (homeScore === null || awayScore === null) return null;
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

export interface PredictionTally {
  /** Matches with both a pick and a result so far. */
  settled: number;
  correct: number;
  points: number;
}

/**
 * Points from the picks that already have a result. Matches without a result
 * are simply not counted yet, which is what makes a live week's tally rise as
 * results come in (§4.3 Option A).
 */
export function tallyPredictions(
  picks: Map<string, Outcome>,
  results: Map<string, Outcome | null>,
  pointsPerCorrect: number,
): PredictionTally {
  let settled = 0;
  let correct = 0;
  for (const [matchId, pick] of picks) {
    const result = results.get(matchId);
    if (!result) continue;
    settled++;
    if (result === pick) correct++;
  }
  return { settled, correct, points: correct * pointsPerCorrect };
}
