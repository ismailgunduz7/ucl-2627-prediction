-- Phase 2: club-layer scoring (PLAN.md §4.2, §8.1).
-- Rule types + per-pot values + definitive point entries for finished matches
-- (Option A: finished rows only; live provisional is computed on read, §4.3).

-- scoring_rule_types -------------------------------------------------------
-- `direction` drives the monotonic seed check (§16): reward values must be
-- non-decreasing Pot 1 -> Pot 4 (weaker pot rewarded more); penalty values are
-- also non-decreasing (Pot 1 most negative -> toward 0); flat must be equal.
CREATE TABLE scoring_rule_types (
  code        text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('match', 'league', 'knockout')),
  label       text NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('reward', 'penalty', 'flat')),
  sort_order  integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

-- tier_scoring_rules (per-pot values) --------------------------------------
CREATE TABLE tier_scoring_rules (
  tier_id     smallint NOT NULL REFERENCES tiers (id) ON DELETE CASCADE,
  rule_code   text NOT NULL REFERENCES scoring_rule_types (code) ON DELETE CASCADE,
  points      integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tier_id, rule_code)
);

CREATE TRIGGER tier_scoring_rules_set_updated_at
  BEFORE UPDATE ON tier_scoring_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- team_point_entries -------------------------------------------------------
-- Definitive club-layer lines. Written only for finished matches (and, from
-- Phase 6, one-time bonuses like league_top8_bonus with a null match_id).
-- `matchweek_id` is stored directly so bonus lines (no match) can still be
-- attributed to a week, and per-week club scoring is a simple filter.
-- `source_key` makes scoring idempotent (upsert on conflict) for recalc (§4.7).
CREATE TABLE team_point_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  match_id      uuid REFERENCES matches (id) ON DELETE CASCADE,
  matchweek_id  text NOT NULL REFERENCES matchweeks (id),
  rule_code     text NOT NULL REFERENCES scoring_rule_types (code),
  points        integer NOT NULL,
  source_key    text NOT NULL UNIQUE,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_point_entries_team_idx ON team_point_entries (team_id);
CREATE INDEX team_point_entries_match_idx ON team_point_entries (match_id);
CREATE INDEX team_point_entries_matchweek_idx ON team_point_entries (matchweek_id);
