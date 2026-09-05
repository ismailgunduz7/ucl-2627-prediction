import { query } from '../db/pool.ts';

/**
 * Housekeeping for `refresh_tokens` (PLAN.md §12).
 *
 * Every login and every silent refresh writes a row, and rotation means a
 * fortnight of ordinary use leaves a trail of spent ones behind. Nothing read
 * them after they expired, so the table only ever grew.
 *
 * A row is deleted once its own expiry is far enough in the past that it can no
 * longer tell us anything. Rotated and revoked rows keep their original
 * `expires_at`, so they age out on the same clock. That matters: a rotated
 * token is what reuse detection matches a stolen one against, and deleting it
 * early would turn a caught theft into an ordinary "session invalid". Holding
 * it for the token's full lifetime plus a grace window costs nothing and keeps
 * that signal for as long as it means anything.
 */

/** How long past expiry a row is kept before it is swept. */
const GRACE_DAYS = 7;
const EVERY_MS = 24 * 60 * 60 * 1000;
/** Let the server finish coming up before touching the database. */
const FIRST_RUN_DELAY_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;

/** Deletes every refresh token that expired more than the grace window ago. */
export async function sweepExpiredRefreshTokens(): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM refresh_tokens WHERE expires_at < now() - ($1 || ' days')::interval`,
    [String(GRACE_DAYS)],
  );
  return rowCount ?? 0;
}

async function runAndReschedule(): Promise<void> {
  try {
    const removed = await sweepExpiredRefreshTokens();
    if (removed > 0) console.log(`[tokens] swept ${removed} expired refresh tokens`);
  } catch (err) {
    // Housekeeping is never worth taking the server down for. The rows keep
    // until tomorrow, which is exactly as bad as not having swept at all.
    console.error('[tokens] sweep failed:', err instanceof Error ? err.message : err);
  }
  timer = setTimeout(() => void runAndReschedule(), EVERY_MS);
  timer.unref();
}

export function startTokenSweeper(): void {
  if (timer) return;
  timer = setTimeout(() => void runAndReschedule(), FIRST_RUN_DELAY_MS);
  timer.unref();
}

export function stopTokenSweeper(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
