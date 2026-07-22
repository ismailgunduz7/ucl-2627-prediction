import { query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { defaultLineup, validateLineup, type SquadClub } from '../domain/lineup.ts';
import {
  getOrderedMatchweeks,
  lineupEditability,
  type Editability,
} from './matchweek-lifecycle-service.ts';

export interface EffectiveClub {
  teamId: string;
  tierId: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  eliminated: boolean;
}

/**
 * The user's effective squad for a matchweek. Phase 4 = the permanent four.
 * Phase 5 will substitute a weekly_swap replacement here.
 */
export async function getEffectiveSquad(userId: string): Promise<EffectiveClub[]> {
  const { rows } = await query<{
    team_id: string;
    tier_id: number;
    name: string;
    short_name: string;
    crest_url: string | null;
    eliminated_at: Date | null;
  }>(
    `SELECT ts.team_id, ts.tier_id, t.name, t.short_name, t.crest_url, t.eliminated_at
     FROM team_selections ts JOIN teams t ON t.id = ts.team_id
     WHERE ts.user_id = $1 ORDER BY ts.tier_id`,
    [userId],
  );
  return rows.map((r) => ({
    teamId: r.team_id,
    tierId: r.tier_id,
    name: r.name,
    shortName: r.short_name,
    crestUrl: r.crest_url,
    eliminated: r.eliminated_at !== null,
  }));
}

interface StoredLineup {
  bench_team_id: string;
  captain_team_id: string;
}

async function getStoredLineup(userId: string, mwId: string): Promise<StoredLineup | null> {
  const { rows } = await query<StoredLineup>(
    `SELECT bench_team_id, captain_team_id FROM matchweek_lineups
     WHERE user_id = $1 AND matchweek_id = $2`,
    [userId, mwId],
  );
  return rows[0] ?? null;
}

/** The predecessor matchweek's lineup, used to carry bench/captain forward (§3.5). */
async function getPreviousLineup(
  userId: string,
  mwId: string,
  ordered: { id: string }[],
): Promise<StoredLineup | null> {
  const idx = ordered.findIndex((m) => m.id === mwId);
  if (idx <= 0) return null;
  return getStoredLineup(userId, ordered[idx - 1]!.id);
}

export interface ResolvedLineupCore {
  squad: EffectiveClub[];
  benchTeamId: string;
  captainTeamId: string;
  saved: boolean;
}

/**
 * Resolve bench/captain for a matchweek WITHOUT editability (used by scoring):
 * stored row if present, else the §3.5 default (carry previous week, else
 * pot-layout fallback). Returns null if the user has no permanent squad.
 */
export async function resolveLineup(
  userId: string,
  mwId: string,
): Promise<ResolvedLineupCore | null> {
  const squad = await getEffectiveSquad(userId);
  if (squad.length === 0) return null;

  const stored = await getStoredLineup(userId, mwId);
  if (stored) {
    return {
      squad,
      benchTeamId: stored.bench_team_id,
      captainTeamId: stored.captain_team_id,
      saved: true,
    };
  }

  const ordered = await getOrderedMatchweeks();
  const previous = await getPreviousLineup(userId, mwId, ordered);
  const squadClubs: SquadClub[] = squad.map((s) => ({ teamId: s.teamId, tierId: s.tierId }));
  const def = defaultLineup(
    squadClubs,
    previous ? { benchTeamId: previous.bench_team_id, captainTeamId: previous.captain_team_id } : null,
  );
  return { squad, ...def, saved: false };
}

export interface ResolvedLineup extends ResolvedLineupCore {
  editability: Editability;
}

/** Resolve the lineup for display, including editability (§3.4). */
export async function getLineup(userId: string, mwId: string): Promise<ResolvedLineup | null> {
  const core = await resolveLineup(userId, mwId);
  if (!core) return null;
  const ordered = await getOrderedMatchweeks();
  const editability = lineupEditability(ordered, mwId);
  return { ...core, editability };
}

/** Persist a lineup for a matchweek (§3.5). Enforces lock + validation server-side. */
export async function setLineup(
  userId: string,
  mwId: string,
  benchTeamId: string,
  captainTeamId: string,
): Promise<ResolvedLineup> {
  const squad = await getEffectiveSquad(userId);
  if (squad.length === 0) throw ApiError.badRequest('Önce kalıcı kadro seçilmeli', 'no_squad');

  const ordered = await getOrderedMatchweeks();
  const editability = lineupEditability(ordered, mwId);
  if (!editability.opened) {
    throw ApiError.forbidden('Bu hafta henüz düzenlemeye açılmadı', 'matchweek_not_open');
  }
  if (editability.locked) {
    throw ApiError.forbidden('Bu hafta kilitlendi', 'matchweek_locked');
  }

  const squadClubs: SquadClub[] = squad.map((s) => ({ teamId: s.teamId, tierId: s.tierId }));
  const validation = validateLineup(squadClubs, benchTeamId, captainTeamId);
  if (!validation.ok) {
    throw ApiError.badRequest(validation.error.message, validation.error.code);
  }

  await query(
    `INSERT INTO matchweek_lineups (user_id, matchweek_id, bench_team_id, captain_team_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, matchweek_id)
     DO UPDATE SET bench_team_id = EXCLUDED.bench_team_id,
                   captain_team_id = EXCLUDED.captain_team_id,
                   updated_at = now()`,
    [userId, mwId, benchTeamId, captainTeamId],
  );

  return { squad, benchTeamId, captainTeamId, saved: true, editability };
}
