import { query } from '../db/pool.ts';
import { getMatchweekById } from './matchweek-lifecycle-service.ts';
import { getActiveJoker } from './joker-service.ts';
import { resolveLineup } from './lineup-service.ts';
import { difficultyFor, harderBand, type DifficultyBand } from '../domain/difficulty.ts';

export type { DifficultyBand };

export interface BriefingClub {
  teamId: string;
  name: string;
  shortName: string;
  tierId: number;
  benched: boolean;
  captain: boolean;
  fixtures: { opponentName: string; opponentTierId: number; home: boolean; kickoffAt: string }[];
  difficulty: DifficultyBand | null; // null = no fixture this week (bye)
}

/** Pre-lock briefing: each squad club's fixtures + how hard they look (§18.1). */
export async function getBriefing(userId: string, mwId: string): Promise<BriefingClub[]> {
  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) return [];

  const clubs: BriefingClub[] = [];
  for (const club of lineup.squad) {
    const matches = await query<{
      opponent_name: string;
      opponent_tier: number;
      is_home: boolean;
      kickoff_at: Date;
    }>(
      `SELECT CASE WHEN m.home_team_id = $2 THEN at.name ELSE ht.name END AS opponent_name,
              CASE WHEN m.home_team_id = $2 THEN at.tier_id ELSE ht.tier_id END AS opponent_tier,
              (m.home_team_id = $2) AS is_home, m.kickoff_at
       FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
       WHERE m.matchweek_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)
       ORDER BY m.kickoff_at`,
      [mwId, club.teamId],
    );

    const fixtures = matches.rows.map((r) => ({
      opponentName: r.opponent_name,
      opponentTierId: r.opponent_tier,
      home: r.is_home,
      kickoffAt: new Date(r.kickoff_at).toISOString(),
    }));
    // A club playing twice is judged on its hardest fixture.
    let difficulty: DifficultyBand | null = null;
    for (const r of matches.rows) {
      difficulty = harderBand(difficulty, difficultyFor(club.tierId, r.opponent_tier, !r.is_home));
    }

    clubs.push({
      teamId: club.teamId,
      name: club.name,
      shortName: club.shortName,
      tierId: club.tierId,
      benched: club.teamId === lineup.benchTeamId,
      captain: club.teamId === lineup.captainTeamId,
      fixtures,
      difficulty,
    });
  }
  return clubs;
}

export interface OpenPick {
  userId: string;
  displayName: string;
  benchName: string;
  captainName: string;
  jokerCode: string | null;
}

/**
 * Peers' picks for a matchweek, visible only from kickoff (§3.6, §18.4). Returns
 * available=false before the week has started. Joker omitted when none used.
 */
export async function getOpenPicks(
  competitionId: string,
  mwId: string,
): Promise<{ available: boolean; picks: OpenPick[] }> {
  const mw = await getMatchweekById(mwId);
  if (!mw) return { available: false, picks: [] };
  const started =
    mw.status === 'in_progress' ||
    mw.status === 'complete' ||
    (mw.first_kickoff_at !== null && Date.now() >= new Date(mw.first_kickoff_at).getTime());
  if (!started) return { available: false, picks: [] };

  const participants = await query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users
     WHERE competition_id = $1 AND NOT is_admin ORDER BY display_name`,
    [competitionId],
  );

  const picks: OpenPick[] = [];
  for (const p of participants.rows) {
    const lineup = await resolveLineup(p.id, mwId);
    if (!lineup) continue;
    const byId = new Map(lineup.squad.map((s) => [s.teamId, s.name]));
    const joker = await getActiveJoker(p.id, mwId);
    picks.push({
      userId: p.id,
      displayName: p.display_name,
      benchName: byId.get(lineup.benchTeamId) ?? '',
      captainName: byId.get(lineup.captainTeamId) ?? '',
      jokerCode: joker?.code ?? null,
    });
  }
  return { available: true, picks };
}
