import type { RuleDirection } from '../data/scoring-rules.ts';

/**
 * Monotonic pot-strength check (PLAN.md §16). Values are indexed Pot 1..4.
 *
 * - reward / penalty: must be NON-DECREASING Pot 1 -> Pot 4. (Reward ascends so
 *   weaker pots earn more; penalty ascends from most-negative Pot 1 toward 0.)
 * - flat: must be equal across all pots.
 *
 * Returns null if the direction holds, or the catalogue key of a warning
 * otherwise. This is a warning, not a rejection. The admin can still save
 * (§4.2).
 */
export function checkRuleDirection(
  direction: RuleDirection,
  potValues: number[],
): string | null {
  if (potValues.length !== 4) return 'rule_warning.pot_count';

  if (direction === 'flat') {
    const allEqual = potValues.every((v) => v === potValues[0]);
    return allEqual ? null : 'rule_warning.not_flat';
  }

  // reward and penalty: non-decreasing Pot 1 -> Pot 4.
  for (let i = 1; i < potValues.length; i++) {
    if (potValues[i]! < potValues[i - 1]!) {
      return direction === 'reward' ? 'rule_warning.reward_order' : 'rule_warning.penalty_order';
    }
  }
  return null;
}
