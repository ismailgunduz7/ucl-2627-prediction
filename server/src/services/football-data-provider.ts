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

interface FdTeam {
  id: number;
  name: string;
  shortName: string | null;
  crest: string | null;
}

/** One authenticated call to the provider, with its failures named (§5.2). */
async function fdRequest<T>(path: string): Promise<T> {
  const { FOOTBALL_DATA_API_TOKEN } = getEnv();
  if (!FOOTBALL_DATA_API_TOKEN) {
    throw new Error('FOOTBALL_DATA_API_TOKEN is not set');
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_TOKEN },
  });
  if (res.status === 429) {
    throw new Error('football-data rate limit hit (HTTP 429)');
  }
  if (res.status === 403) {
    throw new Error('football-data refused the request (HTTP 403): the plan may not cover this competition');
  }
  if (!res.ok) {
    throw new Error(`football-data request failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * The competition's club list, used once to map provider ids onto our own rows
 * (see `db/seed-provider.ts`). Not part of the sync path.
 */
export async function fetchFootballDataClubs(): Promise<FdTeam[]> {
  const body = await fdRequest<{ teams?: FdTeam[] }>(`/competitions/${COMPETITION}/teams`);
  return body.teams ?? [];
}

/** Every fixture the provider holds for the competition, in its own shape. */
export async function fetchFootballDataMatches(): Promise<FdMatch[]> {
  const body = await fdRequest<{ matches?: FdMatch[] }>(`/competitions/${COMPETITION}/matches`);
  return body.matches ?? [];
}

/** The provider's fixture translated into ours (§5.1). */
export function toProviderFixture(m: FdMatch): ProviderFixture {
  return {
    externalId: `fd:${m.id}`,
    homeTeamExternalId: `fd:${m.homeTeam.id}`,
    awayTeamExternalId: `fd:${m.awayTeam.id}`,
    kickoffAt: new Date(m.utcDate),
    status: normalizeFootballDataStatus(m.status),
    homeScore: m.score.fullTime.home,
    awayScore: m.score.fullTime.away,
    stage: STAGE_MAP[m.stage] ?? 'league_phase',
    matchday: m.matchday,
  };
}

/**
 * Real provider using football-data.org API v4 (§5.1). Server-side only; the
 * token never reaches clients (§5.6). Participants read from our own database
 * and this sync path is the only thing that calls the provider, so no amount of
 * user traffic can trip the provider's rate limit.
 *
 * Provider ids are written as `fd:<id>`. They resolve to our rows only once
 * `db/seed-provider.ts` has stamped matching ids onto the clubs and fixtures;
 * before that, every fixture here comes back unmapped and the mockup runs on
 * the mock provider instead.
 */
export const footballDataProvider: ScoreProvider = {
  name: 'football_data',

  async fetchFixtures(): Promise<ProviderFixture[]> {
    return (await fetchFootballDataMatches()).map(toProviderFixture);
  },
};
