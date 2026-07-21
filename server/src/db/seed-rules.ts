/**
 * Idempotent seed for scoring rule types + per-pot values.
 *
 * Safe to run anytime: inserts rule types if missing and per-pot values if
 * missing (never overwrites admin-edited values). Runs standalone
 * (`npm run seed:rules`) and is also invoked from the domain seed.
 */
import { RULE_TYPE_SEEDS } from '../data/scoring-rules.ts';
import { closePool, getPool } from './pool.ts';

// Minimal shape shared by pg.Pool and pg.PoolClient.
interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export async function seedScoringRules(db: Queryable): Promise<void> {
  for (const rt of RULE_TYPE_SEEDS) {
    await db.query(
      `INSERT INTO scoring_rule_types (code, category, label, direction, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [rt.code, rt.category, rt.label, rt.direction, rt.sortOrder],
    );
    for (let pot = 1; pot <= 4; pot++) {
      await db.query(
        `INSERT INTO tier_scoring_rules (tier_id, rule_code, points)
         VALUES ($1, $2, $3)
         ON CONFLICT (tier_id, rule_code) DO NOTHING`,
        [pot, rt.code, rt.pots[pot - 1]],
      );
    }
  }
}

// Standalone runner.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedScoringRules(getPool())
    .then(() => console.log(`✓ Seeded ${RULE_TYPE_SEEDS.length} rule types + per-pot values.`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => void closePool());
}
