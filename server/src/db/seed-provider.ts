/**
 * Point the season at football-data.org (§5.1, PLAN §0).
 *
 * Two stages, in this order because the second needs the first:
 *
 *   1. Stamp `fd:<id>` onto all 36 clubs, matched by name, plus their crests.
 *   2. Replace the randomly drawn league fixtures with the real ones, each
 *      carrying `fd:<match id>` and the kickoff the provider publishes.
 *
 * Nothing is written unless every club matches. A club left unmapped is a club
 * whose scores never arrive, and a half-mapped field is worse than none, so a
 * failure here prints what it could not resolve and touches nothing.
 *
 * Knockout fixtures are deliberately not seeded. UEFA draws them months later,
 * and the sync creates them from the provider the moment they are published.
 *
 * Finally it switches the configured provider over, because the mock reports
 * only on `mock:` fixtures and there are none left once this has run.
 *
 * Re-runnable while the season has not started. Once any club has scored,
 * re-seeding the fixtures would strand those points, so it refuses; reset the
 * season with `SEED_FORCE=1 npm run seed:domain` first.
 */
import type { PoolClient } from 'pg';
import { withTransaction, query, closePool } from './pool.ts';
import { matchClubs, type ProviderClub } from '../domain/club-matching.ts';
import { PROVIDER_CLUB_ALIASES } from '../data/provider-aliases.ts';
import {
  fetchFootballDataClubs,
  fetchFootballDataMatches,
  toProviderFixture,
} from '../services/football-data-provider.ts';
import { refreshMatchweekLifecycle } from '../services/matchweek-lifecycle-service.ts';
import { setConfigValue } from '../services/tournament-config-service.ts';

interface TeamRow {
  id: string;
  name: string;
}

/** Refuses to run once the season has produced anything worth keeping. */
async function assertSeasonNotStarted(): Promise<void> {
  const points = await query<{ n: string }>(
    'SELECT count(*)::text AS n FROM team_point_entries',
  );
  if (Number(points.rows[0]!.n) > 0) {
    throw new Error(
      'the season has already scored points. Reset it first:\n' +
        '  SEED_FORCE=1 npm run seed:domain --workspace server',
    );
  }
}

async function mapClubs(client: PoolClient): Promise<number> {
  const theirs = await fetchFootballDataClubs();
  console.log(`Provider lists ${theirs.length} clubs.`);

  const { rows: ours } = await client.query<TeamRow>('SELECT id, name FROM teams ORDER BY name');
  if (ours.length === 0) {
    throw new Error('no clubs in the database. Run `npm run seed:domain` first.');
  }

  const result = matchClubs(
    ours,
    theirs as ProviderClub[],
    PROVIDER_CLUB_ALIASES,
  );

  if (result.staleAliases.length > 0) {
    console.error('\nAliases naming a club the provider no longer lists:');
    for (const a of result.staleAliases) console.error(`  ${a}`);
  }
  if (result.collisions.length > 0) {
    console.error('\nSeveral of our clubs resolved to one provider club:');
    for (const c of result.collisions) {
      console.error(`  ${c.providerName} <- ${c.clubNames.join(', ')}`);
    }
  }
  if (result.unmatched.length > 0) {
    console.error('\nNo provider club answered to:');
    for (const u of result.unmatched) console.error(`  ${u.club.name}  (looked for "${u.key}")`);
    console.error('\nAdd the provider\'s exact name to data/provider-aliases.ts for each.');
  }
  if (result.unmatched.length || result.collisions.length || result.staleAliases.length) {
    throw new Error('club mapping is incomplete, nothing was written');
  }

  const crestById = new Map(theirs.map((t) => [t.id, t.crest]));
  for (const m of result.matched) {
    await client.query('UPDATE teams SET external_id = $1, crest_url = $2 WHERE id = $3', [
      `fd:${m.providerId}`,
      crestById.get(m.providerId) ?? null,
      m.club.id,
    ]);
  }

  const viaAlias = result.matched.filter((m) => m.viaAlias);
  console.log(`Mapped ${result.matched.length} clubs onto provider ids.`);
  for (const m of viaAlias) {
    console.log(`  by alias: ${m.club.name} -> ${m.providerName}`);
  }
  return result.matched.length;
}

async function seedLeagueFixtures(client: PoolClient): Promise<number> {
  const fixtures = (await fetchFootballDataMatches())
    .map(toProviderFixture)
    .filter((f) => f.stage === 'league_phase');
  console.log(`Provider lists ${fixtures.length} league-phase fixtures.`);
  if (fixtures.length === 0) {
    throw new Error('the provider has no league-phase fixtures yet, nothing to seed');
  }

  const { rows: teams } = await client.query<{ id: string; external_id: string }>(
    'SELECT id, external_id FROM teams WHERE external_id IS NOT NULL',
  );
  const teamByExternal = new Map(teams.map((t) => [t.external_id, t.id]));

  const { rows: weeks } = await client.query<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM matchweeks WHERE act = 'league_phase' ORDER BY sort_order`,
  );
  const weekByMatchday = new Map(weeks.map((w) => [w.sort_order, w.id]));

  // Check every fixture resolves before deleting anything we cannot rebuild.
  for (const f of fixtures) {
    const home = teamByExternal.get(f.homeTeamExternalId);
    const away = teamByExternal.get(f.awayTeamExternalId);
    if (!home || !away) {
      throw new Error(`fixture ${f.externalId} names a club we did not map (${f.homeTeamExternalId} v ${f.awayTeamExternalId})`);
    }
    if (f.matchday === null || !weekByMatchday.has(f.matchday)) {
      throw new Error(`fixture ${f.externalId} is on matchday ${f.matchday}, which has no matchweek`);
    }
  }

  await client.query(`DELETE FROM matches WHERE stage = 'league_phase'`);
  for (const f of fixtures) {
    await client.query(
      `INSERT INTO matches (external_id, stage, matchweek_id, leg, kickoff_at, status,
                            home_team_id, away_team_id, home_score, away_score)
       VALUES ($1, 'league_phase', $2, NULL, $3, $4, $5, $6, $7, $8)`,
      [
        f.externalId,
        weekByMatchday.get(f.matchday!),
        f.kickoffAt,
        f.status,
        teamByExternal.get(f.homeTeamExternalId),
        teamByExternal.get(f.awayTeamExternalId),
        f.homeScore,
        f.awayScore,
      ],
    );
  }
  return fixtures.length;
}

async function main(): Promise<void> {
  await assertSeasonNotStarted();

  await withTransaction(async (client) => {
    await mapClubs(client);
    const count = await seedLeagueFixtures(client);
    await refreshMatchweekLifecycle(client);
    console.log(`Seeded ${count} real league fixtures.`);
  });

  // The mock only ever reports on `mock:` fixtures, and there are none left, so
  // leaving the season pointed at it would mean no provider drives it at all.
  await setConfigValue('sync_provider', 'football_data');
  console.log('Switched the score provider to football-data.org.');

  const first = await query<{ id: string; first_kickoff_at: Date | null }>(
    `SELECT id, first_kickoff_at FROM matchweeks
     WHERE act = 'league_phase' ORDER BY sort_order LIMIT 1`,
  );
  const kickoff = first.rows[0]?.first_kickoff_at;
  console.log(`${first.rows[0]?.id ?? 'MW1'} first kickoff: ${kickoff ? new Date(kickoff).toISOString() : 'unknown'}`);
  console.log('\n✓ Provider seed complete.');
  console.log('  Pull once from Yönetim → Skor Çekme and check that nothing comes back unmatched.');
}

main()
  .catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
