/**
 * Domain seed (Phase 1 mockup): pots, 36 placeholder clubs, config defaults, the
 * 8 league-phase matchweeks, and a mock fixture list (circle-method schedule)
 * with kickoff times so lock logic and later scoring have real data to work on.
 *
 * Idempotent: skips if pots already exist. Re-run with SEED_FORCE=1 to wipe and
 * reseed the domain (this also clears user squads via cascade — dev only).
 *
 * The clubs and pot placement are PLACEHOLDER (see data/mock-teams.ts); reseed
 * after the official 2026–27 draw (§2.3).
 */
import { withTransaction, query, closePool } from './pool.ts';
import { MOCK_POTS, POT_NAMES } from '../data/mock-teams.ts';
import { generateLeagueSchedule } from '../domain/schedule.ts';
import { DEFAULT_CONFIG } from '../services/tournament-config-service.ts';
import { seedScoringRules } from './seed-rules.ts';

const LEAGUE_MATCHDAYS = 8;
// Mock MW1 first kickoff (UTC). Future-dated so the mock selection window is open.
const MW1_FIRST_KICKOFF = new Date('2026-09-15T16:45:00.000Z');

/** Kickoff for match #m (0-based) within matchweek `round` (1-based). */
function kickoffFor(round: number, matchIndex: number): Date {
  const weekOffsetMs = (round - 1) * 7 * 24 * 60 * 60 * 1000;
  const dayOffsetMs = (matchIndex < 9 ? 0 : 1) * 24 * 60 * 60 * 1000;
  const base = new Date(MW1_FIRST_KICKOFF.getTime() + weekOffsetMs + dayOffsetMs);
  // Alternate 16:45 / 19:00 UTC; keep match #0 at the earliest slot.
  const hour = matchIndex % 2 === 0 ? 16 : 19;
  const minute = matchIndex % 2 === 0 ? 45 : 0;
  base.setUTCHours(hour, minute, 0, 0);
  return base;
}

async function main(): Promise<void> {
  const existing = await query<{ count: string }>('SELECT count(*)::text AS count FROM tiers');
  const hasData = Number(existing.rows[0]?.count ?? '0') > 0;
  if (hasData && process.env.SEED_FORCE !== '1') {
    console.log('Domain already seeded (tiers exist). Use SEED_FORCE=1 to reseed.');
    return;
  }

  await withTransaction(async (client) => {
    if (hasData) {
      console.log('SEED_FORCE=1 → wiping domain (matches, matchweeks, teams, tiers)...');
      await client.query('TRUNCATE matches, team_selections RESTART IDENTITY CASCADE');
      await client.query('DELETE FROM matchweeks');
      await client.query('DELETE FROM teams');
      await client.query('DELETE FROM tiers');
    }

    // 1. Pots (tiers)
    for (const pot of [1, 2, 3, 4] as const) {
      await client.query('INSERT INTO tiers (id, name, sort_order) VALUES ($1, $2, $1)', [
        pot,
        POT_NAMES[pot],
      ]);
    }

    // 2. Teams (flattened pot 1..4 order → index 0..35 for the scheduler)
    const teamIds: string[] = [];
    for (const pot of [1, 2, 3, 4] as const) {
      for (const t of MOCK_POTS[pot]) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO teams (name, short_name, tier_id, country) VALUES ($1, $2, $3, $4) RETURNING id`,
          [t.name, t.shortName, pot, t.country],
        );
        teamIds.push(rows[0]!.id);
      }
    }
    console.log(`Seeded ${teamIds.length} teams across 4 pots.`);

    // 3. Config defaults
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      await client.query(
        `INSERT INTO tournament_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)],
      );
    }

    // 3b. Scoring rule types + per-pot values (§4.2, §16)
    await seedScoringRules(client);

    // 4. League matchweeks MW1..8
    for (let round = 1; round <= LEAGUE_MATCHDAYS; round++) {
      await client.query(
        `INSERT INTO matchweeks (id, act, sort_order, label, status)
         VALUES ($1, 'league_phase', $2, $3, 'upcoming')`,
        [`mw-${round}`, round, `Hafta ${round}`],
      );
    }

    // 5. Mock fixtures via circle method; track earliest kickoff per matchweek.
    const schedule = generateLeagueSchedule(teamIds.length, LEAGUE_MATCHDAYS);
    const firstKickoff = new Map<string, Date>();
    const perRoundIndex = new Map<number, number>();

    for (const fx of schedule) {
      const idx = perRoundIndex.get(fx.round) ?? 0;
      perRoundIndex.set(fx.round, idx + 1);
      const kickoff = kickoffFor(fx.round, idx);
      const mwId = `mw-${fx.round}`;
      await client.query(
        `INSERT INTO matches (stage, matchweek_id, kickoff_at, status, home_team_id, away_team_id)
         VALUES ('league_phase', $1, $2, 'scheduled', $3, $4)`,
        [mwId, kickoff, teamIds[fx.homeIndex], teamIds[fx.awayIndex]],
      );
      const prev = firstKickoff.get(mwId);
      if (!prev || kickoff < prev) firstKickoff.set(mwId, kickoff);
    }

    // 6. Denormalize first_kickoff_at onto each matchweek (§3.4).
    for (const [mwId, kickoff] of firstKickoff) {
      await client.query(
        `UPDATE matchweeks SET first_kickoff_at = $1, status = 'open' WHERE id = $2`,
        [kickoff, mwId],
      );
    }
    // Stable mock external ids so the mock provider (Phase 3) can map fixtures
    // back through the same external_id path the real provider uses.
    await client.query(`UPDATE teams SET external_id = 'mock:' || id::text WHERE external_id IS NULL`);
    await client.query(`UPDATE matches SET external_id = 'mock:' || id::text WHERE external_id IS NULL`);

    console.log(`Seeded ${schedule.length} mock fixtures across ${LEAGUE_MATCHDAYS} matchweeks.`);
    console.log(`MW1 first kickoff (mock): ${firstKickoff.get('mw-1')?.toISOString()}`);
  });

  console.log('✓ Domain seed complete.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
