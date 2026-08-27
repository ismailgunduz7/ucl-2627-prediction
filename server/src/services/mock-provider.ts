import { query } from '../db/pool.ts';
import { mockLiveScore, mockScoreFor, mockStatusFor } from '../domain/provider-normalize.ts';
import type { ProviderFixture, ScoreProvider } from './score-provider.ts';

/**
 * Mock provider for the pre-draw mockup (§5, §17.5). Reads our seeded matches
 * and returns them as fixtures whose status/score are derived from a simulated
 * clock. That lets us exercise the whole pipeline (scheduled → live → finished,
 * scoring, completion) before any real 2026-27 data exists.
 *
 * Manual-override protection lives in the sync service, not here. This provider
 * always reports its simulated view of every fixture.
 */
export const mockProvider: ScoreProvider = {
  name: 'mock',

  async fetchFixtures(opts): Promise<ProviderFixture[]> {
    const simulatedNow = opts?.simulatedNow ?? new Date();
    const { rows } = await query<{
      external_id: string;
      home_external_id: string;
      away_external_id: string;
      kickoff_at: Date;
      stage: string;
      matchweek_sort: number;
    }>(
      `SELECT m.external_id,
              ht.external_id AS home_external_id,
              at.external_id AS away_external_id,
              m.kickoff_at, m.stage, mw.sort_order AS matchweek_sort
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       JOIN matchweeks mw ON mw.id = m.matchweek_id
       WHERE m.external_id LIKE 'mock:%'`,
    );

    return rows.map((r) => {
      const kickoffAt = new Date(r.kickoff_at);
      const status = mockStatusFor(kickoffAt, simulatedNow);
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      if (status === 'finished') {
        ({ home: homeScore, away: awayScore } = mockScoreFor(r.external_id));
      } else if (status === 'live') {
        ({ home: homeScore, away: awayScore } = mockLiveScore(r.external_id, kickoffAt, simulatedNow));
      }
      return {
        externalId: r.external_id,
        homeTeamExternalId: r.home_external_id,
        awayTeamExternalId: r.away_external_id,
        kickoffAt,
        status,
        homeScore,
        awayScore,
        stage: r.stage,
        matchday: r.matchweek_sort,
      } satisfies ProviderFixture;
    });
  },
};
