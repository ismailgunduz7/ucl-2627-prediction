import type { SquadClub } from './lineup.ts';

export type JokerCode = 'weekly_swap' | 'triple_boost' | 'clean_sheet_shield' | 'bench_boost';

export interface WeeklySwap {
  fromTeamId: string;
  toTeamId: string;
  toTierId: number;
}

/**
 * Apply a weekly_swap to the effective squad (§3.6): replace the permanent club
 * `fromTeamId` with `toTeamId` (same pot). The incoming club takes the outgoing
 * club's slot; role inheritance (bench/captain) is handled by `remapRole`.
 */
export function applyWeeklySwap(squad: SquadClub[], swap: WeeklySwap): SquadClub[] {
  return squad.map((c) =>
    c.teamId === swap.fromTeamId ? { teamId: swap.toTeamId, tierId: swap.toTierId } : c,
  );
}

/** If a role was on the swapped-out club, it moves to the incoming club (§3.6). */
export function remapRole(teamId: string, swap: WeeklySwap | null): string {
  if (swap && teamId === swap.fromTeamId) return swap.toTeamId;
  return teamId;
}

/**
 * Clean-sheet shield delta for one participant on the target club (§3.6):
 *
 * | GA | Effect                                                        |
 * |----|---------------------------------------------------------------|
 * | 0  | Normal CS already in the club layer → no delta.               |
 * | 1  | Count as CS (+cs) AND suppress that 1 conceded (−conceded).    |
 * | ≥2 | Shield breaks → no delta.                                     |
 *
 * `concededPerGoal` is the (usually negative) per-goal value; suppressing it
 * adds `−concededPerGoal`. Applied per match the club played this matchweek.
 */
export function computeShieldDelta(
  matchesGoalsAgainst: number[],
  cleanSheetValue: number,
  concededPerGoal: number,
): number {
  let delta = 0;
  for (const ga of matchesGoalsAgainst) {
    if (ga === 1) delta += cleanSheetValue - concededPerGoal;
  }
  return delta;
}
