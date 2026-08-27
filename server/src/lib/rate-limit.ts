/**
 * Login rate limiter (PLAN.md §12): sliding window per (IP + username).
 *
 * Hitting the limit gets you a 429 with Retry-After and nothing more. There is
 * no permanent account lockout, because that would let anyone freeze a known
 * username at will. A successful login resets the counter for that key. In-memory is fine for a single-node private
 * league; swap for a shared store (Redis) if the API is scaled horizontally.
 */
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 7; // a handful of attempts per window

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

function keyFor(ip: string, username: string): string {
  return `${ip}::${username.toLowerCase()}`;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Records an attempt and reports whether it is allowed under the window. */
export function checkLoginRate(ip: string, username: string): RateLimitResult {
  const now = Date.now();
  const key = keyFor(ip, username);
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);

  if (bucket.timestamps.length >= MAX_ATTEMPTS) {
    const oldest = bucket.timestamps[0]!;
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clears the counter after a successful login. */
export function resetLoginRate(ip: string, username: string): void {
  buckets.delete(keyFor(ip, username));
}

/** Test helper: wipe all buckets. */
export function _clearAllRateLimits(): void {
  buckets.clear();
}
