import { query } from '../db/pool.ts';

/** Admin-editable config knobs (§8.1). Fixed domain constants live in code (§3.9). */
export interface JokerInventoryDefaults {
  weekly_swap: number;
  triple_boost: number;
  clean_sheet_shield: number;
  bench_boost: number;
}

export const DEFAULT_CONFIG = {
  current_act: 'league_phase' as 'league_phase' | 'knockout',
  scoring_flags: { knockout_time_basis: 'aet' as 'aet' | 'ninety' },
  joker_inventory_defaults: {
    league_phase: { weekly_swap: 2, triple_boost: 1, clean_sheet_shield: 2, bench_boost: 1 },
    knockout: { weekly_swap: 2, triple_boost: 1, clean_sheet_shield: 2, bench_boost: 1 },
  } as Record<'league_phase' | 'knockout', JokerInventoryDefaults>,
  deadline_drama_window_seconds: 7200,
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

export async function setConfigValue(key: ConfigKey, value: unknown): Promise<void> {
  await query(
    `INSERT INTO tournament_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
