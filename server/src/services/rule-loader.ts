import { query } from '../db/pool.ts';
import type { TierRules } from '../domain/scoring.ts';

/** Load per-pot scoring rule values into a TierRules map (read path). */
export async function getTierRules(): Promise<TierRules> {
  const { rows } = await query<{ tier_id: number; rule_code: string; points: number }>(
    'SELECT tier_id, rule_code, points FROM tier_scoring_rules',
  );
  const map: TierRules = new Map();
  for (const r of rows) {
    if (!map.has(r.tier_id)) map.set(r.tier_id, new Map());
    map.get(r.tier_id)!.set(r.rule_code, r.points);
  }
  return map;
}
