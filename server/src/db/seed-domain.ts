/**
 * Domain seed for the 2026–27 season: pots and the REAL 36-club field from
 * UEFA's confirmed draw pots (data/teams-2627.ts), config defaults, the eight
 * league matchweeks on the REAL matchday calendar, and a random fixture list
 * drawn under the competition's own constraints in domain/schedule.ts (two
 * opponents per pot, one home one away, never a compatriot), standing in until
 * UEFA publishes the actual fixtures.
 *
 * Idempotent: skips if pots already exist. Re-run with SEED_FORCE=1 to wipe the
 * WHOLE season (matches, scores, lineups, jokers, predictions, transfers, the
 * knockout bracket and the sync log) while keeping user accounts. Squads must
 * be re-picked; joker inventories are re-granted at Act I; the act returns to
 * the league phase. SEED_DRAW_SEED=<n> reproduces a specific draw.
 */
import type { PoolClient } from 'pg';
import { withTransaction, query, closePool } from './pool.ts';
import { POTS_2627, POT_NAMES } from '../data/teams-2627.ts';
import {
  generateLeagueDraw,
  validateLeagueDraw,
  LEAGUE_ROUNDS,
  type DrawTeam,
} from '../domain/schedule.ts';
import { DEFAULT_CONFIG } from '../services/tournament-config-service.ts';
import { seedScoringRules } from './seed-rules.ts';

/**
 * The real league-phase calendar (UEFA, 26 Aug 2026). Kickoffs in UTC: 18:45 /
 * 21:00 CEST until the October clock change, CET afterwards. The final
 * matchday is played as one simultaneous round, like the real thing.
 */
const MATCHDAYS: { days: string[]; early: string; late: string; simultaneous?: boolean }[] = [
  { days: ['2026-09-08', '2026-09-09', '2026-09-10'], early: '16:45', late: '19:00' },
  { days: ['2026-10-13', '2026-10-14'], early: '16:45', late: '19:00' },
  { days: ['2026-10-20', '2026-10-21'], early: '16:45', late: '19:00' },
  { days: ['2026-11-03', '2026-11-04'], early: '17:45', late: '20:00' },
  { days: ['2026-11-24', '2026-11-25'], early: '17:45', late: '20:00' },
  { days: ['2026-12-08', '2026-12-09'], early: '17:45', late: '20:00' },
  { days: ['2027-01-19', '2027-01-20'], early: '17:45', late: '20:00' },
  { days: ['2027-01-27'], early: '20:00', late: '20:00', simultaneous: true },
];

/** Kickoff for match #idx (0-based) of matchweek `round` (1-based). */
function kickoffFor(round: number, idx: number): Date {
  const md = MATCHDAYS[round - 1]!;
  const perDay = Math.ceil(18 / md.days.length);
  const day = md.days[Math.min(Math.floor(idx / perDay), md.days.length - 1)]!;
  // Two early kickoffs per evening, the rest in the prime slot; the last
  // matchday kicks off everywhere at once.
  const time = md.simultaneous ? md.early : idx % perDay < 2 ? md.early : md.late;
  return new Date(`${day}T${time}:00.000Z`);
}

/** Everything a new season must not inherit. Accounts and config knobs stay. */
async function wipeSeason(client: PoolClient): Promise<void> {
  console.log('SEED_FORCE=1 → wiping the season (accounts and settings stay)...');
  await client.query(
    `TRUNCATE match_predictions, matchweek_lineups, joker_activations,
              player_matchday_scores, team_point_entries, act_transfers,
              match_override_audits, knockout_ties, matches, team_selections,
              sync_runs
     RESTART IDENTITY CASCADE`,
  );
  await client.query('DELETE FROM matchweeks');
  await client.query('DELETE FROM teams');
  await client.query('DELETE FROM tiers');
  // Back to Act I; other knobs (rule values, joker defaults, provider) stay.
  await client.query(
    `INSERT INTO tournament_config (key, value) VALUES ('current_act', '"league_phase"'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  );
}

/** Re-grant every participant the Act I joker inventory (§3.6). */
async function regrantJokers(client: PoolClient): Promise<void> {
  const cfg = await client.query<{ value: typeof DEFAULT_CONFIG.joker_inventory_defaults }>(
    `SELECT value FROM tournament_config WHERE key = 'joker_inventory_defaults'`,
  );
  const grant = cfg.rows[0]?.value.league_phase ?? DEFAULT_CONFIG.joker_inventory_defaults.league_phase;
  for (const [code, count] of Object.entries(grant)) {
    await client.query(
      `INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
       SELECT u.id, $1, $2 FROM users u WHERE NOT u.is_admin
       ON CONFLICT (user_id, joker_type_code)
       DO UPDATE SET remaining_count = EXCLUDED.remaining_count, updated_at = now()`,
      [code, count],
    );
  }
}

async function main(): Promise<void> {
  const existing = await query<{ count: string }>('SELECT count(*)::text AS count FROM tiers');
  const hasData = Number(existing.rows[0]?.count ?? '0') > 0;
  if (hasData && process.env.SEED_FORCE !== '1') {
    console.log('Domain already seeded (tiers exist). Use SEED_FORCE=1 to reseed.');
    return;
  }

  // Draw outside the transaction: pure computation, and a draw failure should
  // not leave a half-wiped season behind.
  const drawTeams: DrawTeam[] = ([1, 2, 3, 4] as const).flatMap((pot) =>
    POTS_2627[pot].map((t) => ({ pot, country: t.country })),
  );
  const drawSeed = process.env.SEED_DRAW_SEED
    ? Number(process.env.SEED_DRAW_SEED)
    : Math.floor(Math.random() * 2 ** 31);
  const schedule = generateLeagueDraw(drawTeams, drawSeed);
  const violations = validateLeagueDraw(drawTeams, schedule);
  if (violations.length > 0) {
    throw new Error(`draw failed its own validation:\n  - ${violations.join('\n  - ')}`);
  }

  await withTransaction(async (client) => {
    if (hasData) await wipeSeason(client);

    // 1. Pots (tiers)
    for (const pot of [1, 2, 3, 4] as const) {
      await client.query('INSERT INTO tiers (id, name, sort_order) VALUES ($1, $2, $1)', [
        pot,
        POT_NAMES[pot],
      ]);
    }

    // 2. Teams, flattened pot 1..4, the same order the draw was made in.
    const teamIds: string[] = [];
    for (const pot of [1, 2, 3, 4] as const) {
      for (const t of POTS_2627[pot]) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO teams (name, short_name, tier_id, country) VALUES ($1, $2, $3, $4) RETURNING id`,
          [t.name, t.shortName, pot, t.country],
        );
        teamIds.push(rows[0]!.id);
      }
    }
    console.log(`Seeded ${teamIds.length} clubs across 4 pots (2026–27 field).`);

    // 3. Config defaults (existing values win, so a reseed keeps admin tuning)
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
    for (let round = 1; round <= LEAGUE_ROUNDS; round++) {
      await client.query(
        `INSERT INTO matchweeks (id, act, sort_order, label, status)
         VALUES ($1, 'league_phase', $2, $3, 'upcoming')`,
        [`mw-${round}`, round, `Hafta ${round}`],
      );
    }

    // 5. Fixtures on the real matchday calendar; earliest kickoff per week.
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
    // Stable mock external ids so the mock provider can keep driving the season
    // through the same external_id path the real provider will use.
    await client.query(`UPDATE teams SET external_id = 'mock:' || id::text WHERE external_id IS NULL`);
    await client.query(`UPDATE matches SET external_id = 'mock:' || id::text WHERE external_id IS NULL`);

    // 7. Fresh Act I joker grant for every participant (§3.6).
    await regrantJokers(client);

    console.log(`Seeded ${schedule.length} fixtures across ${LEAGUE_ROUNDS} matchweeks (draw seed ${drawSeed}).`);
    console.log(`MW1 first kickoff: ${firstKickoff.get('mw-1')?.toISOString()}`);
  });

  console.log('✓ Domain seed complete.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
