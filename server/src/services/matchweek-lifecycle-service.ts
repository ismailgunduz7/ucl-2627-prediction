import type { PoolClient } from 'pg';
import { query } from '../db/pool.ts';
import { LINEUP_LOCK_OFFSET_SECONDS, lockInstantFor } from '../domain/constants.ts';

export interface MatchweekRow {
  id: string;
  act: 'league_phase' | 'knockout';
  sort_order: number;
  label: string;
  status: 'upcoming' | 'open' | 'in_progress' | 'complete';
  first_kickoff_at: Date | null;
  completed_at: Date | null;
}

/** The first league-phase matchweek (MW1). Selection lock is derived from it (§3.2/§3.9). */
export async function getFirstLeagueMatchweek(): Promise<MatchweekRow | null> {
  const { rows } = await query<MatchweekRow>(
    `SELECT id, act, sort_order, label, status, first_kickoff_at, completed_at
     FROM matchweeks WHERE act = 'league_phase' ORDER BY sort_order ASC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getMatchweekById(id: string): Promise<MatchweekRow | null> {
  const { rows } = await query<MatchweekRow>(
    `SELECT id, act, sort_order, label, status, first_kickoff_at, completed_at
     FROM matchweeks WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface LockState {
  /** T0(M): earliest kickoff of the matchweek, or null if no fixtures yet. */
  firstKickoffAt: Date | null;
  /** T0(M) - 5m, or null if firstKickoffAt is unknown. */
  lockAt: Date | null;
  locked: boolean;
}

/** A matchweek has started once a match kicked off, by status or by the clock. */
function hasStarted(status: string, firstKickoffAt: Date | null, now: Date): boolean {
  if (status === 'in_progress' || status === 'complete') return true;
  return firstKickoffAt !== null && now.getTime() >= firstKickoffAt.getTime();
}

/**
 * Lock state for a matchweek at instant `now` (§3.4). Derived from the CURRENT
 * first_kickoff_at (never a stored deadline). Locked once now ≥ T0-5m OR the
 * matchweek has already started, meaning a match kicked off. That second
 * condition keeps a started week frozen even when the wall clock and the
 * provider's clock disagree.
 */
export function lockStateFor(mw: MatchweekRow, now: Date = new Date()): LockState {
  const started = mw.status === 'in_progress' || mw.status === 'complete';
  if (!mw.first_kickoff_at) return { firstKickoffAt: null, lockAt: null, locked: started };
  const firstKickoffAt = new Date(mw.first_kickoff_at);
  const lockAt = lockInstantFor(firstKickoffAt);
  return { firstKickoffAt, lockAt, locked: now.getTime() >= lockAt.getTime() || started };
}

/**
 * Selection lock (§3.2): the permanent squad edit window closes at the SAME
 * instant as the MW1 lineup lock, T0(MW1) - 5m. Not a separate clock.
 */
export async function getSelectionLockState(now: Date = new Date()): Promise<LockState> {
  const mw1 = await getFirstLeagueMatchweek();
  if (!mw1) return { firstKickoffAt: null, lockAt: null, locked: false };
  return lockStateFor(mw1, now);
}

// --- Lineup editability (§3.4) --------------------------------------------

export interface OrderedMatchweek {
  id: string;
  firstKickoffAt: Date | null;
  /** Optional; when omitted, only the wall clock decides "started". */
  status?: string;
}

export interface Editability {
  lockAt: Date | null;
  /** now ≥ T0(M) - 5m. */
  locked: boolean;
  /** Editing opened: M is first, or the previous matchweek has kicked off (§3.4). */
  opened: boolean;
  editable: boolean;
}

/**
 * Pure editability for matchweek `mwId` given all matchweeks in play order.
 * A matchweek is editable when its predecessor has started (or it is first) and
 * its own lock (T0 - 5m) has not passed. Derived entirely from current
 * first_kickoff_at values, never a stored deadline.
 */
export function lineupEditability(
  ordered: OrderedMatchweek[],
  mwId: string,
  now: Date = new Date(),
): Editability {
  const index = ordered.findIndex((m) => m.id === mwId);
  if (index === -1) return { lockAt: null, locked: false, opened: false, editable: false };
  const mw = ordered[index]!;
  const first = mw.firstKickoffAt;
  const lockAt = first ? new Date(first.getTime() - LINEUP_LOCK_OFFSET_SECONDS * 1000) : null;
  const started = hasStarted(mw.status ?? '', first, now);
  const locked = (lockAt ? now.getTime() >= lockAt.getTime() : false) || started;

  let opened: boolean;
  if (index === 0) {
    opened = true;
  } else {
    const prev = ordered[index - 1]!;
    opened = hasStarted(prev.status ?? '', prev.firstKickoffAt, now);
  }

  const editable = opened && !locked && first !== null;
  return { lockAt, locked, opened, editable };
}

/** All matchweeks in play order (league phase before knockout). */
export async function getOrderedMatchweeks(): Promise<OrderedMatchweek[]> {
  const { rows } = await query<{ id: string; first_kickoff_at: Date | null; status: string }>(
    `SELECT id, first_kickoff_at, status FROM matchweeks
     ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END, sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    firstKickoffAt: r.first_kickoff_at ? new Date(r.first_kickoff_at) : null,
    status: r.status,
  }));
}

/**
 * Recompute matchweek denormalized state inside a transaction (§3.4, §4.6):
 * 1. first_kickoff_at for weeks not yet started (upcoming/open). A started
 *    week's lock never moves.
 * 2. mark in_progress once any match is live/finished.
 * 3. mark complete when every match is finished/cancelled.
 * 4. take a week back out of complete when a result is undone, and drop the
 *    finals it had already written.
 * Called by both provider sync and manual result edits.
 */
export async function refreshMatchweekLifecycle(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE matchweeks mw
     SET first_kickoff_at = sub.mk, updated_at = now()
     FROM (SELECT matchweek_id, min(kickoff_at) AS mk FROM matches GROUP BY matchweek_id) sub
     WHERE mw.id = sub.matchweek_id AND mw.status IN ('upcoming', 'open')`,
  );
  await client.query(
    `UPDATE matchweeks SET status = 'in_progress', updated_at = now()
     WHERE status IN ('upcoming', 'open')
       AND id IN (SELECT matchweek_id FROM matches WHERE status IN ('live', 'finished'))`,
  );
  await client.query(
    `UPDATE matchweeks mw SET status = 'complete', completed_at = now(), updated_at = now()
     WHERE mw.status <> 'complete'
       AND EXISTS (SELECT 1 FROM matches m WHERE m.matchweek_id = mw.id)
       AND NOT EXISTS (
         SELECT 1 FROM matches m
         WHERE m.matchweek_id = mw.id AND m.status NOT IN ('finished', 'cancelled')
       )`,
  );
  // An admin undoing a result, or a provider moving a match back off finished,
  // leaves a completed week that is no longer complete. Roll it back and throw
  // away the finals it wrote, so the week is scored from scratch when every
  // match is settled again. It stays locked either way: `hasStarted` treats
  // in_progress as started, so nobody gets a second go at their lineup.
  await client.query(
    `WITH reopened AS (
       UPDATE matchweeks mw
       SET status = 'in_progress', completed_at = NULL, updated_at = now()
       WHERE mw.status = 'complete'
         AND EXISTS (
           SELECT 1 FROM matches m
           WHERE m.matchweek_id = mw.id AND m.status NOT IN ('finished', 'cancelled')
         )
       RETURNING mw.id
     )
     DELETE FROM player_matchday_scores s USING reopened r WHERE s.matchweek_id = r.id`,
  );
}

/** The current matchweek for the hub: earliest not-complete matchweek. */
export async function getCurrentMatchweek(): Promise<MatchweekRow | null> {
  const { rows } = await query<MatchweekRow>(
    `SELECT id, act, sort_order, label, status, first_kickoff_at, completed_at
     FROM matchweeks WHERE status <> 'complete'
     ORDER BY CASE act WHEN 'league_phase' THEN 0 ELSE 1 END, sort_order LIMIT 1`,
  );
  return rows[0] ?? null;
}
