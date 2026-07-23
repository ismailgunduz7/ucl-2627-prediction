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
import { getActiveJokerRaw, getPermanentSquad } from './lineup-service.ts';
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

  // 6. Seed the play-off ties from ranks 9–24.
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

// --- Act transfer (§3.7 steps 4–8) ----------------------------------------

export interface ActTransferState {
  status: 'available' | 'committed' | 'expired' | 'unavailable';
  fromTeamId: string | null;
  toTeamId: string | null;
  locked: boolean;
  /** Same-pot clubs the user could still move to, per squad club. */
  options: { fromTeamId: string; fromName: string; candidates: { id: string; name: string }[] }[];
}

export async function getActTransfer(userId: string): Promise<ActTransferState> {
  const { rows } = await query<{
    status: 'available' | 'committed' | 'expired';
    from_team_id: string | null;
    to_team_id: string | null;
    locked_at: Date | null;
  }>('SELECT status, from_team_id, to_team_id, locked_at FROM act_transfers WHERE user_id = $1', [
    userId,
  ]);
  const row = rows[0];
  if (!row) {
    return { status: 'unavailable', fromTeamId: null, toTeamId: null, locked: false, options: [] };
  }

  const locked = await isTransferWindowLocked();
  const options = locked || row.status === 'expired' ? [] : await buildOptions(userId);
  return {
    status: row.status,
    fromTeamId: row.from_team_id,
    toTeamId: row.to_team_id,
    locked,
    options,
  };
}

/** Same-pot, still-alive alternatives for each club in the permanent squad. */
async function buildOptions(userId: string): Promise<ActTransferState['options']> {
  const squad = await getPermanentSquad(userId);
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
): Promise<ActTransferState> {
  const current = await query<{ status: string }>(
    'SELECT status FROM act_transfers WHERE user_id = $1',
    [userId],
  );
  if (!current.rows[0]) throw ApiError.badRequest('Transfer hakkın yok', 'no_transfer_grant');
  if (current.rows[0].status === 'expired') {
    throw ApiError.forbidden('Transfer penceresi kapandı', 'transfer_expired');
  }
  if (await isTransferWindowLocked()) {
    throw ApiError.forbidden('Transfer penceresi kapandı', 'transfer_locked');
  }

  // A live weekly swap for the first knockout week blocks squad edits (§3.6).
  const koId = await firstKnockoutMatchweekId();
  if (koId) {
    const joker = await getActiveJokerRaw(userId, koId);
    if (joker?.code === 'weekly_swap') {
      throw ApiError.badRequest(
        'Önce bu haftanın değişim jokerini iptal et',
        'weekly_swap_active',
      );
    }
  }

  const squad = await getPermanentSquad(userId);
  const from = squad.find((c) => c.teamId === fromTeamId);
  if (!from) throw ApiError.badRequest('Çıkacak kulüp kadroda değil', 'invalid_from');
  if (squad.some((c) => c.teamId === toTeamId)) {
    throw ApiError.badRequest('Bu kulüp zaten kadronda', 'to_in_squad');
  }

  const to = await query<{ tier_id: number; is_active: boolean; eliminated_at: Date | null }>(
    'SELECT tier_id, is_active, eliminated_at FROM teams WHERE id = $1',
    [toTeamId],
  );
  const toRow = to.rows[0];
  if (!toRow) throw ApiError.badRequest('Geçersiz kulüp', 'invalid_to');
  if (toRow.tier_id !== from.tierId) throw ApiError.badRequest('Aynı pottan olmalı', 'wrong_pot');
  if (!toRow.is_active || toRow.eliminated_at) {
    throw ApiError.badRequest('Elenmiş kulüp seçilemez', 'to_ineligible');
  }

  await withTransaction(async (client) => {
    // Re-applying replaces the previous change, so restore the original club
    // first and then move the newly chosen one.
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

    await client.query(
      `UPDATE team_selections SET team_id = $1, updated_at = now()
       WHERE user_id = $2 AND team_id = $3`,
      [toTeamId, userId, fromTeamId],
    );
    await client.query(
      `UPDATE act_transfers SET status = 'committed', from_team_id = $1, to_team_id = $2
       WHERE user_id = $3`,
      [fromTeamId, toTeamId, userId],
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
