import { query } from '../db/pool.ts';
import {
  IN_PLAY_WINDOW_MS,
  MIN_SYNC_INTERVAL_MS,
  SYNC_CADENCE_MS,
  isThrottleFailure,
  nextSyncDelayMs,
  type SyncWindowState,
} from '../domain/sync-cadence.ts';
import { resolveProvider, runSync } from './score-sync-service.ts';
import { claimJob } from './job-claim.ts';

/**
 * Background sync job (§5.2, §9.5). One timer, re-armed after every poll with a
 * delay chosen from the fixture list: fast while matches are in play, slow the
 * rest of the season, and backed off when the provider throttles or errors
 * (§5.6). Only this job and the admin "trigger sync" button ever call the
 * provider, so participant traffic can never trip the rate limit.
 *
 * A poll that fails is logged to `sync_runs` and swallowed. The app keeps
 * serving the last good data, and the next poll simply comes later.
 *
 * The job stays parked while the mock provider is configured. The mock reads
 * fixture status off a simulated clock the admin passes in (§5.1); polling it
 * at wall-clock time would report every simulated result as "not played yet"
 * and rewind the season. It picks itself up when config names a real provider.
 */

export interface SyncSchedulerStatus {
  enabled: boolean;
  /** A poll is in flight right now. */
  polling: boolean;
  /** Provider the last poll resolved from config. */
  provider: string | null;
  /** Set while the job is deliberately not polling. */
  pausedReason: 'mock_provider' | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'success' | 'error' | null;
  lastError: string | null;
  consecutiveFailures: number;
  throttled: boolean;
}

let timer: NodeJS.Timeout | null = null;
let enabled = false;
let polling = false;
let nextRunAt: Date | null = null;
let lastRunAt: Date | null = null;
let lastStatus: 'success' | 'error' | null = null;
let lastError: string | null = null;
let consecutiveFailures = 0;
let throttled = false;
let provider: string | null = null;
let pausedReason: SyncSchedulerStatus['pausedReason'] = null;

/** Reads the fixture list for the two facts the cadence depends on. */
export async function readSyncWindow(): Promise<SyncWindowState> {
  const { rows } = await query<{ in_play: number; next_kickoff: Date | null }>(
    `SELECT
       count(*) FILTER (
         WHERE status = 'live'
            OR (status = 'scheduled'
                AND kickoff_at <= now()
                AND kickoff_at > now() - make_interval(secs => $1::int))
       )::int AS in_play,
       min(kickoff_at) FILTER (WHERE status = 'scheduled' AND kickoff_at > now()) AS next_kickoff
     FROM matches`,
    [Math.round(IN_PLAY_WINDOW_MS / 1000)],
  );
  const row = rows[0];
  return {
    inPlayCount: row?.in_play ?? 0,
    nextKickoffAt: row?.next_kickoff ? new Date(row.next_kickoff) : null,
  };
}

async function poll(): Promise<void> {
  polling = true;
  try {
    provider = (await resolveProvider()).name;
    if (provider === 'mock') {
      if (!pausedReason) console.log('[sync] parked: the mock provider runs on the admin clock');
      pausedReason = 'mock_provider';
      return;
    }
    pausedReason = null;
    // Shared with the cron endpoint, so pointing an external cron at a server
    // that also runs this timer does not double the provider's load.
    if (!(await claimJob('provider_sync', MIN_SYNC_INTERVAL_MS))) return;
    lastRunAt = new Date();
    const summary = await runSync({ trigger: 'scheduled' });
    lastStatus = 'success';
    lastError = null;
    consecutiveFailures = 0;
    throttled = false;
    if (summary.matchesUpserted > 0) {
      console.log(
        `[sync] ${summary.provider}: ${summary.matchesUpserted} updated, ${summary.matchesFinished} finished`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastStatus = 'error';
    lastError = message;
    consecutiveFailures++;
    throttled = isThrottleFailure(message);
    console.error(`[sync] poll failed (${consecutiveFailures}x): ${message}`);
  } finally {
    polling = false;
  }
}

/** Chooses the next delay; a window that cannot be read is treated as quiet. */
async function scheduleNext(first = false): Promise<void> {
  if (!enabled) return;

  let window: SyncWindowState = { inPlayCount: 0, nextKickoffAt: null };
  try {
    window = await readSyncWindow();
  } catch (err) {
    console.error('[sync] could not read the fixture window:', err);
  }

  // Parked on the mock provider: re-check config every so often instead of
  // following the fixture list.
  let delay = pausedReason
    ? SYNC_CADENCE_MS.quiet
    : nextSyncDelayMs({ now: new Date(), window, consecutiveFailures, throttled });

  // After a restart, catch up soon rather than sitting out a whole quiet
  // cadence. Not instantly though, so a crash loop still cannot hammer the
  // provider.
  if (first) delay = Math.min(delay, SYNC_CADENCE_MS.imminent);
  nextRunAt = new Date(Date.now() + delay);

  timer = setTimeout(() => {
    void poll().then(() => scheduleNext());
  }, delay);
  timer.unref?.(); // never hold the process open on its own
}

/** Starts the job. Safe to call twice; the second call is a no-op. */
export function startSyncScheduler(): void {
  if (enabled) return;
  enabled = true;
  console.log('[sync] scheduler started');
  void scheduleNext(true);
}

export function stopSyncScheduler(): void {
  enabled = false;
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}

export function getSyncSchedulerStatus(): SyncSchedulerStatus {
  return {
    enabled,
    polling,
    provider,
    pausedReason,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastStatus,
    lastError,
    consecutiveFailures,
    throttled,
  };
}
