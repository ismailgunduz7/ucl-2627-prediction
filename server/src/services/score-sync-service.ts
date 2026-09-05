import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.ts';
import type { ScoreProvider, ProviderFixture } from './score-provider.ts';
import { mockProvider } from './mock-provider.ts';
import { footballDataProvider } from './football-data-provider.ts';
import { getConfigValue } from './tournament-config-service.ts';
import { clearMatchLinesInTx, scoreFinishedMatchInTx } from './scoring-service.ts';
import { refreshMatchweekLifecycle } from './matchweek-lifecycle-service.ts';
import { progressSeason } from './act-service.ts';
import {
  ensureKnockoutMatchweeks,
  findOrCreateTie,
  isKnockoutStage,
  knockoutMatchweekId,
} from './knockout-service.ts';
import { groupKnockoutFixtures, type DrawFixture } from '../domain/knockout-draw.ts';

export function providerByName(name: string): ScoreProvider {
  return name === 'football_data' ? footballDataProvider : mockProvider;
}

/** Resolve the active provider from config (default mock for the mockup). */
export async function resolveProvider(explicit?: string): Promise<ScoreProvider> {
  if (explicit) return providerByName(explicit);
  const configured = await getConfigValue('sync_provider');
  return providerByName(configured);
}

export type SyncTrigger = 'manual' | 'scheduled';

export interface SyncSummary {
  provider: string;
  fixturesSeen: number;
  /** Fixtures the provider published that we did not have yet (§2.4). */
  matchesCreated: number;
  matchesUpserted: number;
  matchesFinished: number;
  skippedOverride: number;
  unmapped: number;
}

interface LocalMatchRow {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  is_manual_override: boolean;
}

// Only one sync may touch the database at a time: the scheduled job and an
// admin hitting "sync" would otherwise score the same finished match twice.
// Callers queue behind each other instead of racing.
let syncChain: Promise<unknown> = Promise.resolve();

export interface SyncOptions {
  providerName?: string;
  simulatedNow?: Date;
  trigger?: SyncTrigger;
}

/**
 * Run a sync pass (§5.2). Provider fetch happens outside the DB transaction;
 * all writes (upsert, scoring on finish, matchweek lifecycle) happen inside one
 * transaction. Manual-override matches are left untouched (§5.3).
 */
export function runSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  const run = syncChain.then(() => runSyncPass(opts), () => runSyncPass(opts));
  syncChain = run.catch(() => undefined);
  return run;
}

async function runSyncPass(opts: SyncOptions): Promise<SyncSummary> {
  const startedAt = new Date();
  const provider = await resolveProvider(opts.providerName);

  let summary: SyncSummary = {
    provider: provider.name,
    fixturesSeen: 0,
    matchesCreated: 0,
    matchesUpserted: 0,
    matchesFinished: 0,
    skippedOverride: 0,
    unmapped: 0,
  };

  try {
    const fixtures = await provider.fetchFixtures({ simulatedNow: opts.simulatedNow });
    summary.fixturesSeen = fixtures.length;

    await withTransaction(async (client) => {
      // A published draw arrives as fixtures we have never seen. Create them
      // before the update pass so this run already scores them.
      summary.matchesCreated = await createNewFixtures(client, fixtures);

      // Pre-load local matches by external id for the fixtures we received.
      const externalIds = fixtures.map((f) => f.externalId);
      const localRes = await client.query<LocalMatchRow & { external_id: string }>(
        `SELECT id, external_id, status, home_score, away_score, is_manual_override
         FROM matches WHERE external_id = ANY($1::text[])`,
        [externalIds],
      );
      const localByExternal = new Map(localRes.rows.map((r) => [r.external_id, r]));

      for (const fx of fixtures) {
        const local = localByExternal.get(fx.externalId);
        if (!local) {
          // Creation above could not place it: either a club that carries no
          // provider id, or a matchday with no matchweek to put it in. Counted
          // rather than guessed at, so the admin page can show it.
          summary.unmapped++;
          continue;
        }
        if (local.is_manual_override) {
          summary.skippedOverride++;
          continue;
        }

        await applyFixture(client, local, fx, summary);
      }

      await refreshMatchweekLifecycle(client);
    });

    // After commit: close the league act, settle knockout ties, then finalize.
    await progressSeason();

    await recordRun(startedAt, 'success', summary, null, opts.trigger ?? 'manual');
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun(startedAt, 'error', summary, message, opts.trigger ?? 'manual');
    throw err;
  }
}

/**
 * Create the fixtures the provider has published that we do not hold yet.
 *
 * This is how the knockout arrives. UEFA draws it months after the season is
 * seeded, so there is nothing to map it onto until the provider says who plays
 * whom; the alternative is an admin typing sixty fixtures in by hand.
 *
 * League fixtures land in the matchweek their matchday names. Knockout
 * fixtures are first grouped into ties, because a round is settled on aggregate
 * and the provider publishes two unrelated-looking matches instead of a tie.
 *
 * A fixture naming a club we never mapped is left alone and counted unmapped,
 * the same as before. Creating a match for it is impossible, and guessing is
 * worse than reporting.
 */
async function createNewFixtures(
  client: PoolClient,
  fixtures: ProviderFixture[],
): Promise<number> {
  const known = await client.query<{ external_id: string }>(
    `SELECT external_id FROM matches WHERE external_id = ANY($1::text[])`,
    [fixtures.map((f) => f.externalId)],
  );
  const seen = new Set(known.rows.map((r) => r.external_id));
  const fresh = fixtures.filter((f) => !seen.has(f.externalId));
  if (fresh.length === 0) return 0;

  const teams = await client.query<{ id: string; external_id: string }>(
    'SELECT id, external_id FROM teams WHERE external_id IS NOT NULL',
  );
  const teamByExternal = new Map(teams.rows.map((t) => [t.external_id, t.id]));

  const weeks = await client.query<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM matchweeks WHERE act = 'league_phase'`,
  );
  const leagueWeekByMatchday = new Map(weeks.rows.map((w) => [w.sort_order, w.id]));

  let created = 0;
  const knockout: DrawFixture[] = [];

  for (const f of fresh) {
    const homeTeamId = teamByExternal.get(f.homeTeamExternalId);
    const awayTeamId = teamByExternal.get(f.awayTeamExternalId);
    if (!homeTeamId || !awayTeamId) continue; // counted as unmapped below

    if (isKnockoutStage(f.stage)) {
      knockout.push({
        externalId: f.externalId,
        homeTeamId,
        awayTeamId,
        kickoffAt: f.kickoffAt,
        stage: f.stage,
      });
      continue;
    }

    const matchweekId = f.matchday === null ? undefined : leagueWeekByMatchday.get(f.matchday);
    if (!matchweekId) continue;
    await insertMatch(client, {
      externalId: f.externalId,
      stage: 'league_phase',
      matchweekId,
      leg: null,
      kickoffAt: f.kickoffAt,
      status: f.status,
      homeTeamId,
      awayTeamId,
      tieId: null,
    });
    created++;
  }

  if (knockout.length > 0) {
    await ensureKnockoutMatchweeks(client);
    for (const tie of groupKnockoutFixtures(knockout)) {
      if (!isKnockoutStage(tie.stage)) continue;
      const tieId = await findOrCreateTie(client, tie.stage, tie.teamA, tie.teamB);
      for (const { fixture, leg } of tie.legs) {
        const matchweekId = knockoutMatchweekId(tie.stage, leg);
        if (!matchweekId) continue;
        const source = fresh.find((f) => f.externalId === fixture.externalId)!;
        await insertMatch(client, {
          externalId: fixture.externalId,
          stage: tie.stage,
          matchweekId,
          leg: tie.legs.length === 1 ? null : leg,
          kickoffAt: fixture.kickoffAt,
          status: source.status,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          tieId,
        });
        created++;
      }
    }
  }

  return created;
}

interface NewMatch {
  externalId: string;
  stage: string;
  matchweekId: string;
  leg: number | null;
  kickoffAt: Date;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  tieId: string | null;
}

/** Scores are left off on purpose: the update pass right after fills them in. */
async function insertMatch(client: PoolClient, m: NewMatch): Promise<void> {
  await client.query(
    `INSERT INTO matches (external_id, stage, matchweek_id, leg, kickoff_at, status,
                          home_team_id, away_team_id, tie_id)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8)
     ON CONFLICT (external_id) DO NOTHING`,
    [m.externalId, m.stage, m.matchweekId, m.leg, m.kickoffAt, m.homeTeamId, m.awayTeamId, m.tieId],
  );
}

async function applyFixture(
  client: Parameters<typeof scoreFinishedMatchInTx>[0],
  local: LocalMatchRow,
  fx: ProviderFixture,
  summary: SyncSummary,
): Promise<void> {
  const scoreChanged = local.home_score !== fx.homeScore || local.away_score !== fx.awayScore;
  const statusChanged = local.status !== fx.status;
  if (!scoreChanged && !statusChanged) return; // nothing to do

  await client.query(
    `UPDATE matches
     SET kickoff_at = $1, status = $2, home_score = $3, away_score = $4, stage = $5, updated_at = now()
     WHERE id = $6`,
    [fx.kickoffAt, fx.status, fx.homeScore, fx.awayScore, fx.stage, local.id],
  );
  summary.matchesUpserted++;

  // Reconcile club-layer lines with the new status (§4.3 Option A: finished only).
  if (fx.status === 'finished') {
    const scored = await scoreFinishedMatchInTx(client, local.id);
    if (scored && local.status !== 'finished') summary.matchesFinished++;
  } else if (local.status === 'finished') {
    // Reverted away from finished → remove its definitive lines.
    await clearMatchLinesInTx(client, local.id);
  }
}

async function recordRun(
  startedAt: Date,
  status: 'success' | 'error',
  summary: SyncSummary,
  error: string | null,
  trigger: SyncTrigger,
): Promise<void> {
  await query(
    `INSERT INTO sync_runs
       (provider, status, started_at, fixtures_seen, matches_upserted, matches_finished, error, trigger)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      summary.provider,
      status,
      startedAt,
      summary.fixturesSeen,
      summary.matchesUpserted,
      summary.matchesFinished,
      error,
      trigger,
    ],
  );
}

export interface SyncRunRow {
  id: string;
  provider: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string;
  fixtures_seen: number;
  matches_upserted: number;
  matches_finished: number;
  error: string | null;
}

export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  const { rows } = await query<SyncRunRow>(
    `SELECT id, provider, status, trigger, started_at, finished_at,
            fixtures_seen, matches_upserted, matches_finished, error
     FROM sync_runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
