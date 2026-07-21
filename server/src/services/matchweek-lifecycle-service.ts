import { query } from '../db/pool.ts';
import { lockInstantFor } from '../domain/constants.ts';

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
  /** T0(M) − 5m, or null if firstKickoffAt is unknown. */
  lockAt: Date | null;
  locked: boolean;
}

/**
 * Lock state for a matchweek at instant `now` (§3.4). Always derived from the
 * CURRENT first_kickoff_at — never a stored frozen deadline. If first_kickoff_at
 * is null (no fixtures yet), the week is treated as not locked.
 */
export function lockStateFor(mw: MatchweekRow, now: Date = new Date()): LockState {
  if (!mw.first_kickoff_at) return { firstKickoffAt: null, lockAt: null, locked: false };
  const firstKickoffAt = new Date(mw.first_kickoff_at);
  const lockAt = lockInstantFor(firstKickoffAt);
  return { firstKickoffAt, lockAt, locked: now.getTime() >= lockAt.getTime() };
}

/**
 * Selection lock (§3.2): the permanent squad edit window closes at the SAME
 * instant as the MW1 lineup lock, T0(MW1) − 5m. Not a separate clock.
 */
export async function getSelectionLockState(now: Date = new Date()): Promise<LockState> {
  const mw1 = await getFirstLeagueMatchweek();
  if (!mw1) return { firstKickoffAt: null, lockAt: null, locked: false };
  return lockStateFor(mw1, now);
}
