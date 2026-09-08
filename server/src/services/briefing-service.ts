import { query } from '../db/pool.ts';
import { getMatchweekById } from './matchweek-lifecycle-service.ts';
import { getActiveJoker } from './joker-service.ts';
import { resolveLineup } from './lineup-service.ts';
import { participantScoresIn } from './selection-service.ts';
import { difficultyFor, harderBand, type DifficultyBand } from '../domain/difficulty.ts';

export type { DifficultyBand };

export interface ClubFixture {
  opponentName: string;
  opponentTierId: number;
  home: boolean;
  kickoffAt: string;
}

export interface ClubWeek {
  teamId: string;
  fixtures: ClubFixture[];
  difficulty: DifficultyBand | null; // null = no fixture this week (bye)
}

export interface BriefingClub extends ClubWeek {
  name: string;
  shortName: string;
  tierId: number;
  benched: boolean;
  captain: boolean;
}

/**
 * What every club in the competition is doing this matchweek, and how hard it
 * looks (§18.1). One query for the whole week rather than one per club: the
 * briefing wants four of them and the weekly-swap picker wants the rest of a
 * pot, which is nobody's squad.
 *
 * A club with no fixture is absent from the map. That is the bye, and the
 * caller says so in its own words.
 */
export async function getClubWeeks(mwId: string): Promise<Map<string, ClubWeek>> {
  const { rows } = await query<{
    home_team_id: string;
    away_team_id: string;
    home_name: string;
    away_name: string;
    home_tier: number;
    away_tier: number;
    kickoff_at: Date;
  }>(
    `SELECT m.home_team_id, m.away_team_id, ht.name AS home_name, at.name AS away_name,
            ht.tier_id AS home_tier, at.tier_id AS away_tier, m.kickoff_at
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
      WHERE m.matchweek_id = $1
      ORDER BY m.kickoff_at`,
    [mwId],
  );

  const weeks = new Map<string, ClubWeek>();
  const add = (teamId: string, tierId: number, fixture: ClubFixture) => {
    const week = weeks.get(teamId) ?? { teamId, fixtures: [], difficulty: null };
    week.fixtures.push(fixture);
    // A club playing twice is judged on its hardest fixture.
    week.difficulty = harderBand(
      week.difficulty,
      difficultyFor(tierId, fixture.opponentTierId, !fixture.home),
    );
    weeks.set(teamId, week);
  };

  for (const r of rows) {
    const kickoffAt = new Date(r.kickoff_at).toISOString();
    add(r.home_team_id, r.home_tier, {
      opponentName: r.away_name,
      opponentTierId: r.away_tier,
      home: true,
      kickoffAt,
    });
    add(r.away_team_id, r.away_tier, {
      opponentName: r.home_name,
      opponentTierId: r.home_tier,
      home: false,
      kickoffAt,
    });
  }
  return weeks;
}

/** Pre-lock briefing: each squad club's fixtures + how hard they look (§18.1). */
export async function getBriefing(userId: string, mwId: string): Promise<BriefingClub[]> {
  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) return [];

  const weeks = await getClubWeeks(mwId);
  return lineup.squad.map((club) => {
    const week = weeks.get(club.teamId);
    return {
      teamId: club.teamId,
      name: club.name,
      shortName: club.shortName,
      tierId: club.tierId,
      benched: club.teamId === lineup.benchTeamId,
      captain: club.teamId === lineup.captainTeamId,
      fixtures: week?.fixtures ?? [],
      difficulty: week?.difficulty ?? null,
    };
  });
}

export interface OpenPick {
  userId: string;
  displayName: string;
  benchName: string;
  captainName: string;
  jokerCode: string | null;
  /** What the joker touched: "out → in" for a swap, the target for a shield. */
  jokerDetail: string | null;
}

async function teamName(teamId: string): Promise<string | null> {
  if (!teamId) return null;
  const { rows } = await query<{ name: string }>('SELECT name FROM teams WHERE id = $1', [teamId]);
  return rows[0]?.name ?? null;
}

/**
 * Everyone's picks for a matchweek, the viewer's own row included. Nothing is
 * visible before kickoff (§3.6, §18.4), when it returns available=false. The
 * joker field is omitted for anyone who played none.
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
    // A player who joined after this week has no picks to open: the lineup
    // below would be a default nobody ever made (§3.2).
    if (!(await participantScoresIn(p.id, mwId))) continue;
    const lineup = await resolveLineup(p.id, mwId);
    if (!lineup) continue;
    const byId = new Map(lineup.squad.map((s) => [s.teamId, s.name]));
    const joker = await getActiveJoker(p.id, mwId);

    let jokerDetail: string | null = null;
    if (joker?.code === 'weekly_swap') {
      // The outgoing club is no longer in the effective squad; look it up.
      const out = await teamName(String(joker.payload.fromTeamId ?? ''));
      const inn =
        byId.get(String(joker.payload.toTeamId ?? '')) ??
        (await teamName(String(joker.payload.toTeamId ?? '')));
      if (out && inn) jokerDetail = `${out} → ${inn}`;
    } else if (joker?.code === 'clean_sheet_shield') {
      jokerDetail = byId.get(String(joker.payload.teamId ?? '')) ?? null;
    }

    picks.push({
      userId: p.id,
      displayName: p.display_name,
      benchName: byId.get(lineup.benchTeamId) ?? '',
      captainName: byId.get(lineup.captainTeamId) ?? '',
      jokerCode: joker?.code ?? null,
      jokerDetail,
    });
  }
  return { available: true, picks };
}
