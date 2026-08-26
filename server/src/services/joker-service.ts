import { query, withTransaction } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import type { JokerCode } from '../domain/joker.ts';
import {
  getOrderedMatchweeks,
  lineupEditability,
} from './matchweek-lifecycle-service.ts';
import { getPermanentSquad, resolveLineup } from './lineup-service.ts';
import { getConfigValue } from './tournament-config-service.ts';

export interface InventoryItem {
  code: JokerCode;
  name: string;
  remaining: number;
}

export interface ActiveJoker {
  code: JokerCode;
  payload: Record<string, unknown>;
}

export async function getInventory(userId: string): Promise<InventoryItem[]> {
  const { rows } = await query<{ code: JokerCode; name: string; remaining: number }>(
    `SELECT jt.code, jt.name, COALESCE(ji.remaining_count, 0) AS remaining
     FROM joker_types jt
     LEFT JOIN joker_inventory ji ON ji.joker_type_code = jt.code AND ji.user_id = $1
     ORDER BY jt.sort_order`,
    [userId],
  );
  return rows;
}

export async function getActiveJoker(userId: string, mwId: string): Promise<ActiveJoker | null> {
  const { rows } = await query<{ joker_type_code: JokerCode; payload: Record<string, unknown> }>(
    `SELECT joker_type_code, payload FROM joker_activations
     WHERE user_id = $1 AND matchweek_id = $2 AND cancelled_at IS NULL`,
    [userId, mwId],
  );
  return rows[0] ? { code: rows[0].joker_type_code, payload: rows[0].payload } : null;
}

/** Seed a new participant's inventory from the Act I defaults (§3.6). */
export async function grantInitialInventory(userId: string): Promise<void> {
  const defaults = await getConfigValue('joker_inventory_defaults');
  const act1 = defaults.league_phase;
  const entries: [JokerCode, number][] = [
    ['weekly_swap', act1.weekly_swap],
    ['triple_boost', act1.triple_boost],
    ['clean_sheet_shield', act1.clean_sheet_shield],
    ['bench_boost', act1.bench_boost],
  ];
  for (const [code, count] of entries) {
    await query(
      `INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, joker_type_code) DO NOTHING`,
      [userId, code, count],
    );
  }
}

async function assertEditable(mwId: string): Promise<void> {
  const ordered = await getOrderedMatchweeks();
  const e = lineupEditability(ordered, mwId);
  if (!e.opened) throw ApiError.forbidden('Bu hafta henüz açılmadı', 'matchweek_not_open');
  if (e.locked) throw ApiError.forbidden('Bu hafta kilitlendi', 'matchweek_locked');
}

/** Validate the payload for a joker code, returning the normalized payload. */
async function validatePayload(
  userId: string,
  mwId: string,
  code: JokerCode,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (code === 'triple_boost' || code === 'bench_boost') return {};

  if (code === 'weekly_swap') {
    const fromTeamId = String(payload.fromTeamId ?? '');
    const toTeamId = String(payload.toTeamId ?? '');
    if (!fromTeamId || !toTeamId) throw ApiError.badRequest('Değişim kulüpleri gerekli', 'invalid_payload');
    const permanent = await getPermanentSquad(userId);
    const fromClub = permanent.find((c) => c.teamId === fromTeamId);
    if (!fromClub) throw ApiError.badRequest('Çıkacak kulüp kadroda değil', 'invalid_from');
    if (permanent.some((c) => c.teamId === toTeamId)) {
      throw ApiError.badRequest('Zaten kadroda olan kulüp seçilemez', 'to_in_squad');
    }
    const to = await query<{ tier_id: number; is_active: boolean; eliminated_at: Date | null }>(
      'SELECT tier_id, is_active, eliminated_at FROM teams WHERE id = $1',
      [toTeamId],
    );
    const toRow = to.rows[0];
    if (!toRow) throw ApiError.badRequest('Geçersiz kulüp', 'invalid_to');
    if (toRow.tier_id !== fromClub.tierId) throw ApiError.badRequest('Aynı pottan olmalı', 'wrong_pot');
    if (!toRow.is_active || toRow.eliminated_at) {
      throw ApiError.badRequest('Bu kulüp seçilemez (elenmiş/pasif)', 'to_ineligible');
    }
    return { fromTeamId, toTeamId };
  }

  // clean_sheet_shield: target must be a scoring (non-bench) club in the squad.
  const teamId = String(payload.teamId ?? '');
  if (!teamId) throw ApiError.badRequest('Hedef kulüp gerekli', 'invalid_payload');
  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) throw ApiError.badRequest('Önce kadro seçilmeli', 'no_squad');
  if (!lineup.squad.some((c) => c.teamId === teamId)) {
    throw ApiError.badRequest('Hedef kulüp kadroda değil', 'target_not_in_squad');
  }
  if (teamId === lineup.benchTeamId) {
    throw ApiError.badRequest('Benchteki kulüp hedeflenemez', 'target_on_bench');
  }
  return { teamId };
}

/** Activate a joker for a matchweek (§3.6). At most one live joker per week. */
export async function activate(
  userId: string,
  mwId: string,
  code: JokerCode,
  payload: Record<string, unknown>,
): Promise<ActiveJoker> {
  await assertEditable(mwId);

  const existing = await getActiveJoker(userId, mwId);
  if (existing) {
    throw ApiError.badRequest('Bu hafta zaten bir joker aktif — önce onu iptal et', 'joker_already_active');
  }

  const normalized = await validatePayload(userId, mwId, code, payload);

  return withTransaction(async (client) => {
    const dec = await client.query(
      `UPDATE joker_inventory SET remaining_count = remaining_count - 1
       WHERE user_id = $1 AND joker_type_code = $2 AND remaining_count > 0`,
      [userId, code],
    );
    if (dec.rowCount === 0) throw ApiError.badRequest('Bu jokerden kalmadı', 'no_inventory');

    try {
      await client.query(
        `INSERT INTO joker_activations (user_id, matchweek_id, joker_type_code, payload)
         VALUES ($1, $2, $3, $4)`,
        [userId, mwId, code, JSON.stringify(normalized)],
      );
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        // Partial unique index: a second live joker for the same week (§8.1).
        throw ApiError.badRequest('Bu hafta zaten bir joker aktif', 'joker_already_active');
      }
      throw err;
    }
    return { code, payload: normalized };
  });
}

export interface JokerSquadConflict {
  matchweekId: string;
  code: JokerCode;
  teamId: string;
}

/**
 * Active jokers on still-editable weeks whose payload references a club being
 * removed from the squad (§3.6, edge case §11.25). A squad edit that would
 * strand such a joker must warn first and, on confirm, cancel it with a refund.
 * Weeks already locked are history and keep their activation untouched.
 */
export async function findSquadEditConflicts(
  userId: string,
  removedTeamIds: string[],
): Promise<JokerSquadConflict[]> {
  if (removedTeamIds.length === 0) return [];
  const { rows } = await query<{
    matchweek_id: string;
    joker_type_code: JokerCode;
    payload: Record<string, unknown>;
  }>(
    `SELECT matchweek_id, joker_type_code, payload FROM joker_activations
     WHERE user_id = $1 AND cancelled_at IS NULL`,
    [userId],
  );
  if (rows.length === 0) return [];

  const removed = new Set(removedTeamIds);
  const ordered = await getOrderedMatchweeks();
  const conflicts: JokerSquadConflict[] = [];
  for (const row of rows) {
    if (!lineupEditability(ordered, row.matchweek_id).editable) continue;
    // The clubs a payload can reference: shield target, swap's outgoing club.
    const ref = [row.payload.teamId, row.payload.fromTeamId].find(
      (v): v is string => typeof v === 'string' && removed.has(v),
    );
    if (ref) {
      conflicts.push({ matchweekId: row.matchweek_id, code: row.joker_type_code, teamId: ref });
    }
  }
  return conflicts;
}

/** Cancel the active joker for a matchweek and refund inventory (+1) (§3.6). */
export async function cancel(userId: string, mwId: string): Promise<void> {
  await assertEditable(mwId);
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; joker_type_code: JokerCode }>(
      `SELECT id, joker_type_code FROM joker_activations
       WHERE user_id = $1 AND matchweek_id = $2 AND cancelled_at IS NULL FOR UPDATE`,
      [userId, mwId],
    );
    const active = rows[0];
    if (!active) throw ApiError.badRequest('Aktif joker yok', 'no_active_joker');

    await client.query('UPDATE joker_activations SET cancelled_at = now() WHERE id = $1', [active.id]);
    await client.query(
      `INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, joker_type_code)
       DO UPDATE SET remaining_count = joker_inventory.remaining_count + 1, updated_at = now()`,
      [userId, active.joker_type_code],
    );
  });
}
