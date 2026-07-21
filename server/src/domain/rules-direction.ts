import type { RuleDirection } from '../data/scoring-rules.ts';

/**
 * Monotonic pot-strength check (PLAN.md §16). Values are indexed Pot 1..4.
 *
 * - reward / penalty: must be NON-DECREASING Pot 1 -> Pot 4. (Reward ascends so
 *   weaker pots earn more; penalty ascends from most-negative Pot 1 toward 0.)
 * - flat: must be equal across all pots.
 *
 * Returns null if the direction holds, or a human-readable warning otherwise.
 * This is a WARNING, not a hard rejection — admins may still save (§4.2).
 */
export function checkRuleDirection(
  direction: RuleDirection,
  potValues: number[],
): string | null {
  if (potValues.length !== 4) return 'Her rule için 4 pot değeri gerekli';

  if (direction === 'flat') {
    const allEqual = potValues.every((v) => v === potValues[0]);
    return allEqual ? null : 'Bu kural tüm potlarda eşit olmalı (flat)';
  }

  // reward and penalty: non-decreasing Pot 1 -> Pot 4.
  for (let i = 1; i < potValues.length; i++) {
    if (potValues[i]! < potValues[i - 1]!) {
      const label = direction === 'reward' ? 'ödül' : 'ceza';
      return `Pot yönü bozuk (${label}): değerler Pot 1 → Pot 4 azalmamalı`;
    }
  }
  return null;
}
