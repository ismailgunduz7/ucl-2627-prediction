import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.ts';
import { ApiError } from '../lib/errors.ts';
import { scoreMatchDraft, type TierRules } from '../domain/scoring.ts';
import { checkRuleDirection } from '../domain/rules-direction.ts';
import type { RuleDirection } from '../data/scoring-rules.ts';
import type { MatchStatus } from '../domain/match.ts';
import { refreshMatchweekLifecycle } from './matchweek-lifecycle-service.ts';
import { forceFinalizeCompletedMatchweeks } from './matchweek-scoring-service.ts';
import { progressSeason } from './act-service.ts';

export type { MatchStatus };

// --- Rules matrix ---------------------------------------------------------

export interface RuleMatrixRow {
  code: string;
  category: string;
  label: string;
  direction: RuleDirection;
  sortOrder: number;
  /** points by pot: { '1': n, '2': n, '3': n, '4': n } */
  points: Record<number, number>;
  /** null if the pot direction holds, else a warning string (§16). */
  warning: string | null;
}

export async function getRulesMatrix(): Promise<RuleMatrixRow[]> {
  const [types, values] = await Promise.all([
    query<{ code: string; category: string; label: string; direction: RuleDirection; sort_order: number }>(
      `SELECT code, category, label, direction, sort_order FROM scoring_rule_types
       WHERE is_active ORDER BY sort_order`,
    ),
    query<{ tier_id: number; rule_code: string; points: number }>(
      `SELECT tier_id, rule_code, points FROM tier_scoring_rules`,
    ),
  ]);

  const byRule = new Map<string, Record<number, number>>();
  for (const v of values.rows) {
    const rec = byRule.get(v.rule_code) ?? {};
    rec[v.tier_id] = v.points;
    byRule.set(v.rule_code, rec);
  }

  return types.rows.map((t) => {
    const points = byRule.get(t.code) ?? {};
    const potValues = [1, 2, 3, 4].map((p) => points[p] ?? 0);
    return {
      code: t.code,
      category: t.category,
      label: t.label,
      direction: t.direction,
      sortOrder: t.sort_order,
      points,
      warning: checkRuleDirection(t.direction, potValues),
    };
  });
}

export interface RuleUpdate {
  ruleCode: string;
  tierId: number;
  points: number;
}

/** Bulk-update per-pot rule values. Integers only; direction is warned, not blocked. */
export async function updateRules(updates: RuleUpdate[]): Promise<RuleMatrixRow[]> {
  for (const u of updates) {
    if (!Number.isInteger(u.points)) {
      throw ApiError.badRequest('Puanlar tam sayı olmalı', 'non_integer_points');
    }
    if (u.tierId < 1 || u.tierId > 4) {
      throw ApiError.badRequest('Geçersiz pot', 'invalid_tier');
    }
  }
  await withTransaction(async (client) => {
    for (const u of updates) {
      const res = await client.query(
        `UPDATE tier_scoring_rules SET points = $1, updated_at = now()
         WHERE tier_id = $2 AND rule_code = $3`,
        [u.points, u.tierId, u.ruleCode],
      );
      if (res.rowCount === 0) {
        throw ApiError.badRequest('Bilinmeyen kural/pot', 'unknown_rule');
      }
    }
  });
  return getRulesMatrix();
}

// --- Club-layer scoring engine (§4.2) -------------------------------------

async function loadTierRules(db: Pick<PoolClient, 'query'>): Promise<TierRules> {
  const { rows } = await db.query<{ tier_id: number; rule_code: string; points: number }>(
    `SELECT tier_id, rule_code, points FROM tier_scoring_rules`,
  );
  const map: TierRules = new Map();
  for (const r of rows) {
    if (!map.has(r.tier_id)) map.set(r.tier_id, new Map());
    map.get(r.tier_id)!.set(r.rule_code, r.points);
  }
  return map;
}

interface FinishedMatchRow {
  id: string;
  matchweek_id: string;
  home_team_id: string;
  away_team_id: string;
  home_tier_id: number;
  away_tier_id: number;
  home_score: number;
  away_score: number;
}

/** Replace one finished match's club lines (delete + insert, idempotent). */
async function scoreOneMatch(
  client: PoolClient,
  match: FinishedMatchRow,
  rules: TierRules,
): Promise<void> {
  await client.query('DELETE FROM team_point_entries WHERE match_id = $1', [match.id]);
  const lines = scoreMatchDraft(
    {
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      homeTierId: match.home_tier_id,
      awayTierId: match.away_tier_id,
      homeScore: match.home_score,
      awayScore: match.away_score,
    },
    rules,
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO team_point_entries (team_id, match_id, matchweek_id, rule_code, points, source_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (source_key) DO UPDATE SET points = EXCLUDED.points, metadata = EXCLUDED.metadata`,
      [
        line.teamId,
        match.id,
        match.matchweek_id,
        line.ruleCode,
        line.points,
        `match:${match.id}:${line.teamId}:${line.ruleCode}`,
        JSON.stringify(line.metadata),
      ],
    );
  }
}

const FINISHED_MATCH_SELECT = `
  SELECT m.id, m.matchweek_id, m.home_team_id, m.away_team_id,
         ht.tier_id AS home_tier_id, at.tier_id AS away_tier_id,
         m.home_score, m.away_score
  FROM matches m
  JOIN teams ht ON ht.id = m.home_team_id
  JOIN teams at ON at.id = m.away_team_id
  WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL`;

/**
 * Score one match by id inside an existing transaction, if it is finished with
 * scores. Returns true if lines were (re)written. Used by the sync service on a
 * transition to finished so it reuses the exact same engine as recalc.
 */
export async function scoreFinishedMatchInTx(
  client: PoolClient,
  matchId: string,
): Promise<boolean> {
  const { rows } = await client.query<FinishedMatchRow>(`${FINISHED_MATCH_SELECT} AND m.id = $1`, [
    matchId,
  ]);
  if (!rows[0]) return false;
  const rules = await loadTierRules(client);
  await scoreOneMatch(client, rows[0], rules);
  return true;
}

/** Remove a match's club lines inside a transaction (status left finished no more). */
export async function clearMatchLinesInTx(client: PoolClient, matchId: string): Promise<void> {
  await client.query('DELETE FROM team_point_entries WHERE match_id = $1', [matchId]);
}

/**
 * Full rebuild (§4.7): re-apply club-layer scoring for all finished matches,
 * refresh the one-time bonus lines to the current rule values, then re-apply
 * final participant matchweek scores for completed weeks.
 */
export async function recalculateAll(): Promise<{ matchesScored: number; finalizedWeeks: string[] }> {
  const { matchesScored } = await withTransaction(async (client) => {
    // Match-based lines are cleared and rebuilt from scratch. Bonus lines
    // (top-8, round advance, medals; match_id NULL) are one-time awards tied
    // to season events that a recalc cannot re-derive cheaply, so they stay,
    // but their POINTS must follow the current per-pot rule values.
    await client.query('DELETE FROM team_point_entries WHERE match_id IS NOT NULL');
    const rules = await loadTierRules(client);
    const { rows } = await client.query<FinishedMatchRow>(FINISHED_MATCH_SELECT);
    for (const match of rows) await scoreOneMatch(client, match, rules);

    await client.query(
      `UPDATE team_point_entries e
       SET points = r.points
       FROM teams t
       JOIN tier_scoring_rules r ON r.tier_id = t.tier_id
       WHERE e.match_id IS NULL AND e.team_id = t.id AND r.rule_code = e.rule_code
         AND e.points <> r.points`,
    );
    return { matchesScored: rows.length };
  });

  // Re-finalize completed matchweeks so player_matchday_scores reflects the
  // rebuilt club points (and covers participants added after completion).
  const { finalizedWeeks } = await forceFinalizeCompletedMatchweeks();
  return { matchesScored, finalizedWeeks };
}

// --- Admin match-result editor (minimal slice of §5.3) --------------------

export async function setMatchResult(
  matchId: string,
  homeScore: number | null,
  awayScore: number | null,
  status: MatchStatus,
  adminUserId: string,
): Promise<void> {
  const scored = status === 'finished' || status === 'live';
  if (scored && (homeScore === null || awayScore === null)) {
    throw ApiError.badRequest('Skor gerekli', 'score_required');
  }
  // A match put back to unplayed has no score; keep a cancelled match's partial
  // score for the record (it never yields points either way, §4.5).
  if (status === 'scheduled' || status === 'postponed') {
    homeScore = null;
    awayScore = null;
  }
  await withTransaction(async (client) => {
    const before = await client.query<{
      home_score: number | null;
      away_score: number | null;
      status: string;
    }>('SELECT home_score, away_score, status FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
    if (before.rowCount === 0) throw ApiError.badRequest('Maç bulunamadı', 'match_not_found');
    const prev = before.rows[0]!;

    await client.query(
      `UPDATE matches
       SET home_score = $1, away_score = $2, status = $3, is_manual_override = true, updated_at = now()
       WHERE id = $4`,
      [homeScore, awayScore, status, matchId],
    );

    // Audit the manual edit (§5.3): record only fields that actually changed.
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    if (prev.home_score !== homeScore) changed.home_score = { from: prev.home_score, to: homeScore };
    if (prev.away_score !== awayScore) changed.away_score = { from: prev.away_score, to: awayScore };
    if (prev.status !== status) changed.status = { from: prev.status, to: status };
    await client.query(
      `INSERT INTO match_override_audits (match_id, admin_user_id, action, changed_fields)
       VALUES ($1, $2, 'override', $3)`,
      [matchId, adminUserId, JSON.stringify(changed)],
    );

    if (status === 'finished') {
      await scoreFinishedMatchInTx(client, matchId);
    } else {
      // Not finished → no definitive club points for this match.
      await clearMatchLinesInTx(client, matchId);
    }

    // A manual finish/cancel may complete the matchweek (§4.6).
    await refreshMatchweekLifecycle(client);
  });

  // After commit: close the league act, settle knockout ties, then finalize.
  await progressSeason();
}

/** Clear the manual-override flag so sync may update the match again (§5.3). */
export async function clearMatchOverride(matchId: string, adminUserId: string): Promise<void> {
  await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE matches SET is_manual_override = false, updated_at = now()
       WHERE id = $1 AND is_manual_override = true`,
      [matchId],
    );
    if (res.rowCount === 0) {
      throw ApiError.badRequest('Override zaten yok veya maç bulunamadı', 'no_override');
    }
    await client.query(
      `INSERT INTO match_override_audits (match_id, admin_user_id, action, changed_fields)
       VALUES ($1, $2, 'clear_override', '{}'::jsonb)`,
      [matchId, adminUserId],
    );
  });
}

export interface OverrideAudit {
  id: string;
  action: string;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  adminUserId: string | null;
  /** Who did it, by name; null if the account was deleted since. */
  adminName: string | null;
  createdAt: string;
}

export async function getMatchAudits(matchId: string): Promise<OverrideAudit[]> {
  const { rows } = await query<{
    id: string;
    action: string;
    changed_fields: Record<string, { from: unknown; to: unknown }>;
    admin_user_id: string | null;
    admin_name: string | null;
    created_at: Date;
  }>(
    `SELECT a.id, a.action, a.changed_fields, a.admin_user_id,
            u.display_name AS admin_name, a.created_at
     FROM match_override_audits a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE a.match_id = $1 ORDER BY a.created_at DESC`,
    [matchId],
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    changedFields: r.changed_fields,
    adminUserId: r.admin_user_id,
    adminName: r.admin_name,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// --- Team detail (team pages, §10.1 /takim/:id) ---------------------------

export interface TeamDetail {
  team: {
    id: string;
    name: string;
    shortName: string;
    tierId: number;
    tierName: string;
    country: string | null;
    crestUrl: string | null;
    eliminated: boolean;
  };
  totalPoints: number;
  matches: {
    matchId: string;
    matchweekId: string;
    matchweekLabel: string;
    kickoffAt: string;
    status: string;
    isHome: boolean;
    opponentName: string;
    teamScore: number | null;
    opponentScore: number | null;
    points: number | null;
    entries: { ruleCode: string; ruleLabel: string; points: number }[];
  }[];
}

export async function getTeamDetail(teamId: string): Promise<TeamDetail> {
  const teamRes = await query<{
    id: string;
    name: string;
    short_name: string;
    tier_id: number;
    tier_name: string;
    country: string | null;
    crest_url: string | null;
    eliminated_at: Date | null;
  }>(
    `SELECT t.id, t.name, t.short_name, t.tier_id, ti.name AS tier_name,
            t.country, t.crest_url, t.eliminated_at
     FROM teams t JOIN tiers ti ON ti.id = t.tier_id WHERE t.id = $1`,
    [teamId],
  );
  const team = teamRes.rows[0];
  if (!team) throw ApiError.badRequest('Takım bulunamadı', 'team_not_found');

  const [matchesRes, pointsRes, totalRes, entriesRes] = await Promise.all([
    query<{
      match_id: string;
      matchweek_id: string;
      matchweek_label: string;
      kickoff_at: Date;
      status: string;
      is_home: boolean;
      opponent_name: string;
      team_score: number | null;
      opponent_score: number | null;
    }>(
      `SELECT m.id AS match_id, m.matchweek_id, mw.label AS matchweek_label,
              m.kickoff_at, m.status,
              (m.home_team_id = $1) AS is_home,
              CASE WHEN m.home_team_id = $1 THEN at.name ELSE ht.name END AS opponent_name,
              CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END AS team_score,
              CASE WHEN m.home_team_id = $1 THEN m.away_score ELSE m.home_score END AS opponent_score
       FROM matches m
       JOIN matchweeks mw ON mw.id = m.matchweek_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.home_team_id = $1 OR m.away_team_id = $1
       ORDER BY m.kickoff_at`,
      [teamId],
    ),
    query<{ match_id: string | null; points: number }>(
      `SELECT match_id, sum(points)::int AS points FROM team_point_entries
       WHERE team_id = $1 GROUP BY match_id`,
      [teamId],
    ),
    query<{ total: string | null }>(
      `SELECT sum(points)::text AS total FROM team_point_entries WHERE team_id = $1`,
      [teamId],
    ),
    query<{ match_id: string | null; rule_code: string; rule_label: string; points: number }>(
      `SELECT e.match_id, e.rule_code, rt.label AS rule_label, e.points
       FROM team_point_entries e
       JOIN scoring_rule_types rt ON rt.code = e.rule_code
       WHERE e.team_id = $1
       ORDER BY rt.sort_order`,
      [teamId],
    ),
  ]);

  const pointsByMatch = new Map(pointsRes.rows.map((r) => [r.match_id, r.points]));
  const entriesByMatch = new Map<string, { ruleCode: string; ruleLabel: string; points: number }[]>();
  for (const e of entriesRes.rows) {
    if (!e.match_id) continue;
    const list = entriesByMatch.get(e.match_id) ?? [];
    list.push({ ruleCode: e.rule_code, ruleLabel: e.rule_label, points: e.points });
    entriesByMatch.set(e.match_id, list);
  }

  return {
    team: {
      id: team.id,
      name: team.name,
      shortName: team.short_name,
      tierId: team.tier_id,
      tierName: team.tier_name,
      country: team.country,
      crestUrl: team.crest_url,
      eliminated: team.eliminated_at !== null,
    },
    totalPoints: Number(totalRes.rows[0]?.total ?? 0),
    matches: matchesRes.rows.map((m) => ({
      matchId: m.match_id,
      matchweekId: m.matchweek_id,
      matchweekLabel: m.matchweek_label,
      kickoffAt: new Date(m.kickoff_at).toISOString(),
      status: m.status,
      isHome: m.is_home,
      opponentName: m.opponent_name,
      teamScore: m.team_score,
      opponentScore: m.opponent_score,
      points: m.status === 'finished' ? (pointsByMatch.get(m.match_id) ?? 0) : null,
      entries: entriesByMatch.get(m.match_id) ?? [],
    })),
  };
}
