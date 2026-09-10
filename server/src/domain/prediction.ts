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
  /**
   * How many of those settled picks sit on a match that is still being played.
   * A live match is counted on its current score, the same way club points are
   * drafted (§4.3 Option A), so a late equaliser can take these back. Anything
   * showing this tally has to say so.
   */
  provisional: number;
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
  liveMatchIds: ReadonlySet<string> = new Set(),
): PredictionTally {
  let settled = 0;
  let correct = 0;
  let provisional = 0;
  for (const [matchId, pick] of picks) {
    const result = results.get(matchId);
    if (!result) continue;
    settled++;
    if (result === pick) correct++;
    if (liveMatchIds.has(matchId)) provisional++;
  }
  return { settled, correct, points: correct * pointsPerCorrect, provisional };
}

/** A tally read back from a stored breakdown, which may predate a field. */
export function normalizeTally(stored: Partial<PredictionTally> | null | undefined): PredictionTally {
  return {
    settled: stored?.settled ?? 0,
    correct: stored?.correct ?? 0,
    points: stored?.points ?? 0,
    provisional: stored?.provisional ?? 0,
  };
}

/** One line of a coupon on its way in. A `null` pick takes a call back. */
export interface CouponEntry {
  matchId: string;
  pick: Outcome | null;
}

/**
 * The coupon as it will be written. A coupon is saved whole, so the same match
 * can arrive twice from a client that queued two taps; the last word wins. A
 * line whose pick is `null` stays in the list rather than being dropped,
 * because clearing a call is a save like any other.
 */
export function normalizeCoupon(entries: CouponEntry[]): CouponEntry[] {
  const byMatch = new Map<string, Outcome | null>();
  for (const entry of entries) byMatch.set(entry.matchId, entry.pick);
  return [...byMatch].map(([matchId, pick]) => ({ matchId, pick }));
}
