import { query } from '../db/pool.ts';
import { computeMatchweekScore, type ClubLine } from '../domain/lineup.ts';
import { resolveLineup, type EffectiveClub } from './lineup-service.ts';

/** Club-layer points for a matchweek, per team id (finished lines; §4.3 Option A). */
export async function getTeamPointsForMatchweek(mwId: string): Promise<Map<string, number>> {
  const { rows } = await query<{ team_id: string; points: number }>(
    `SELECT team_id, sum(points)::int AS points FROM team_point_entries
     WHERE matchweek_id = $1 GROUP BY team_id`,
    [mwId],
  );
  return new Map(rows.map((r) => [r.team_id, r.points]));
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
}

function decorateLines(lines: ClubLine[], squad: EffectiveClub[]): ParticipantWeekLine[] {
  const byId = new Map(squad.map((s) => [s.teamId, s]));
  return lines.map((l) => ({
    ...l,
    name: byId.get(l.teamId)?.name ?? '',
    shortName: byId.get(l.teamId)?.shortName ?? '',
  }));
}

/** Compute a participant's provisional matchweek score from current club points. */
export async function computeParticipantMatchweek(
  userId: string,
  mwId: string,
): Promise<ParticipantWeekScore | null> {
  const lineup = await resolveLineup(userId, mwId);
  if (!lineup) return null;
  const teamPoints = await getTeamPointsForMatchweek(mwId);
  const result = computeMatchweekScore({
    squad: lineup.squad.map((s) => ({ teamId: s.teamId, tierId: s.tierId })),
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    teamPoints,
  });
  return {
    matchweekId: mwId,
    benchTeamId: lineup.benchTeamId,
    captainTeamId: lineup.captainTeamId,
    total: result.total,
    lines: decorateLines(result.lines, lineup.squad),
    final: false,
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
    return { ...b, matchweekId: mwId, total: finalRow.rows[0].points, final: true };
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
  let written = 0;
  for (const userId of userIds) {
    const score = await computeParticipantMatchweek(userId, mwId);
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
