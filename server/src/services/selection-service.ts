import { withTransaction, query } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { validateSquadSelection, type SelectableTeam } from '../domain/squad.ts';
import { weekCountsForEntry } from '../domain/entry.ts';
import {
  firstUnlockedMatchweek,
  getOrderedMatchweeks,
  getSelectionLockState,
} from './matchweek-lifecycle-service.ts';
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

/** The matchweek a participant's season starts at; null means the very first (§3.2). */
export async function getEntryMatchweekId(userId: string): Promise<string | null> {
  const { rows } = await query<{ entry_matchweek_id: string | null }>(
    'SELECT entry_matchweek_id FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.entry_matchweek_id ?? null;
}

/**
 * Whether a participant's season had started by matchweek `mwId` (§3.2). False
 * only for a late entrant looking at a week they sat out: it scores nothing for
 * them and their bench and captain for it were never real.
 */
export async function participantScoresIn(userId: string, mwId: string): Promise<boolean> {
  const entry = await getEntryMatchweekId(userId);
  if (!entry) return true;
  const order = (await getOrderedMatchweeks()).map((m) => m.id);
  return weekCountsForEntry(order, entry, mwId);
}

/**
 * Where a participant who never picked a squad would join from, once the
 * selection lock has passed (§3.2): the first matchweek still unlocked. Null
 * when every week is frozen and there is nothing left to join.
 */
export async function getLateEntryMatchweekId(now: Date = new Date()): Promise<string | null> {
  const ordered = await getOrderedMatchweeks();
  return firstUnlockedMatchweek(ordered, now)?.id ?? null;
}

/**
 * Replace the user's permanent squad. Enforced server-side (§3.2, validation
 * "not only in the UI"): selection lock, one club per pot, no duplicates, active
 * clubs, tier resolved from the DB (never client input).
 *
 * After the selection lock the squad is permanent, so an edit is refused. A
 * participant who never picked one is the exception: they build it late and
 * their season starts at the first matchweek still unlocked, which is frozen on
 * the account so the weeks they sat out never score for them.
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
  const oldSquad = await getSquad(userId);

  let entryMatchweekId: string | null = null;
  if (lock.locked) {
    if (oldSquad.length > 0) throw ApiError.forbidden('selection_locked');
    entryMatchweekId = await getLateEntryMatchweekId();
    if (!entryMatchweekId) throw ApiError.forbidden('no_open_matchweek');
  }

  const keep = new Set(selectedTeamIds);
  const removed = oldSquad.map((s) => s.teamId).filter((id) => !keep.has(id));
  const conflicts = await findSquadEditConflicts(userId, removed);
  if (conflicts.length > 0) {
    if (!cancelJokers) {
      throw new ApiError(409, 'joker_squad_conflict', undefined, { conflicts });
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
      throw ApiError.badRequest(validation.error.code, validation.error.params, validation.error);
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

    // A late entrant's season starts here. Written in the same transaction as
    // the squad, so a squad can never exist without the week it starts from.
    if (entryMatchweekId) {
      await client.query('UPDATE users SET entry_matchweek_id = $1 WHERE id = $2', [
        entryMatchweekId,
        userId,
      ]);
    }
  });

  // Read back after commit so the caller sees the persisted squad.
  return getSquad(userId);
}
