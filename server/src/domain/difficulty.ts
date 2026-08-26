/**
 * How hard a fixture looks for one of our clubs (matchweek briefing, §18.1).
 *
 * What matters is the gap between the two sides, not the opponent on its own:
 * a Pot 1 club hosting a Pot 3 club is having an easy week, while the very same
 * fixture is a hard one for the visitors. Pots run 1 (strongest) to 4, so the
 * difference between the two pots is the gap, and a trip away costs a little
 * more than one seed of that gap.
 */

export type DifficultyBand = 'kolay' | 'orta' | 'zor';

/** Ascending, so two fixtures can be compared for the harder one. */
export const DIFFICULTY_ORDER: DifficultyBand[] = ['kolay', 'orta', 'zor'];

const AWAY_PENALTY = 1.5;

export function difficultyFor(ownTier: number, opponentTier: number, isAway: boolean): DifficultyBand {
  const score = ownTier - opponentTier + (isAway ? AWAY_PENALTY : 0);
  if (score >= 2.5) return 'zor';
  if (score >= 0) return 'orta';
  return 'kolay';
}

/** The harder of two bands, so a club playing twice is judged on its worst. */
export function harderBand(a: DifficultyBand | null, b: DifficultyBand): DifficultyBand {
  if (a === null) return b;
  return DIFFICULTY_ORDER.indexOf(b) > DIFFICULTY_ORDER.indexOf(a) ? b : a;
}
