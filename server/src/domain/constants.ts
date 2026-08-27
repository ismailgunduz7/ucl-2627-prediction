/**
 * Domain constants & invariants (PLAN.md §3.9).
 *
 * These are STRUCTURAL rules of the game, not admin config. They must never be
 * surfaced as editable settings, and the invariants below are asserted at
 * startup and in tests.
 */

export const SQUAD_SIZE = 4 as const;
export const POT_COUNT = 4 as const;
export const ACTIVE_CLUBS_PER_WEEK = 3 as const; // SQUAD_SIZE - 1 (bench_boost overrides to 4 for that week)
export const LINEUP_LOCK_OFFSET_SECONDS = 300 as const; // lock is always T0(M) - 5 minutes

/**
 * Validates the structural invariants from §3.9. Throws on violation.
 * Call once at startup and assert in unit tests.
 */
export function assertDomainInvariants(): void {
  const failures: string[] = [];

  // 1. ACTIVE_CLUBS_PER_WEEK == SQUAD_SIZE - 1
  if (ACTIVE_CLUBS_PER_WEEK !== SQUAD_SIZE - 1) {
    failures.push(
      `ACTIVE_CLUBS_PER_WEEK (${ACTIVE_CLUBS_PER_WEEK}) must equal SQUAD_SIZE - 1 (${SQUAD_SIZE - 1})`,
    );
  }

  // 2. SQUAD_SIZE == POT_COUNT (exactly one club per pot)
  if (SQUAD_SIZE !== POT_COUNT) {
    failures.push(`SQUAD_SIZE (${SQUAD_SIZE}) must equal POT_COUNT (${POT_COUNT})`);
  }

  // 3. LINEUP_LOCK_OFFSET_SECONDS > 0 (lock instant strictly before T0)
  if (LINEUP_LOCK_OFFSET_SECONDS <= 0) {
    failures.push(`LINEUP_LOCK_OFFSET_SECONDS (${LINEUP_LOCK_OFFSET_SECONDS}) must be > 0`);
  }

  if (failures.length > 0) {
    throw new Error(`Domain invariant violation(s):\n  - ${failures.join('\n  - ')}`);
  }
}

/**
 * The authoritative lock instant for a matchweek whose earliest kickoff is
 * `firstKickoffAt`. Always T0(M) - LINEUP_LOCK_OFFSET_SECONDS; never stored as a
 * frozen deadline (§3.4); always derived from the current first_kickoff_at.
 */
export function lockInstantFor(firstKickoffAt: Date): Date {
  return new Date(firstKickoffAt.getTime() - LINEUP_LOCK_OFFSET_SECONDS * 1000);
}
