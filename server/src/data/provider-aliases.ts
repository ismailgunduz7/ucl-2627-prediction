/**
 * Clubs whose football-data.org name is far enough from ours that normalising
 * the two cannot bring them together (domain/club-matching.ts).
 *
 * Left side is our name in `teams-2627.ts`, right side is the provider's exact
 * name. Keep this as short as it can be: every entry here is a judgement that
 * nothing else can verify, so an entry that stops matching is reported as a
 * stale alias rather than quietly resolving to the wrong club.
 */
export const PROVIDER_CLUB_ALIASES: Readonly<Record<string, string>> = {
  // The provider files the Athens club under its parent sports club, PAE AEK.
  'AEK Athens': 'PAE AEK',
};
