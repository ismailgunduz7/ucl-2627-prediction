/**
 * Reading a knockout bracket out of a provider's fixture list (§2.4, §5.2).
 *
 * The provider publishes fixtures, not ties: two separate matches between the
 * same pair in the same round, with no marker saying they belong together. The
 * tie is what our scoring needs, because a knockout is settled on aggregate
 * across both legs, so it has to be recovered from the fixtures themselves.
 *
 * Two fixtures in one round between one pair of clubs are one tie, ordered by
 * kickoff. A round the provider gives a single fixture for is a one-legged tie,
 * which is how the final arrives.
 */

export interface DrawFixture {
  externalId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffAt: Date;
  stage: string;
}

export interface DrawLeg {
  fixture: DrawFixture;
  /** 1-based, in kickoff order. */
  leg: number;
}

export interface DrawTie {
  stage: string;
  /**
   * The pair, oriented the way our tie rows are: `teamA` hosts the deciding
   * leg, which is the second one in a two-legged round.
   */
  teamA: string;
  teamB: string;
  legs: DrawLeg[];
}

/** A stable key for an unordered pair of clubs. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Group knockout fixtures into ties, earliest tie first so that slot numbers
 * assigned from this order stay stable as later rounds are published.
 */
export function groupKnockoutFixtures(fixtures: DrawFixture[]): DrawTie[] {
  const groups = new Map<string, DrawFixture[]>();
  for (const fixture of fixtures) {
    const key = `${fixture.stage}::${pairKey(fixture.homeTeamId, fixture.awayTeamId)}`;
    groups.set(key, [...(groups.get(key) ?? []), fixture]);
  }

  const ties: DrawTie[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime() || a.externalId.localeCompare(b.externalId),
    );
    const deciding = ordered[ordered.length - 1]!;
    ties.push({
      stage: deciding.stage,
      teamA: deciding.homeTeamId,
      teamB: deciding.awayTeamId,
      legs: ordered.map((fixture, i) => ({ fixture, leg: i + 1 })),
    });
  }

  return ties.sort(
    (a, b) =>
      a.legs[0]!.fixture.kickoffAt.getTime() - b.legs[0]!.fixture.kickoffAt.getTime() ||
      a.legs[0]!.fixture.externalId.localeCompare(b.legs[0]!.fixture.externalId),
  );
}
