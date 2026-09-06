import { query } from '../db/pool.ts';

/**
 * Deciding who runs a background job, and when (§5.2, §12).
 *
 * On a host that sleeps between requests there is no process to hold a timer,
 * so an external cron pings the server instead. That ping knows nothing about
 * when the job last ran, and a platform answering one ping with several
 * instances may ask more than once at a time.
 *
 * `job_runs.last_run_at` is the whole answer to both. The conditional update
 * hands the job to exactly one caller and only when it is actually due, because
 * the UPDATE takes a row lock. An in-process timer and an external cron can
 * therefore be pointed at the same server without doubling the provider's load.
 */

export type BackgroundJob = 'provider_sync' | 'token_sweep';

/** True when this caller may run the job and nobody else will for the interval. */
export async function claimJob(job: BackgroundJob, minIntervalMs: number): Promise<boolean> {
  const { rowCount } = await query(
    `INSERT INTO job_runs (job, last_run_at) VALUES ($1, now())
     ON CONFLICT (job) DO UPDATE SET last_run_at = now()
     WHERE job_runs.last_run_at < now() - make_interval(secs => $2::double precision)
     RETURNING job`,
    [job, minIntervalMs / 1000],
  );
  return (rowCount ?? 0) > 0;
}

/** When the job last ran, whoever ran it. Null if it never has. */
export async function lastJobRun(job: BackgroundJob): Promise<Date | null> {
  const { rows } = await query<{ last_run_at: Date }>(
    'SELECT last_run_at FROM job_runs WHERE job = $1',
    [job],
  );
  return rows[0] ? new Date(rows[0].last_run_at) : null;
}
