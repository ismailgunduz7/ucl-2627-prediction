import { getEnv } from '../config/env.ts';
import { normalizeFootballDataStatus } from '../domain/provider-normalize.ts';
import type { ProviderFixture, ScoreProvider } from './score-provider.ts';

const BASE = 'https://api.football-data.org/v4';
const COMPETITION = 'CL';

// football-data stage -> our stage slug.
const STAGE_MAP: Record<string, string> = {
  LEAGUE_STAGE: 'league_phase',
  PLAYOFFS: 'playoff',
  LAST_16: 'r16',
  QUARTER_FINALS: 'qf',
  SEMI_FINALS: 'sf',
  FINAL: 'final',
};

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  homeTeam: { id: number };
  awayTeam: { id: number };
  score: { fullTime: { home: number | null; away: number | null } };
}

/**
 * Real provider using football-data.org API v4 (§5.1). Server-side only; the
 * token never reaches clients (§5.6). All participant reads come from our DB;
 * only this sync path calls the provider, so user concurrency never trips the
 * provider rate limit.
 *
 * Note: this maps provider ids as `fd:<id>`. It only resolves to our rows once
 * `teams.external_id` is seeded with matching `fd:` ids after the official draw;
 * until then the mockup uses the mock provider.
 */
export const footballDataProvider: ScoreProvider = {
  name: 'football_data',

  async fetchFixtures(): Promise<ProviderFixture[]> {
    const { FOOTBALL_DATA_API_TOKEN } = getEnv();
    if (!FOOTBALL_DATA_API_TOKEN) {
      throw new Error('FOOTBALL_DATA_API_TOKEN is not set');
    }
    const res = await fetch(`${BASE}/competitions/${COMPETITION}/matches`, {
      headers: { 'X-Auth-Token': FOOTBALL_DATA_API_TOKEN },
    });
    if (res.status === 429) {
      throw new Error('football-data rate limit hit (HTTP 429)');
    }
    if (!res.ok) {
      throw new Error(`football-data request failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { matches?: FdMatch[] };
    const matches = body.matches ?? [];

    return matches.map((m) => ({
      externalId: `fd:${m.id}`,
      homeTeamExternalId: `fd:${m.homeTeam.id}`,
      awayTeamExternalId: `fd:${m.awayTeam.id}`,
      kickoffAt: new Date(m.utcDate),
      status: normalizeFootballDataStatus(m.status),
      homeScore: m.score.fullTime.home,
      awayScore: m.score.fullTime.away,
      stage: STAGE_MAP[m.stage] ?? 'league_phase',
      matchday: m.matchday,
    }));
  },
};
