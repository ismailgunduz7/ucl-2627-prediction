import pg from 'pg';
import { getEnv } from '../config/env.ts';

const { Pool } = pg;

// Store all timestamps as UTC. node-postgres parses `timestamptz` into JS Date
// objects (absolute instants), which is what we want for UTC-vs-UTC comparisons.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const { DATABASE_URL, NODE_ENV } = getEnv();
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Supabase and most managed Postgres require SSL; local usually does not.
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: NODE_ENV === 'production' ? 10 : 4,
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as any[]);
}

/** Runs `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
