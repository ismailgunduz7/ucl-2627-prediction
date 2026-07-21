/** Canonical match status across the app (DB CHECK, provider mapping, scoring). */
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';

export const MATCH_STATUSES: MatchStatus[] = [
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
];
