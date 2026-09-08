/**
 * Late squad entry (§3.2).
 *
 * A participant who missed the selection lock can still build a squad once the
 * season is running. They start from the first matchweek that was still
 * unlocked when they committed it, and the weeks that ran before that one never
 * score for them. `entryMatchweekId` is that starting week, frozen at commit;
 * null means the participant was there from the beginning.
 */

/** Whether a matchweek scores for a participant who entered at `entryMatchweekId`. */
export function weekCountsForEntry(
  order: readonly string[],
  entryMatchweekId: string | null,
  matchweekId: string,
): boolean {
  if (entryMatchweekId === null) return true;
  const entry = order.indexOf(entryMatchweekId);
  const week = order.indexOf(matchweekId);
  // An entry week that is not in the order at all cannot be placed against the
  // week being scored, so nothing counts. Points a player did not play for are
  // the worse failure of the two.
  if (entry === -1 || week === -1) return false;
  return week >= entry;
}
