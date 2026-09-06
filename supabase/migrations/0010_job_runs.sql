-- Phase 7: a claim table for the jobs an outside clock drives (§5.2, §12).
--
-- On a host that sleeps between requests there is no process to hold a timer,
-- so an external cron pings the server instead. That ping has no idea when the
-- job last ran, and on a platform that answers one ping with several instances
-- there may be more than one asking at once.
--
-- The conditional update below answers both: a caller only gets a row back when
-- the job is actually due, and exactly one caller can win that race, because
-- the UPDATE takes a row lock. `last_run_at` is the whole state.

CREATE TABLE job_runs (
  job         text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now()
);
