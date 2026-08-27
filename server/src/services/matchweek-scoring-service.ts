import { query } from '../db/pool.ts';
import { computeMatchweekScore, type ClubLine } from '../domain/lineup.ts';
import { computeShieldDelta } from '../domain/joker.ts';
import { scoreMatchDraft } from '../domain/scoring.ts';
import { resolveLineup, type EffectiveClub } from './lineup-service.ts';
import { getActiveJoker } from './joker-service.ts';
import { getTierRules } from './rule-loader.ts';
import { getPredictionTally } from './prediction-service.ts';
import { normalizeTally, type PredictionTally } from '../domain/prediction.ts';

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

  // Live matches: draft points on the fly.
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
     WHERE m.matchweek_id = $1 AND m.status = 'live'
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`,
    [mwId],
  );
  if (live.rows.length > 0) {
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
  /** Ahtapot Paul's haul for the week, already included in `total` (§18.9). */
  predictions: PredictionTally;
}

function decorateLines(lines: ClubLine[], squad: EffectiveClub[]): ParticipantWeekLine[] {
  const byId = new Map(squad.map((s) => [s.teamId, s]));
  return lines.map((l) => ({
    ...l,
    name: byId.get(l.teamId)?.name ?? '',
    shortName: byId.get(l.teamId)?.shortName ?? '',
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
  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) return null;

  const teamPoints = new Map(clubPoints ?? (await getTeamPointsForMatchweek(mwId)));
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

  const result = computeMatchweekScore({
    squad: lineup.squad.map((s) => ({ teamId: s.teamId, tierId: s.tierId })),
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    teamPoints,
    benchBoost: joker?.code === 'bench_boost',
    captainMultiplier: joker?.code === 'triple_boost' ? 3 : 2,
  });

  return {
    matchweekId: mwId,
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    total: result.total + predictions.points,
    lines: decorateLines(result.lines, lineup.squad),
    final: false,
    jokerCode: joker?.code ?? null,
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
      // Weeks finalised before Ahtapot Paul existed carry no tally at all, and
      // ones finalised before the provisional count existed carry a partial one.
      predictions: normalizeTally(b.predictions),
    };
  }
  return computeParticipantMatchweek(userId, mwId);
}

/** Participant ids (non-admin) that have a full permanent squad. */
async function participantsWithSquad(): Promise<string[]> {
  const { rows } = await query<{ user_id: string }>(
    `SELECT ts.user_id FROM team_selections ts
     JOIN users u ON u.id = ts.user_id AND NOT u.is_admin
     GROUP BY ts.user_id HAVING count(*) = 4`,
  );
  return rows.map((r) => r.user_id);
}

/** Write final player_matchday_scores for every participant for a completed week (§4.6). */
export async function finalizeMatchweek(mwId: string): Promise<number> {
  const userIds = await participantsWithSquad();
  const clubPoints = await getTeamPointsForMatchweek(mwId);
  let written = 0;
  for (const userId of userIds) {
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
  const participantCount = (await participantsWithSquad()).length;
  const finalizedWeeks: string[] = [];
  for (const { id } of rows) {
    const have = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM player_matchday_scores WHERE matchweek_id = $1`,
      [id],
    );
    if (Number(have.rows[0]!.n) < participantCount) {
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
