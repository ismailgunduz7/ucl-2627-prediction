/**
 * Adaptive polling cadence for the scheduled sync job (§5.2, §5.6).
 *
 * The free provider tier allows roughly ten requests per minute for the whole
 * server, so the job polls often only while matches are actually being played
 * and backs right off the rest of the season. All of it is pure arithmetic so
 * the cadence can be tested without a database or a live clock.
 */

/** How long after kickoff a match is still assumed to be in play. */
export const IN_PLAY_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Kickoff proximity bands used to pick a cadence. */
export const IMMINENT_WINDOW_MS = 15 * 60 * 1000;
export const MATCHDAY_WINDOW_MS = 3 * 60 * 60 * 1000;

export const SYNC_CADENCE_MS = {
  /** A match is in play: poll for score changes. */
  live: 60_000,
  /** Kickoff is minutes away: catch the scheduled → live flip quickly. */
  imminent: 2 * 60_000,
  /** Matches later today. */
  matchday: 10 * 60_000,
  /** Fixtures exist but none soon. */
  quiet: 30 * 60_000,
  /** Nothing scheduled at all (between acts, or season over). */
  idle: 6 * 60 * 60_000,
} as const;

/** Never poll faster than this, whatever the state says. */
export const MIN_SYNC_INTERVAL_MS = 30_000;

/** Backoff bases: a throttled poll waits out the provider's minute window. */
export const FAILURE_BACKOFF_BASE_MS = 60_000;
export const THROTTLE_BACKOFF_BASE_MS = 2 * 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;

/** What the fixture list looks like right now, as far as cadence cares. */
export interface SyncWindowState {
  /** Matches live, or kicked off within IN_PLAY_WINDOW_MS and not yet finished. */
  inPlayCount: number;
  /** Earliest kickoff still in the future, if any. */
  nextKickoffAt: Date | null;
}

/** Cadence for a healthy poll, ignoring failures. */
export function cadenceForWindow(now: Date, window: SyncWindowState): number {
  if (window.inPlayCount > 0) return SYNC_CADENCE_MS.live;
  if (!window.nextKickoffAt) return SYNC_CADENCE_MS.idle;

  const untilKickoff = window.nextKickoffAt.getTime() - now.getTime();
  if (untilKickoff <= IMMINENT_WINDOW_MS) return SYNC_CADENCE_MS.imminent;
  if (untilKickoff <= MATCHDAY_WINDOW_MS) return SYNC_CADENCE_MS.matchday;
  return SYNC_CADENCE_MS.quiet;
}

/** Exponential backoff after consecutive failures; zero while healthy. */
export function backoffDelayMs(consecutiveFailures: number, throttled: boolean): number {
  if (consecutiveFailures <= 0) return 0;
  const base = throttled ? THROTTLE_BACKOFF_BASE_MS : FAILURE_BACKOFF_BASE_MS;
  const raw = base * 2 ** Math.min(consecutiveFailures - 1, 16);
  return Math.min(raw, MAX_BACKOFF_MS);
}

/**
 * Delay until the next poll. Backoff can only push the next poll further out,
 * never pull it in: a failing provider during a live match still waits.
 */
export function nextSyncDelayMs(input: {
  now: Date;
  window: SyncWindowState;
  consecutiveFailures: number;
  throttled: boolean;
}): number {
  const cadence = cadenceForWindow(input.now, input.window);
  const backoff = backoffDelayMs(input.consecutiveFailures, input.throttled);
  return Math.max(MIN_SYNC_INTERVAL_MS, cadence, backoff);
}

/**
 * Whether a failure was the provider throttling us (§5.6). Providers surface
 * this as HTTP 429; we only ever see their error text by the time it reaches
 * the scheduler.
 */
export function isThrottleFailure(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('429') || text.includes('rate limit') || text.includes('too many requests');
}
