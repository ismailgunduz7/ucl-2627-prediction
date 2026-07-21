/**
 * Bootstrap seed: create the first admin account and a default competition.
 *
 * Since there is no public self-registration (§3.1), the very first admin must be
 * seeded so they can then create everyone else via the admin API.
 *
 * Configure via env (falls back to dev defaults — CHANGE THESE for production):
 *   SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD, SEED_ADMIN_DISPLAY_NAME,
 *   SEED_COMPETITION_NAME
 *
 * Idempotent: re-running does not duplicate the admin or the competition.
 */
import { query } from './pool.ts';
import { closePool } from './pool.ts';
import { hashPassword } from '../lib/password.ts';

async function main(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME ?? 'Yönetici';
  const competitionName = process.env.SEED_COMPETITION_NAME ?? 'Genel Lig';

  // Default competition (visibility scope only).
  const comp = await query<{ id: string }>(
    `INSERT INTO competitions (name)
     SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM competitions WHERE name = $1)
     RETURNING id`,
    [competitionName],
  );
  const compId =
    comp.rows[0]?.id ??
    (await query<{ id: string }>(`SELECT id FROM competitions WHERE name = $1`, [competitionName]))
      .rows[0]?.id;
  console.log(`Competition "${competitionName}" → ${compId}`);

  const existing = await query(`SELECT id FROM users WHERE lower(username) = lower($1)`, [username]);
  if (existing.rows.length > 0) {
    console.log(`Admin "${username}" already exists — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO users (username, password_hash, display_name, is_admin, competition_id)
     VALUES ($1, $2, $3, true, NULL)`,
    [username, passwordHash, displayName],
  );
  console.log(`✓ Created admin "${username}" (password: ${password})`);
  console.log('  → Change this password immediately in any real deployment.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
