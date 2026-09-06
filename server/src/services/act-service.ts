import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { outcomeForRank } from '../domain/standings.ts';
import { getLeagueStandings, isLeaguePhaseComplete } from './standings-service.ts';
import { getConfigValue, setConfigValue } from './tournament-config-service.ts';
import {
  createPlayoffRound,
  ensureKnockoutMatchweeks,
  firstKnockoutMatchweekId,
  settleKnockoutTies,
} from './knockout-service.ts';
import { finalizeCompletedMatchweeks } from './matchweek-scoring-service.ts';
import { getActiveJokerRaw, getPermanentSquad, type EffectiveClub } from './lineup-service.ts';
import { cancel as cancelJoker, findSquadEditConflicts } from './joker-service.ts';
import { lineupEditability, getOrderedMatchweeks } from './matchweek-lifecycle-service.ts';

/**
 * League → knockout transition (§3.7). Runs once, automatically, when every
 * league-phase match is settled:
 *
 *   1. freeze the final table on the clubs
 *   2. eliminate everyone below the play-off cut
 *   3. award the one-time top-8 bonus, attributed to the first play-off week
 *   4. refresh every participant's jokers to the Act II grant
 *   5. open the optional one-club act transfer
 *   6. build the play-off bracket
 */
export async function completeLeaguePhaseIfDue(): Promise<{ ran: boolean }> {
  const act = await getConfigValue('current_act');
  if (act !== 'league_phase') return { ran: false };
  if (!(await isLeaguePhaseComplete())) return { ran: false };

  const standings = await getLeagueStandings();
  await ensureKnockoutMatchweeks();
  const koMatchweekId = await firstKnockoutMatchweekId();

  await withTransaction(async (client) => {
    // 1 + 2. Freeze ranks and eliminate the clubs that go no further.
    for (const row of standings) {
      const outcome = outcomeForRank(row.rank);
      await client.query(
        `UPDATE teams SET league_rank = $1,
                eliminated_at = CASE WHEN $2 THEN now() ELSE eliminated_at END
         WHERE id = $3`,
        [row.rank, outcome === 'eliminated', row.teamId],
      );
    }

    // 3. One-time top-8 bonus, per pot, on the first play-off matchweek.
    if (koMatchweekId) {
      await awardLeagueTop8Bonus(client, standings.slice(0, 8).map((r) => r.teamId), koMatchweekId);
    }

    // 4. Jokers reset to the Act II grant.
    await refreshJokerInventory(client);

    // 5. Open the act transfer for every participant holding a squad.
    await client.query(
      `INSERT INTO act_transfers (user_id, status)
       SELECT ts.user_id, 'available'
       FROM team_selections ts
       JOIN users u ON u.id = ts.user_id AND NOT u.is_admin
       GROUP BY ts.user_id
       ON CONFLICT (user_id) DO NOTHING`,
    );
  });

  await setConfigValue('current_act', 'knockout');

  // 6. Seed the play-off ties from ranks 9-24.
  await createPlayoffRound(standings);

  return { ran: true };
}

async function awardLeagueTop8Bonus(
  client: PoolClient,
  teamIds: string[],
  matchweekId: string,
): Promise<void> {
  for (const teamId of teamIds) {
    // The bonus value is per pot, like every other reward rule.
    const { rows } = await client.query<{ points: number }>(
      `SELECT r.points FROM tier_scoring_rules r
       JOIN teams t ON t.tier_id = r.tier_id
       WHERE t.id = $1 AND r.rule_code = 'league_top8_bonus'`,
      [teamId],
    );
    const points = rows[0]?.points ?? 0;
    if (!points) continue;
    await client.query(
      `INSERT INTO team_point_entries (team_id, match_id, matchweek_id, rule_code, points, source_key, metadata)
       VALUES ($1, NULL, $2, 'league_top8_bonus', $3, $4, '{}'::jsonb)
       ON CONFLICT (source_key) DO UPDATE SET points = EXCLUDED.points`,
      [teamId, matchweekId, points, `bonus:league_top8:${teamId}`],
    );
  }
}

/** Replace every participant's remaining jokers with the Act II grant (§3.7). */
async function refreshJokerInventory(client: PoolClient): Promise<void> {
  const defaults = await getConfigValue('joker_inventory_defaults');
  const act2 = defaults.knockout;
  const entries: [string, number][] = [
    ['weekly_swap', act2.weekly_swap],
    ['triple_boost', act2.triple_boost],
    ['clean_sheet_shield', act2.clean_sheet_shield],
    ['bench_boost', act2.bench_boost],
  ];
  for (const [code, count] of entries) {
    await client.query(
      `INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
       SELECT u.id, $1, $2 FROM users u WHERE NOT u.is_admin
       ON CONFLICT (user_id, joker_type_code)
       DO UPDATE SET remaining_count = EXCLUDED.remaining_count, updated_at = now()`,
      [code, count],
    );
  }
}

// --- Act transfer (§3.7 steps 4-8) ----------------------------------------

export interface ActTransferState {
  status: 'available' | 'committed' | 'expired' | 'unavailable';
  fromTeamId: string | null;
  toTeamId: string | null;
  locked: boolean;
  /** Same-pot clubs the user could still move to, per squad club. */
  options: { fromTeamId: string; fromName: string; candidates: { id: string; name: string }[] }[];
}

interface TransferRow {
  status: 'available' | 'committed' | 'expired';
  from_team_id: string | null;
  to_team_id: string | null;
}

async function getTransferRow(userId: string): Promise<TransferRow | null> {
  const { rows } = await query<TransferRow>(
    'SELECT status, from_team_id, to_team_id FROM act_transfers WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * The squad as it stood BEFORE the committed transfer. The transfer is always
 * expressed against this squad: its options, its outgoing club, and any
 * re-apply. That way updating a committed transfer swaps the original club back
 * out instead of chasing the club that replaced it.
 */
async function getOriginalSquad(userId: string, row: TransferRow | null): Promise<EffectiveClub[]> {
  const squad = await getPermanentSquad(userId);
  if (row?.status !== 'committed' || !row.from_team_id || !row.to_team_id) return squad;
  const { rows } = await query<{
    name: string;
    short_name: string;
    crest_url: string | null;
    eliminated_at: Date | null;
  }>('SELECT name, short_name, crest_url, eliminated_at FROM teams WHERE id = $1', [
    row.from_team_id,
  ]);
  const original = rows[0];
  if (!original) return squad;
  return squad.map((c) =>
    c.teamId === row.to_team_id
      ? {
          teamId: row.from_team_id!,
          tierId: c.tierId,
          name: original.name,
          shortName: original.short_name,
          crestUrl: original.crest_url,
          eliminated: original.eliminated_at !== null,
        }
      : c,
  );
}

export async function getActTransfer(userId: string): Promise<ActTransferState> {
  const row = await getTransferRow(userId);
  if (!row) {
    return { status: 'unavailable', fromTeamId: null, toTeamId: null, locked: false, options: [] };
  }

  const locked = await isTransferWindowLocked();
  const options = locked || row.status === 'expired' ? [] : await buildOptions(userId, row);
  return {
    status: row.status,
    fromTeamId: row.from_team_id,
    toTeamId: row.to_team_id,
    locked,
    options,
  };
}

/**
 * Same-pot, still-alive alternatives per ORIGINAL squad club. The committed
 * destination club stays eligible in its own pot, since it is what is currently
 * selected.
 */
async function buildOptions(userId: string, row: TransferRow | null): Promise<ActTransferState['options']> {
  const squad = await getOriginalSquad(userId, row);
  const out: ActTransferState['options'] = [];
  for (const club of squad) {
    const { rows } = await query<{ id: string; name: string }>(
      `SELECT id, name FROM teams
       WHERE tier_id = $1 AND is_active AND eliminated_at IS NULL AND id <> ALL($2::uuid[])
       ORDER BY name`,
      [club.tierId, squad.map((c) => c.teamId)],
    );
    out.push({ fromTeamId: club.teamId, fromName: club.name, candidates: rows });
  }
  return out;
}

/** The window closes with the first knockout matchweek's lineup lock. */
async function isTransferWindowLocked(): Promise<boolean> {
  const mwId = await firstKnockoutMatchweekId();
  if (!mwId) return false;
  const ordered = await getOrderedMatchweeks();
  return lineupEditability(ordered, mwId).locked;
}

/**
 * Apply (or re-apply) the act transfer. Same pot, destination alive, and the
 * permanent squad is rewritten immediately so the change is visible at once.
 */
export async function setActTransfer(
  userId: string,
  fromTeamId: string,
  toTeamId: string,
  cancelJokers = false,
): Promise<ActTransferState> {
  const current = await getTransferRow(userId);
  if (!current) throw ApiError.badRequest('no_transfer_grant');
  if (current.status === 'expired') {
    throw ApiError.forbidden('transfer_expired');
  }
  if (await isTransferWindowLocked()) {
    throw ApiError.forbidden('transfer_locked');
  }

  // A live weekly swap for the first knockout week blocks squad edits (§3.6).
  const koId = await firstKnockoutMatchweekId();
  if (koId) {
    const joker = await getActiveJokerRaw(userId, koId);
    if (joker?.code === 'weekly_swap') {
      throw ApiError.badRequest('weekly_swap_active');
    }
  }

  // Validate against the ORIGINAL squad: a committed transfer's destination may
  // stand in for the club it replaced, but the record always names the original.
  const original = await getOriginalSquad(userId, current);
  const effectiveFrom =
    current.status === 'committed' && current.from_team_id && current.to_team_id === fromTeamId
      ? current.from_team_id
      : fromTeamId;
  const from = original.find((c) => c.teamId === effectiveFrom);
  if (!from) throw ApiError.badRequest('invalid_from');
  if (original.some((c) => c.teamId === toTeamId)) {
    throw ApiError.badRequest('to_in_squad');
  }

  const to = await query<{ tier_id: number; is_active: boolean; eliminated_at: Date | null }>(
    'SELECT tier_id, is_active, eliminated_at FROM teams WHERE id = $1',
    [toTeamId],
  );
  const toRow = to.rows[0];
  if (!toRow) throw ApiError.badRequest('invalid_to');
  if (toRow.tier_id !== from.tierId) throw ApiError.badRequest('wrong_pot');
  if (!toRow.is_active || toRow.eliminated_at) {
    throw ApiError.badRequest('to_ineligible');
  }

  // A club leaving the effective squad may carry an active joker, a shield for
  // instance (§3.6, §11.25). Ask first, then cancel it with a refund once the
  // user confirms. An active weekly swap was already rejected above.
  const currentSquad = await getPermanentSquad(userId);
  const nextIds = new Set(original.map((c) => c.teamId).filter((id) => id !== effectiveFrom));
  nextIds.add(toTeamId);
  const removed = currentSquad.map((c) => c.teamId).filter((id) => !nextIds.has(id));
  const conflicts = await findSquadEditConflicts(userId, removed);
  if (conflicts.length > 0) {
    if (!cancelJokers) {
      throw new ApiError(409, 'joker_squad_conflict', undefined, { conflicts });
    }
    for (const conflict of conflicts) await cancelJoker(userId, conflict.matchweekId);
  }

  await withTransaction(async (client) => {
    // Re-applying replaces the previous change: restore the original club
    // first, then move the newly chosen one out of the restored squad.
    const prev = await client.query<{ from_team_id: string | null; to_team_id: string | null }>(
      'SELECT from_team_id, to_team_id FROM act_transfers WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    const prevRow = prev.rows[0];
    if (prevRow?.from_team_id && prevRow.to_team_id) {
      await client.query(
        `UPDATE team_selections SET team_id = $1, updated_at = now()
         WHERE user_id = $2 AND team_id = $3`,
        [prevRow.from_team_id, userId, prevRow.to_team_id],
      );
    }

    const applied = await client.query(
      `UPDATE team_selections SET team_id = $1, updated_at = now()
       WHERE user_id = $2 AND team_id = $3`,
      [toTeamId, userId, effectiveFrom],
    );
    if (applied.rowCount === 0) {
      // The squad moved between validation and the write (e.g. two tabs).
      throw ApiError.badRequest('transfer_conflict');
    }
    await client.query(
      `UPDATE act_transfers SET status = 'committed', from_team_id = $1, to_team_id = $2
       WHERE user_id = $3`,
      [effectiveFrom, toTeamId, userId],
    );
  });

  return getActTransfer(userId);
}

/** At the lock instant an untouched grant expires; a committed one freezes. */
export async function lockActTransfersIfDue(): Promise<void> {
  if (!(await isTransferWindowLocked())) return;
  await query(
    `UPDATE act_transfers
     SET status = CASE WHEN status = 'available' THEN 'expired' ELSE status END,
         locked_at = COALESCE(locked_at, now())
     WHERE locked_at IS NULL`,
  );
}


/**
 * Advance whatever the latest results allow, in order: close the league act,
 * settle any finished knockout ties, expire the transfer window, then write
 * final participant scores so they include the bonuses just awarded.
 *
 * Safe to call after every sync or manual result edit; each step is a no-op
 * when its trigger has not been met.
 */
export async function progressSeason(): Promise<void> {
  await completeLeaguePhaseIfDue();
  await settleKnockoutTies();
  await lockActTransfersIfDue();
  await finalizeCompletedMatchweeks();
}
