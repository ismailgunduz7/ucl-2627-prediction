import { query } from '../db/pool.ts';

export interface TeamRow {
  id: string;
  name: string;
  short_name: string;
  tier_id: number;
  crest_url: string | null;
  country: string | null;
  is_active: boolean;
  eliminated_at: Date | null;
}

export interface TierRow {
  id: number;
  name: string;
  sort_order: number;
}

export async function listTiers(): Promise<TierRow[]> {
  const { rows } = await query<TierRow>(
    'SELECT id, name, sort_order FROM tiers ORDER BY sort_order',
  );
  return rows;
}

export async function listTeams(): Promise<TeamRow[]> {
  const { rows } = await query<TeamRow>(
    `SELECT id, name, short_name, tier_id, crest_url, country, is_active, eliminated_at
     FROM teams ORDER BY tier_id, name`,
  );
  return rows;
}

/** Teams grouped by pot, for the squad picker and rules pages. */
export async function listTeamsByPot(): Promise<
  { tier: TierRow; teams: TeamRow[] }[]
> {
  const [tiers, teams] = await Promise.all([listTiers(), listTeams()]);
  return tiers.map((tier) => ({
    tier,
    teams: teams.filter((t) => t.tier_id === tier.id),
  }));
}
