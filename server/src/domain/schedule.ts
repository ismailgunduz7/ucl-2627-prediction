/**
 * Mock league-phase fixture generator (circle / round-robin method).
 *
 * The real Swiss draw is complex; for the mockup we only need a valid schedule
 * where, across N matchdays, every club plays exactly once per matchday against
 * a distinct opponent. The circle method gives that for up to (teams-1) rounds.
 */

export interface FixturePairing {
  round: number; // 1-based matchday
  homeIndex: number; // index into the teams array
  awayIndex: number;
}

/**
 * @param teamCount even number of teams
 * @param rounds    how many matchdays to generate (must be < teamCount)
 */
export function generateLeagueSchedule(teamCount: number, rounds: number): FixturePairing[] {
  if (teamCount % 2 !== 0) throw new Error('teamCount must be even');
  if (rounds >= teamCount) throw new Error('rounds must be < teamCount');

  const fixtures: FixturePairing[] = [];
  const fixed = 0;
  const rotating = Array.from({ length: teamCount - 1 }, (_, i) => i + 1);

  for (let r = 0; r < rounds; r++) {
    // Rotate the non-fixed teams by r positions.
    const shift = r % rotating.length;
    const ring = [...rotating.slice(rotating.length - shift), ...rotating.slice(0, rotating.length - shift)];
    const lineup = [fixed, ...ring];

    for (let i = 0; i < teamCount / 2; i++) {
      const a = lineup[i]!;
      const b = lineup[teamCount - 1 - i]!;
      // Alternate home/away by round + slot so home counts stay roughly balanced.
      const homeFirst = (r + i) % 2 === 0;
      fixtures.push({
        round: r + 1,
        homeIndex: homeFirst ? a : b,
        awayIndex: homeFirst ? b : a,
      });
    }
  }
  return fixtures;
}
