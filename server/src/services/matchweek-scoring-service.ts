import { query } from '../db/pool.ts';
import { computeMatchweekScore, type ClubLine } from '../domain/lineup.ts';
import { computeShieldDelta } from '../domain/joker.ts';
import { scoreMatchDraft } from '../domain/scoring.ts';
import { resolveLineup, type EffectiveClub } from './lineup-service.ts';
import { getActiveJoker } from './joker-service.ts';
import { getTierRules } from './rule-loader.ts';
import { getPredictionTally } from './prediction-service.ts';
import { normalizeTally, type PredictionTally } from '../domain/prediction.ts';
import { weekCountsForEntry } from '../domain/entry.ts';
import { participantScoresIn } from './selection-service.ts';
import { getOrderedMatchweeks } from './matchweek-lifecycle-service.ts';

/**
 * LIVE provisional club points, drafted in memory from the current score the
 * same way finished matches are scored (§4.3 Option A). Pass a matchweek to
 * draft just that week, or null for every match in play across the season.
 */
export async function liveTeamPointDrafts(mwId: string | null): Promise<Map<string, number>> {
  const points = new Map<string, number>();
  const live = await query<{
    home_team_id: string;
    away_team_id: string;
    home_tier_id: number;
    away_tier_id: number;
    home_score: number | null;
    away_score: number | null;
  }>(
    `SELECT m.home_team_id, m.away_team_id, ht.tier_id AS home_tier_id, at.tier_id AS away_tier_id,
            m.home_score, m.away_score
     FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id
     WHERE ($1::text IS NULL OR m.matchweek_id = $1) AND m.status = 'live'
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`,
    [mwId],
  );
  if (live.rows.length === 0) return points;

  const rules = await getTierRules();
  for (const m of live.rows) {
    const lines = scoreMatchDraft(
      {
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        homeTierId: m.home_tier_id,
        awayTierId: m.away_tier_id,
        homeScore: m.home_score!,
        awayScore: m.away_score!,
      },
      rules,
    );
    for (const l of lines) points.set(l.teamId, (points.get(l.teamId) ?? 0) + l.points);
  }
  return points;
}

/**
 * Club-layer points for a matchweek, per team id: definitive finished lines plus
 * LIVE provisional drafts computed in memory (§4.3 Option A). Live matches are
 * scored with the same rules as finished ones (treat current score as final).
 */
export async function getTeamPointsForMatchweek(mwId: string): Promise<Map<string, number>> {
  const points = new Map<string, number>();

  const finished = await query<{ team_id: string; points: number }>(
    `SELECT team_id, sum(points)::int AS points FROM team_point_entries
     WHERE matchweek_id = $1 GROUP BY team_id`,
    [mwId],
  );
  for (const r of finished.rows) points.set(r.team_id, r.points);

  for (const [teamId, drafted] of await liveTeamPointDrafts(mwId)) {
    points.set(teamId, (points.get(teamId) ?? 0) + drafted);
  }
  return points;
}

/**
 * Clean-sheet shield delta for the target club this matchweek (§3.6): scans the
 * club's finished/live matches for GA and applies the shield table. Shared with
 * the delta feed so the hub explains the same adjustment it scores.
 */
export async function shieldDeltaForTarget(mwId: string, targetTeamId: string): Promise<number> {
  const tierRes = await query<{ tier_id: number }>('SELECT tier_id FROM teams WHERE id = $1', [
    targetTeamId,
  ]);
  const tierId = tierRes.rows[0]?.tier_id;
  if (tierId === undefined) return 0;

  const matches = await query<{ ga: number }>(
    `SELECT (CASE WHEN home_team_id = $2 THEN away_score ELSE home_score END) AS ga
     FROM matches
     WHERE matchweek_id = $1 AND (home_team_id = $2 OR away_team_id = $2)
       AND status IN ('finished', 'live') AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    [mwId, targetTeamId],
  );
  const rules = await getTierRules();
  const cs = rules.get(tierId)?.get('clean_sheet') ?? 0;
  const conceded = rules.get(tierId)?.get('goals_conceded') ?? 0;
  return computeShieldDelta(
    matches.rows.map((r) => r.ga),
    cs,
    conceded,
  );
}

export interface ParticipantWeekLine extends ClubLine {
  name: string;
  shortName: string;
  crestUrl: string | null;
}

export interface ParticipantWeekScore {
  matchweekId: string;
  benchTeamId: string;
  captainTeamId: string;
  total: number;
  lines: ParticipantWeekLine[];
  /** true when read from a stored final row; false when computed provisionally. */
  final: boolean;
  /** active joker code for the week, if any. */
  jokerCode: string | null;
  /**
   * What the joker was worth: this week's total minus the same week scored
   * without it. Null when nothing was played, and null for `weekly_swap`,
   * whose worth is the difference between two clubs rather than a switch that
   * can simply be turned off, so there is no honest number to quote (§3.6).
   */
  jokerDelta: number | null;
  /** Ahtapot Paul's haul for the week, already included in `total` (§18.9). */
  predictions: PredictionTally;
}

function decorateLines(lines: ClubLine[], squad: EffectiveClub[]): ParticipantWeekLine[] {
  const byId = new Map(squad.map((s) => [s.teamId, s]));
  return lines.map((l) => ({
    ...l,
    name: byId.get(l.teamId)?.name ?? '',
    shortName: byId.get(l.teamId)?.shortName ?? '',
    crestUrl: byId.get(l.teamId)?.crestUrl ?? null,
  }));
}

/**
 * Compute a participant's provisional matchweek score, applying any active
 * joker.
 *
 * `clubPoints` lets a caller scoring the whole competition read the week's club
 * points once instead of once per participant, since that half of the sum is
 * identical for everyone. It is copied rather than used directly, because the
 * shield adjustment below writes into the map and one player's shield must not
 * land on anybody else's total.
 */
export async function computeParticipantMatchweek(
  userId: string,
  mwId: string,
  clubPoints?: ReadonlyMap<string, number>,
): Promise<ParticipantWeekScore | null> {
  // A late entrant sat out the weeks before the one they joined at, so those
  // weeks score nothing for them (§3.2). Every path that reads or writes a
  // participant's week total comes through here, which is why the check lives
  // in this one place.
  if (!(await participantScoresIn(userId, mwId))) return null;

  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) return null;

  const teamPoints = new Map(clubPoints ?? (await getTeamPointsForMatchweek(mwId)));
  // The shield edits club points in place below, so keep what they were.
  const basePoints = new Map(teamPoints);
  const joker = await getActiveJoker(userId, mwId);
  const predictions = await getPredictionTally(userId, mwId);

  // clean_sheet_shield: bump the target club's points by the shield delta (§3.6).
  if (joker?.code === 'clean_sheet_shield') {
    const targetId = String(joker.payload.teamId ?? '');
    if (targetId) {
      const delta = await shieldDeltaForTarget(mwId, targetId);
      if (delta !== 0) teamPoints.set(targetId, (teamPoints.get(targetId) ?? 0) + delta);
    }
  }

  const squad = lineup.squad.map((s) => ({ teamId: s.teamId, tierId: s.tierId }));
  const result = computeMatchweekScore({
    squad,
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    teamPoints,
    benchBoost: joker?.code === 'bench_boost',
    captainMultiplier: joker?.code === 'triple_boost' ? 3 : 2,
  });

  // What the joker was worth: score the same week again with its effect
  // switched off and take the difference. A swap is not a switch, though: it
  // put a different club in the squad, so scoring "the same week without it"
  // would need the club it replaced, and quoting zero there would be a lie.
  let jokerDelta: number | null = null;
  if (joker && joker.code !== 'weekly_swap') {
    const plain = computeMatchweekScore({
      squad,
      benchTeamId: lineup.benchTeamId,
      captainTeamId: lineup.captainTeamId,
      teamPoints: basePoints,
      benchBoost: false,
      captainMultiplier: 2,
    });
    jokerDelta = result.total - plain.total;
  }

  return {
    matchweekId: mwId,
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    total: result.total + predictions.points,
    lines: decorateLines(result.lines, lineup.squad),
    final: false,
    jokerCode: joker?.code ?? null,
    jokerDelta,
    predictions,
  };
}

/**
 * A participant's week score: the stored FINAL if the week is complete, else the
 * computed provisional (§4.3 Option A).
 */
export async function getParticipantWeekScore(
  userId: string,
  mwId: string,
): Promise<ParticipantWeekScore | null> {
  const finalRow = await query<{ points: number; breakdown: ParticipantWeekScore }>(
    `SELECT s.points, s.breakdown
     FROM player_matchday_scores s
     JOIN matchweeks mw ON mw.id = s.matchweek_id
     WHERE s.user_id = $1 AND s.matchweek_id = $2 AND mw.status = 'complete'`,
    [userId, mwId],
  );
  if (finalRow.rows[0]) {
    const b = finalRow.rows[0].breakdown;
    return {
      ...b,
      matchweekId: mwId,
      total: finalRow.rows[0].points,
      final: true,
      jokerCode: b.jokerCode ?? null,
      // Weeks finalised before this was recorded say nothing rather than zero.
      jokerDelta: b.jokerDelta ?? null,
      // Weeks finalised before Ahtapot Paul existed carry no tally at all, and
      // ones finalised before the provisional count existed carry a partial one.
      predictions: normalizeTally(b.predictions),
    };
  }
  return computeParticipantMatchweek(userId, mwId);
}

interface ScoringParticipant {
  userId: string;
  /** The week their season starts at; null for everyone who was there from MW1. */
  entryMatchweekId: string | null;
}

/** Participants (non-admin) that have a full permanent squad. */
async function participantsWithSquad(): Promise<ScoringParticipant[]> {
  const { rows } = await query<{ user_id: string; entry_matchweek_id: string | null }>(
    `SELECT ts.user_id, u.entry_matchweek_id FROM team_selections ts
     JOIN users u ON u.id = ts.user_id AND NOT u.is_admin
     GROUP BY ts.user_id, u.entry_matchweek_id HAVING count(*) = 4`,
  );
  return rows.map((r) => ({ userId: r.user_id, entryMatchweekId: r.entry_matchweek_id }));
}

/** Those of them whose season had started by matchweek `mwId` (§3.2). */
async function participantsScoringIn(mwId: string): Promise<ScoringParticipant[]> {
  const participants = await participantsWithSquad();
  if (participants.every((p) => p.entryMatchweekId === null)) return participants;
  const order = (await getOrderedMatchweeks()).map((m) => m.id);
  return participants.filter((p) => weekCountsForEntry(order, p.entryMatchweekId, mwId));
}

/** Write final player_matchday_scores for every participant for a completed week (§4.6). */
export async function finalizeMatchweek(mwId: string): Promise<number> {
  const participants = await participantsScoringIn(mwId);
  const clubPoints = await getTeamPointsForMatchweek(mwId);
  let written = 0;
  for (const { userId } of participants) {
    const score = await computeParticipantMatchweek(userId, mwId, clubPoints);
    if (!score) continue;
    await query(
      `INSERT INTO player_matchday_scores (user_id, matchweek_id, points, breakdown)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, matchweek_id)
       DO UPDATE SET points = EXCLUDED.points, breakdown = EXCLUDED.breakdown, updated_at = now()`,
      [
        userId,
        mwId,
        score.total,
        JSON.stringify({
          benchTeamId: score.benchTeamId,
          captainTeamId: score.captainTeamId,
          lines: score.lines,
          jokerCode: score.jokerCode,
          predictions: score.predictions,
        }),
      ],
    );
    written++;
  }
  return written;
}

/**
 * Finalize any complete matchweek that is missing finals for the current set of
 * participants-with-squad. Idempotent; called after sync / manual result edits.
 */
export async function finalizeCompletedMatchweeks(): Promise<{ finalizedWeeks: string[] }> {
  const { rows } = await query<{ id: string }>(
    `SELECT mw.id FROM matchweeks mw WHERE mw.status = 'complete'`,
  );
  const finalizedWeeks: string[] = [];
  for (const { id } of rows) {
    // Counted per week, not once for the whole season: a late entrant is not
    // missing a final for the weeks before they joined, and comparing against
    // the whole roster would re-finalize those weeks on every single sync.
    const expected = (await participantsScoringIn(id)).length;
    const have = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM player_matchday_scores WHERE matchweek_id = $1`,
      [id],
    );
    if (Number(have.rows[0]!.n) < expected) {
      await finalizeMatchweek(id);
      finalizedWeeks.push(id);
    }
  }
  return { finalizedWeeks };
}

/**
 * Re-finalize EVERY complete matchweek unconditionally (used by recalc, §4.7):
 * club points may have changed for weeks that already have finals.
 */
export async function forceFinalizeCompletedMatchweeks(): Promise<{ finalizedWeeks: string[] }> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM matchweeks WHERE status = 'complete'`,
  );
  for (const { id } of rows) await finalizeMatchweek(id);
  return { finalizedWeeks: rows.map((r) => r.id) };
}
