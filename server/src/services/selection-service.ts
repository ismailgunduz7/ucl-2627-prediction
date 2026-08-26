import { withTransaction, query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { validateSquadSelection, type SelectableTeam } from '../domain/squad.ts';
import { getSelectionLockState } from './matchweek-lifecycle-service.ts';
import { cancel as cancelJoker, findSquadEditConflicts } from './joker-service.ts';

export interface SquadEntry {
  teamId: string;
  tierId: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  eliminatedAt: Date | null;
}

/** The user's current permanent squad (0 rows if not yet selected). */
export async function getSquad(userId: string): Promise<SquadEntry[]> {
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
    eliminatedAt: r.eliminated_at,
  }));
}

/**
 * Replace the user's permanent squad. Enforced server-side (§3.2, validation
 * "not only in the UI"): selection lock, one club per pot, no duplicates, active
 * clubs, tier resolved from the DB (never client input).
 *
 * An edit that removes a club carrying an active joker (§3.6, §11.25) is
 * rejected with 409 so the client can confirm; re-sent with `cancelJokers`,
 * the joker is cancelled and refunded before the squad is rewritten.
 */
export async function setSquad(
  userId: string,
  selectedTeamIds: string[],
  cancelJokers = false,
): Promise<SquadEntry[]> {
  const lock = await getSelectionLockState();
  if (lock.locked) {
    throw ApiError.forbidden('Kadro seçim süresi doldu', 'selection_locked');
  }

  const oldSquad = await getSquad(userId);
  const keep = new Set(selectedTeamIds);
  const removed = oldSquad.map((s) => s.teamId).filter((id) => !keep.has(id));
  const conflicts = await findSquadEditConflicts(userId, removed);
  if (conflicts.length > 0) {
    if (!cancelJokers) {
      throw new ApiError(
        409,
        'joker_squad_conflict',
        'Çıkardığın kulüpte aktif joker var; değişiklik jokeri iptal eder ve hakkını iade eder',
        { conflicts },
      );
    }
    for (const conflict of conflicts) await cancelJoker(userId, conflict.matchweekId);
  }

  await withTransaction(async (client) => {
    // Load candidate teams (lock rows lightly via the read; the unique
    // constraints are the real backstop against races).
    const { rows } = await client.query<{
      id: string;
      tier_id: number;
      is_active: boolean;
      eliminated_at: Date | null;
    }>(`SELECT id, tier_id, is_active, eliminated_at FROM teams WHERE id = ANY($1::uuid[])`, [
      selectedTeamIds,
    ]);
    const teams: SelectableTeam[] = rows.map((r) => ({
      id: r.id,
      tierId: r.tier_id,
      isActive: r.is_active,
      eliminatedAt: r.eliminated_at,
    }));

    const validation = validateSquadSelection(teams, selectedTeamIds);
    if (!validation.ok) {
      throw ApiError.badRequest(validation.error.message, validation.error.code, validation.error);
    }

    // Replace all four rows atomically. tier_id comes from the resolved map,
    // never from client input; the composite FK + unique indexes are the guard.
    await client.query('DELETE FROM team_selections WHERE user_id = $1', [userId]);
    for (const teamId of selectedTeamIds) {
      await client.query(
        `INSERT INTO team_selections (user_id, team_id, tier_id) VALUES ($1, $2, $3)`,
        [userId, teamId, validation.tierByTeam.get(teamId)],
      );
    }
  });

  // Read back after commit so the caller sees the persisted squad.
  return getSquad(userId);
}
