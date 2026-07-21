import { query, withTransaction } from '../db/pool.ts';
import type { ScoreProvider, ProviderFixture } from './score-provider.ts';
import { mockProvider } from './mock-provider.ts';
import { footballDataProvider } from './football-data-provider.ts';
import { getConfigValue } from './tournament-config-service.ts';
import { clearMatchLinesInTx, scoreFinishedMatchInTx } from './scoring-service.ts';

export function providerByName(name: string): ScoreProvider {
  return name === 'football_data' ? footballDataProvider : mockProvider;
}

/** Resolve the active provider from config (default mock for the mockup). */
export async function resolveProvider(explicit?: string): Promise<ScoreProvider> {
  if (explicit) return providerByName(explicit);
  const configured = await getConfigValue('sync_provider');
  return providerByName(configured);
}

export interface SyncSummary {
  provider: string;
  fixturesSeen: number;
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

/**
 * Run a sync pass (§5.2). Provider fetch happens outside the DB transaction;
 * all writes (upsert, scoring on finish, matchweek lifecycle) happen inside one
 * transaction. Manual-override matches are left untouched (§5.3).
 */
export async function runSync(opts: {
  providerName?: string;
  simulatedNow?: Date;
} = {}): Promise<SyncSummary> {
  const startedAt = new Date();
  const provider = await resolveProvider(opts.providerName);

  let summary: SyncSummary = {
    provider: provider.name,
    fixturesSeen: 0,
    matchesUpserted: 0,
    matchesFinished: 0,
    skippedOverride: 0,
    unmapped: 0,
  };

  try {
    const fixtures = await provider.fetchFixtures({ simulatedNow: opts.simulatedNow });
    summary.fixturesSeen = fixtures.length;

    await withTransaction(async (client) => {
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
          // Real-provider fixtures for un-mapped teams/matches are ignored in the
          // mockup; production seeding maps external ids before enabling it.
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

    await recordRun(startedAt, 'success', summary, null);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun(startedAt, 'error', summary, message);
    throw err;
  }
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

/**
 * Recompute matchweek denormalized state (§3.4, §4.6):
 * 1. first_kickoff_at for weeks not yet started (upcoming/open) — never moves a
 *    started week's lock.
 * 2. mark in_progress once any match is live/finished.
 * 3. mark complete when every match is finished/cancelled.
 */
async function refreshMatchweekLifecycle(
  client: Parameters<typeof scoreFinishedMatchInTx>[0],
): Promise<void> {
  await client.query(
    `UPDATE matchweeks mw
     SET first_kickoff_at = sub.mk, updated_at = now()
     FROM (SELECT matchweek_id, min(kickoff_at) AS mk FROM matches GROUP BY matchweek_id) sub
     WHERE mw.id = sub.matchweek_id AND mw.status IN ('upcoming', 'open')`,
  );
  await client.query(
    `UPDATE matchweeks SET status = 'in_progress', updated_at = now()
     WHERE status IN ('upcoming', 'open')
       AND id IN (SELECT matchweek_id FROM matches WHERE status IN ('live', 'finished'))`,
  );
  await client.query(
    `UPDATE matchweeks mw SET status = 'complete', completed_at = now(), updated_at = now()
     WHERE mw.status <> 'complete'
       AND EXISTS (SELECT 1 FROM matches m WHERE m.matchweek_id = mw.id)
       AND NOT EXISTS (
         SELECT 1 FROM matches m
         WHERE m.matchweek_id = mw.id AND m.status NOT IN ('finished', 'cancelled')
       )`,
  );
}

async function recordRun(
  startedAt: Date,
  status: 'success' | 'error',
  summary: SyncSummary,
  error: string | null,
): Promise<void> {
  await query(
    `INSERT INTO sync_runs
       (provider, status, started_at, fixtures_seen, matches_upserted, matches_finished, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      summary.provider,
      status,
      startedAt,
      summary.fixturesSeen,
      summary.matchesUpserted,
      summary.matchesFinished,
      error,
    ],
  );
}

export interface SyncRunRow {
  id: string;
  provider: string;
  status: string;
  started_at: string;
  finished_at: string;
  fixtures_seen: number;
  matches_upserted: number;
  matches_finished: number;
  error: string | null;
}

export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  const { rows } = await query<SyncRunRow>(
    `SELECT id, provider, status, started_at, finished_at,
            fixtures_seen, matches_upserted, matches_finished, error
     FROM sync_runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
