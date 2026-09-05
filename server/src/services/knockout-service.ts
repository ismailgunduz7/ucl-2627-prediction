import type { PoolClient, QueryResultRow } from 'pg';
import { query, withTransaction } from '../db/pool.ts';
import { pairSeeds, resolveTie, type TieLeg } from '../domain/knockout.ts';
import type { StandingRow } from '../domain/standings.ts';
import { getConfigValue } from './tournament-config-service.ts';

/**
 * Knockout path (PLAN.md §2.4): play-offs for ranks 9-24, then the round of 16
 * (joined by the top eight), quarter-finals, semi-finals and the final. Every
 * leg is its own matchweek so bench, captain and jokers lock per leg.
 */
export type Stage = 'playoff' | 'r16' | 'qf' | 'sf' | 'final';

interface RoundSpec {
  stage: Stage;
  label: string;
  legs: 1 | 2;
  /** Weeks after the last league matchweek that leg 1 kicks off. */
  weekOffset: number;
}

const ROUNDS: RoundSpec[] = [
  { stage: 'playoff', label: 'Play-off', legs: 2, weekOffset: 2 },
  { stage: 'r16', label: 'Son 16', legs: 2, weekOffset: 6 },
  { stage: 'qf', label: 'Çeyrek final', legs: 2, weekOffset: 10 },
  { stage: 'sf', label: 'Yarı final', legs: 2, weekOffset: 14 },
  { stage: 'final', label: 'Final', legs: 1, weekOffset: 18 },
];

const NEXT_STAGE: Record<Stage, Stage | null> = {
  playoff: 'r16',
  r16: 'qf',
  qf: 'sf',
  sf: 'final',
  final: null,
};

function matchweekId(stage: Stage, leg: number, legs: number): string {
  return legs === 1 ? stage : `${stage}-leg${leg}`;
}

/** True for the five knockout stage slugs, false for 'league_phase'. */
export function isKnockoutStage(stage: string): stage is Stage {
  return ROUNDS.some((r) => r.stage === stage);
}

/** How many legs the competition plays in this round. */
export function legsForStage(stage: Stage): number {
  return ROUNDS.find((r) => r.stage === stage)!.legs;
}

/**
 * The matchweek a knockout leg belongs to, or null when the round does not run
 * to that many legs and the fixture cannot be placed.
 */
export function knockoutMatchweekId(stage: Stage, leg: number): string | null {
  const legs = legsForStage(stage);
  if (leg < 1 || leg > legs) return null;
  return matchweekId(stage, leg, legs);
}

/**
 * Whether we are the ones drawing the bracket.
 *
 * The mock has no draw of its own: it reports back on fixtures already in our
 * table, so a mock season only reaches the knockout if we seed one. A real
 * provider publishes UEFA's actual draw, and inventing a second bracket
 * alongside it would put two sets of fixtures in the same matchweek.
 */
async function bracketIsOursToDraw(): Promise<boolean> {
  return (await getConfigValue('sync_provider')) === 'mock';
}

function matchweekLabel(spec: RoundSpec, leg: number): string {
  return spec.legs === 1 ? spec.label : `${spec.label} ${leg}. maç`;
}

/**
 * Creates the knockout matchweek registry rows if they are not there yet.
 *
 * The kickoff dates here are placeholders a whole round wide. Once real
 * fixtures land in a week, `refreshMatchweekLifecycle` replaces them with the
 * earliest actual kickoff, so a week that has not started never keeps a guess.
 */
export async function ensureKnockoutMatchweeks(client?: PoolClient): Promise<void> {
  const run = <T extends QueryResultRow>(text: string, params?: unknown[]) =>
    client ? client.query<T>(text, params as unknown[]) : query<T>(text, params);

  const last = await run<{ first_kickoff_at: Date | null }>(
    `SELECT first_kickoff_at FROM matchweeks
     WHERE act = 'league_phase' ORDER BY sort_order DESC LIMIT 1`,
  );
  const base = last.rows[0]?.first_kickoff_at
    ? new Date(last.rows[0].first_kickoff_at)
    : new Date();

  let sortOrder = 1;
  for (const spec of ROUNDS) {
    for (let leg = 1; leg <= spec.legs; leg++) {
      const id = matchweekId(spec.stage, leg, spec.legs);
      const kickoff = new Date(base.getTime());
      kickoff.setUTCDate(kickoff.getUTCDate() + (spec.weekOffset + (leg - 1)) * 7);
      await run(
        `INSERT INTO matchweeks (id, act, sort_order, label, status, first_kickoff_at)
         VALUES ($1, 'knockout', $2, $3, 'upcoming', $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, sortOrder, matchweekLabel(spec, leg), kickoff],
      );
      sortOrder++;
    }
  }
}

export async function firstKnockoutMatchweekId(): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM matchweeks WHERE act = 'knockout' ORDER BY sort_order LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * Whether the season has an ending yet: the final's own matchweek is complete.
 *
 * The id comes from `matchweekId`, which drops the leg suffix for a one-legged
 * round, so the final's week is literally 'final'. Everything that wants to
 * know lives on the other side of this function rather than spelling the id out
 * for itself, because the id scheme belongs here.
 */
export async function isSeasonComplete(): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM matchweeks WHERE id = $1 AND status = 'complete'`,
    [matchweekId('final', 1, 1)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Builds the play-off ties from ranks 9-24 and their two legs (§2.4), but only
 * when the bracket is ours to draw. Under a real provider the matchweeks are
 * still made ready here, and UEFA's own draw fills them through the sync.
 */
export async function createPlayoffRound(standings: StandingRow[]): Promise<void> {
  await ensureKnockoutMatchweeks();
  if (!(await bracketIsOursToDraw())) return;
  const seeds = standings.filter((r) => r.rank >= 9 && r.rank <= 24);
  if (seeds.length < 2) return;
  await createTies('playoff', pairSeeds(seeds).map(([a, b]) => [a.teamId, b.teamId]));
}

/** Creates the ties for a stage plus a match row per leg. */
async function createTies(stage: Stage, pairs: [string, string][]): Promise<void> {
  const spec = ROUNDS.find((r) => r.stage === stage)!;
  await withTransaction(async (client) => {
    for (const [slot, [homeTeamId, awayTeamId]] of pairs.entries()) {
      const existing = await client.query('SELECT 1 FROM knockout_ties WHERE stage = $1 AND slot = $2', [
        stage,
        slot,
      ]);
      if (existing.rowCount) continue;

      const tie = await client.query<{ id: string }>(
        `INSERT INTO knockout_ties (stage, slot, home_team_id, away_team_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [stage, slot, homeTeamId, awayTeamId],
      );
      const tieId = tie.rows[0]!.id;

      for (let leg = 1; leg <= spec.legs; leg++) {
        const mwId = matchweekId(stage, leg, spec.legs);
        const mw = await client.query<{ first_kickoff_at: Date | null }>(
          'SELECT first_kickoff_at FROM matchweeks WHERE id = $1',
          [mwId],
        );
        const kickoff = mw.rows[0]?.first_kickoff_at ?? new Date();
        // The lower seed hosts the first leg; sides swap for the second.
        const legHome = leg === 1 ? awayTeamId : homeTeamId;
        const legAway = leg === 1 ? homeTeamId : awayTeamId;
        await client.query(
          `INSERT INTO matches (stage, matchweek_id, leg, kickoff_at, status, home_team_id, away_team_id, tie_id, external_id)
           VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)`,
          [
            stage,
            mwId,
            spec.legs === 1 ? null : leg,
            kickoff,
            legHome,
            legAway,
            tieId,
            `mock:ko:${tieId}:${leg}`,
          ],
        );
      }
    }
  });
}

/**
 * The tie a provider-drawn pair belongs to, created on first sight.
 *
 * Slots are handed out in the order ties are seen rather than by seeding,
 * because a published draw has no seeding for us to read. The slot only has to
 * be unique within the stage, which is all the schema asks of it.
 */
export async function findOrCreateTie(
  client: PoolClient,
  stage: Stage,
  teamA: string,
  teamB: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM knockout_ties
     WHERE stage = $1 AND ((home_team_id = $2 AND away_team_id = $3)
                        OR (home_team_id = $3 AND away_team_id = $2))`,
    [stage, teamA, teamB],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO knockout_ties (stage, slot, home_team_id, away_team_id)
     VALUES ($1, (SELECT coalesce(max(slot) + 1, 0) FROM knockout_ties WHERE stage = $1), $2, $3)
     RETURNING id`,
    [stage, teamA, teamB],
  );
  return inserted.rows[0]!.id;
}

interface OpenTie {
  id: string;
  stage: Stage;
  slot: number;
  home_team_id: string;
  away_team_id: string;
}

/**
 * Settle every tie whose legs are all played: record the winner, award
 * `round_advance`, eliminate the loser, and once a whole stage is done build the
 * next one. The final also pays the medals.
 */
export async function settleKnockoutTies(): Promise<{ settled: number }> {
  const { rows: open } = await query<OpenTie>(
    `SELECT t.id, t.stage, t.slot, t.home_team_id, t.away_team_id
     FROM knockout_ties t
     WHERE t.settled_at IS NULL AND t.home_team_id IS NOT NULL AND t.away_team_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM matches m
         WHERE m.tie_id = t.id AND m.status <> 'finished'
       )
       AND EXISTS (SELECT 1 FROM matches m WHERE m.tie_id = t.id)`,
  );

  let settled = 0;
  for (const tie of open) {
    const { rows: legRows } = await query<{
      home_team_id: string;
      away_team_id: string;
      home_score: number | null;
      away_score: number | null;
      matchweek_id: string;
    }>(
      `SELECT home_team_id, away_team_id, home_score, away_score, matchweek_id
       FROM matches WHERE tie_id = $1 ORDER BY kickoff_at`,
      [tie.id],
    );
    if (legRows.some((l) => l.home_score === null || l.away_score === null)) continue;

    const legs: TieLeg[] = legRows.map((l) => ({
      homeTeamId: l.home_team_id,
      awayTeamId: l.away_team_id,
      homeScore: l.home_score!,
      awayScore: l.away_score!,
    }));
    const result = resolveTie(legs, tie.home_team_id, tie.away_team_id, tie.id);
    const decidingMatchweek = legRows.at(-1)!.matchweek_id;

    await withTransaction(async (client) => {
      await client.query(
        'UPDATE knockout_ties SET winner_team_id = $1, settled_at = now() WHERE id = $2',
        [result.winnerTeamId, tie.id],
      );
      // The loser's run ends here (§2.5). The beaten finalist stays in for the
      // silver medal, which is awarded on this same matchweek.
      await client.query('UPDATE teams SET eliminated_at = now() WHERE id = $1 AND eliminated_at IS NULL', [
        result.loserTeamId,
      ]);

      if (tie.stage === 'final') {
        await awardRule(client, result.winnerTeamId, 'gold_medal', decidingMatchweek, `medal:gold:${tie.id}`);
        await awardRule(client, result.loserTeamId, 'silver_medal', decidingMatchweek, `medal:silver:${tie.id}`);
      } else {
        await awardRule(
          client,
          result.winnerTeamId,
          'round_advance',
          decidingMatchweek,
          `advance:${tie.id}`,
        );
      }
    });
    settled++;
  }

  if (settled > 0) await buildNextStages();
  return { settled };
}

/** Per-pot rule value written as a club-layer entry, attributed to a matchweek. */
async function awardRule(
  client: PoolClient,
  teamId: string,
  ruleCode: string,
  matchweekId: string,
  sourceKey: string,
): Promise<void> {
  const { rows } = await client.query<{ points: number }>(
    `SELECT r.points FROM tier_scoring_rules r
     JOIN teams t ON t.tier_id = r.tier_id
     WHERE t.id = $1 AND r.rule_code = $2`,
    [teamId, ruleCode],
  );
  const points = rows[0]?.points ?? 0;
  if (!points) return;
  await client.query(
    `INSERT INTO team_point_entries (team_id, match_id, matchweek_id, rule_code, points, source_key, metadata)
     VALUES ($1, NULL, $2, $3, $4, $5, '{}'::jsonb)
     ON CONFLICT (source_key) DO UPDATE SET points = EXCLUDED.points`,
    [teamId, matchweekId, ruleCode, points, sourceKey],
  );
}

/** Once every tie in a stage is settled, seed the following stage. */
async function buildNextStages(): Promise<void> {
  if (!(await bracketIsOursToDraw())) return;
  for (const spec of ROUNDS) {
    const next = NEXT_STAGE[spec.stage];
    if (!next) continue;

    const { rows: ties } = await query<{ slot: number; winner_team_id: string | null }>(
      'SELECT slot, winner_team_id FROM knockout_ties WHERE stage = $1 ORDER BY slot',
      [spec.stage],
    );
    if (!ties.length || ties.some((t) => !t.winner_team_id)) continue;

    const already = await query('SELECT 1 FROM knockout_ties WHERE stage = $1 LIMIT 1', [next]);
    if (already.rowCount) continue;

    const winners = ties.map((t) => t.winner_team_id!);
    let seeds: string[];
    if (next === 'r16') {
      // The eight clubs that skipped the play-offs join here, seeded first.
      const top = await query<{ id: string }>(
        'SELECT id FROM teams WHERE league_rank BETWEEN 1 AND 8 ORDER BY league_rank',
      );
      seeds = [...top.rows.map((r) => r.id), ...winners];
    } else {
      seeds = winners;
    }
    if (seeds.length < 2) continue;
    await createTies(next, pairSeeds(seeds));
  }
}
