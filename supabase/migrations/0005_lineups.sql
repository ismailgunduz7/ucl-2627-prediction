-- Phase 4 — weekly lineups + participant matchweek scoring (PLAN.md §3.5, §4.1, §8.1).

-- matchweek_lineups --------------------------------------------------------
-- One bench + one captain per user per matchweek. The four permanent clubs are
-- fixed; only bench/captain (and later jokers) change weekly. Team references
-- are validated against the user's effective squad by the lineup-service.
CREATE TABLE matchweek_lineups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  matchweek_id   text NOT NULL REFERENCES matchweeks (id),
  bench_team_id  uuid NOT NULL REFERENCES teams (id),
  captain_team_id uuid NOT NULL REFERENCES teams (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matchweek_lineups_unique UNIQUE (user_id, matchweek_id)
);

CREATE INDEX matchweek_lineups_user_idx ON matchweek_lineups (user_id);

CREATE TRIGGER matchweek_lineups_set_updated_at
  BEFORE UPDATE ON matchweek_lineups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- player_matchday_scores ---------------------------------------------------
-- Final (completed) participant week totals (§4.3 Option A). Live provisional is
-- computed on read and is NOT stored here.
CREATE TABLE player_matchday_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  matchweek_id   text NOT NULL REFERENCES matchweeks (id),
  points         integer NOT NULL,
  breakdown      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_matchday_scores_unique UNIQUE (user_id, matchweek_id)
);

CREATE INDEX player_matchday_scores_user_idx ON player_matchday_scores (user_id);
CREATE INDEX player_matchday_scores_mw_idx ON player_matchday_scores (matchweek_id);

CREATE TRIGGER player_matchday_scores_set_updated_at
  BEFORE UPDATE ON player_matchday_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
