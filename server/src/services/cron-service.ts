import { query } from '../db/pool.ts';
import {
  isThrottleFailure,
  nextSyncDelayMs,
  type SyncWindowState,
} from '../domain/sync-cadence.ts';
import { claimJob } from './job-claim.ts';
import { resolveProvider, runSync, type SyncSummary } from './score-sync-service.ts';
import { readSyncWindow } from './sync-scheduler.ts';
import { sweepExpiredRefreshTokens } from './token-sweeper.ts';

/**
 * The season's heartbeat, for a host that sleeps between requests (§5.2, §9.5).
 *
 * Score polling and the token sweep are timers, and a timer needs a process
 * that stays awake. Free hosting does not offer one, so an external cron pings
 * `/api/cron/tick` instead and this decides what that ping is worth.
 *
 * The ping is deliberately dumber than the work. It arrives on a fixed schedule
 * and knows nothing; the cadence rules (fast while matches are in play, slow
 * the rest of the season, backed off after a failure) still decide whether the
 * provider actually gets called. A minute-by-minute ping through a quiet August
 * therefore costs one cheap query and nothing else, which is what keeps this
 * inside the provider's rate limit.
 */

/** Once a day is plenty for housekeeping that only deletes expired rows. */
const TOKEN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface FailureState {
  consecutiveFailures: number;
  throttled: boolean;
}

/**
 * How the last few polls went, read back from `sync_runs`.
 *
 * A persistent scheduler keeps this in memory. Here it has to survive a process
 * that may not exist between two pings, and the run log already records every
 * attempt, so there is nothing else to store.
 */
async function readFailureState(): Promise<FailureState> {
  const { rows } = await query<{ status: string; error: string | null }>(
    `SELECT status, error FROM sync_runs ORDER BY finished_at DESC LIMIT 20`,
  );
  let consecutiveFailures = 0;
  for (const row of rows) {
    if (row.status !== 'error') break;
    consecutiveFailures++;
  }
  const lastError = rows[0]?.status === 'error' ? (rows[0]?.error ?? '') : '';
  return { consecutiveFailures, throttled: isThrottleFailure(lastError) };
}

export interface CronTickResult {
  /** Whether this tick called the provider, and why not when it did not. */
  synced: boolean;
  skipped: 'not_due' | 'mock_provider' | null;
  summary: SyncSummary | null;
  /** Rows removed by the token sweep, or null when it was not due. */
  sweptTokens: number | null;
}

/**
 * One heartbeat: sync the provider if it is due, sweep spent tokens if it is
 * time. Failures are logged and reported, never thrown, so a cron service does
 * not start retrying on its own schedule alongside ours.
 */
export async function runCronTick(): Promise<CronTickResult> {
  const result: CronTickResult = {
    synced: false,
    skipped: null,
    summary: null,
    sweptTokens: null,
  };

  // The mock reports fixture status off a clock the admin passes in (§5.1).
  // Polling it against the wall clock would rewind the season, so it is left
  // to the admin page exactly as the in-process scheduler leaves it.
  const provider = await resolveProvider();
  if (provider.name === 'mock') {
    result.skipped = 'mock_provider';
  } else {
    let window: SyncWindowState = { inPlayCount: 0, nextKickoffAt: null };
    try {
      window = await readSyncWindow();
    } catch (err) {
      console.error('[cron] could not read the fixture window:', err);
    }
    const { consecutiveFailures, throttled } = await readFailureState();
    const due = nextSyncDelayMs({ now: new Date(), window, consecutiveFailures, throttled });

    if (await claimJob('provider_sync', due)) {
      try {
        result.summary = await runSync({ trigger: 'scheduled' });
        result.synced = true;
      } catch (err) {
        // runSync has already written the failure to `sync_runs`, which is
        // where the next tick reads the backoff from.
        console.error('[cron] sync failed:', err instanceof Error ? err.message : err);
      }
    } else {
      result.skipped = 'not_due';
    }
  }

  if (await claimJob('token_sweep', TOKEN_SWEEP_INTERVAL_MS)) {
    try {
      result.sweptTokens = await sweepExpiredRefreshTokens();
      if (result.sweptTokens > 0) {
        console.log(`[cron] swept ${result.sweptTokens} expired refresh tokens`);
      }
    } catch (err) {
      console.error('[cron] token sweep failed:', err instanceof Error ? err.message : err);
    }
  }

  return result;
}
