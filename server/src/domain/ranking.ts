/**
 * Standard competition ranking, the "1224" shape (PLAN.md §4.8).
 *
 * Everyone level on points shares a rank, and the next distinct total skips the
 * places the tie consumed. A tie-break decides which order tied rows are shown
 * in, but it never splits the rank itself. The leaderboard and the weekly rank
 * delta both go through here so a player cannot be told they are 3rd on one
 * page and 4th on another.
 */
export function rankOf(total: number, totals: Iterable<number>): number {
  let ahead = 0;
  for (const other of totals) {
    if (other > total) ahead++;
  }
  return ahead + 1;
}
