import { createHash } from 'node:crypto';
import type { MatchStatus } from './match.ts';

/**
 * Map a football-data.org v4 status string to our canonical status (§5.2).
 * Reference statuses: SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, SUSPENDED,
 * POSTPONED, CANCELLED, AWARDED.
 */
export function normalizeFootballDataStatus(raw: string): MatchStatus {
  switch (raw) {
    case 'IN_PLAY':
    case 'PAUSED':
      return 'live';
    case 'FINISHED':
    case 'AWARDED': // administrative result; treat as finished
      return 'finished';
    case 'POSTPONED':
      return 'postponed';
    case 'CANCELLED':
    case 'SUSPENDED':
      return 'cancelled';
    case 'SCHEDULED':
    case 'TIMED':
    default:
      return 'scheduled';
  }
}

// Mock provider helpers ----------------------------------------------------

const LIVE_WINDOW_MS = 110 * 60 * 1000; // ~kickoff .. +110 min counts as live

/** Deterministic mock status from a simulated clock vs kickoff (§5, mockup). */
export function mockStatusFor(kickoffAt: Date, simulatedNow: Date): MatchStatus {
  const delta = simulatedNow.getTime() - kickoffAt.getTime();
  if (delta < 0) return 'scheduled';
  if (delta < LIVE_WINDOW_MS) return 'live';
  return 'finished';
}

/**
 * Deterministic pseudo-random scoreline seeded by a stable key (match external
 * id). Same key always yields the same score, so repeated mock syncs are
 * idempotent. Goals skew low (0..4) like real football.
 */
export function mockScoreFor(seedKey: string): { home: number; away: number } {
  const hash = createHash('sha256').update(seedKey).digest();
  return { home: goalsFromByte(hash[0]!), away: goalsFromByte(hash[1]!) };
}

function goalsFromByte(byte: number): number {
  // Weighted buckets favouring 0-2 goals.
  const r = byte % 100;
  if (r < 22) return 0;
  if (r < 52) return 1;
  if (r < 76) return 2;
  if (r < 90) return 3;
  return 4;
}

/** For a live match, scale the eventual mock score by how far the clock has run. */
export function mockLiveScore(
  seedKey: string,
  kickoffAt: Date,
  simulatedNow: Date,
): { home: number; away: number } {
  const full = mockScoreFor(seedKey);
  const elapsed = Math.max(0, simulatedNow.getTime() - kickoffAt.getTime());
  const frac = Math.min(1, elapsed / LIVE_WINDOW_MS);
  return { home: Math.floor(full.home * frac), away: Math.floor(full.away * frac) };
}
