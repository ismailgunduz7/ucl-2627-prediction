import type { MatchStatus } from '../domain/match.ts';

/**
 * Normalized fixture as returned by any score provider (§5.1). The sync service
 * maps these back to our rows by external id, so the source can be swapped
 * (football-data.org, a mock, or a future provider) without touching scoring.
 */
export interface ProviderFixture {
  externalId: string; // provider's match id → matches.external_id
  homeTeamExternalId: string; // → teams.external_id
  awayTeamExternalId: string;
  kickoffAt: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  stage: string; // e.g. 'league_phase' | 'playoff' | 'r16' ...
  matchday: number | null; // league matchday, if applicable
}

export interface ScoreProvider {
  readonly name: string;
  /** Optional simulated clock (mock provider); real providers ignore it. */
  fetchFixtures(opts?: { simulatedNow?: Date }): Promise<ProviderFixture[]>;
}
