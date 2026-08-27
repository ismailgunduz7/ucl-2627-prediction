import { query, withTransaction } from '../db/pool.ts';

/** Admin-editable config knobs (§8.1). Fixed domain constants live in code (§3.9). */
export interface JokerInventoryDefaults {
  weekly_swap: number;
  triple_boost: number;
  clean_sheet_shield: number;
  bench_boost: number;
}

export const DEFAULT_CONFIG = {
  current_act: 'league_phase' as 'league_phase' | 'knockout',
  joker_inventory_defaults: {
    league_phase: { weekly_swap: 2, triple_boost: 1, clean_sheet_shield: 2, bench_boost: 1 },
    knockout: { weekly_swap: 2, triple_boost: 1, clean_sheet_shield: 2, bench_boost: 1 },
  } as Record<'league_phase' | 'knockout', JokerInventoryDefaults>,
  deadline_drama_window_seconds: 7200,
  /** Ahtapot Paul: points for each correct 1X2 call (§18.9). */
  prediction_points_per_correct: 3,
  feature_flags: {} as Record<string, boolean>,
  sync_provider: 'mock' as 'mock' | 'football_data',
};

export type ConfigKey = keyof typeof DEFAULT_CONFIG;

/** Returns all config, falling back to defaults for any unset key. */
export async function getAllConfig(): Promise<typeof DEFAULT_CONFIG> {
  const { rows } = await query<{ key: string; value: unknown }>(
    'SELECT key, value FROM tournament_config',
  );
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (stored.has(key)) result[key] = stored.get(key);
  }
  return result as typeof DEFAULT_CONFIG;
}

export async function getConfigValue<K extends ConfigKey>(key: K): Promise<(typeof DEFAULT_CONFIG)[K]> {
  const { rows } = await query<{ value: unknown }>(
    'SELECT value FROM tournament_config WHERE key = $1',
    [key],
  );
  return (rows[0]?.value as (typeof DEFAULT_CONFIG)[K]) ?? DEFAULT_CONFIG[key];
}

const UPSERT_CONFIG = `INSERT INTO tournament_config (key, value) VALUES ($1, $2)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

export async function setConfigValue(key: ConfigKey, value: unknown): Promise<void> {
  await query(UPSERT_CONFIG, [key, JSON.stringify(value)]);
}

/**
 * Write several knobs at once, all or nothing. A settings form is one decision
 * by the admin, so a failure partway through must not leave half of it applied
 * under a message saying nothing was saved.
 */
export async function setConfigValues(
  entries: { key: ConfigKey; value: unknown }[],
): Promise<void> {
  await withTransaction(async (client) => {
    for (const { key, value } of entries) {
      await client.query(UPSERT_CONFIG, [key, JSON.stringify(value)]);
    }
  });
}
