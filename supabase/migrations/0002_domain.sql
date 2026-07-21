-- Phase 1 — domain skeleton (PLAN.md §8.1).
-- Pots (tiers), teams, matchweek registry, matches, admin-editable config, and
-- the permanent squad selection with server-enforced one-club-per-pot rules.

-- tiers (pots) -------------------------------------------------------------
-- Pot = scoring tier (§2.3). Small fixed set (Pot 1..4); id doubles as sort order.
CREATE TABLE tiers (
  id          smallint PRIMARY KEY,          -- 1..4
  name        text NOT NULL UNIQUE,          -- 'Pot 1'..'Pot 4'
  sort_order  smallint NOT NULL UNIQUE
);

-- teams --------------------------------------------------------------------
CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  short_name   text NOT NULL,
  tier_id      smallint NOT NULL REFERENCES tiers (id),
  external_id  text UNIQUE,                  -- provider id, filled by sync (Phase 3)
  crest_url    text,
  country      text,
  is_active    boolean NOT NULL DEFAULT true,
  eliminated_at timestamptz,                 -- set when the club exits (§2.5)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teams_tier_idx ON teams (tier_id);

-- Composite unique so team_selections can reference (team_id, tier_id) and thus
-- guarantee the denormalized pot on a selection always matches the club's pot.
ALTER TABLE teams ADD CONSTRAINT teams_id_tier_key UNIQUE (id, tier_id);

-- matchweeks ---------------------------------------------------------------
-- Explicit registry. `id` is a human-readable slug (e.g. 'mw-1', 'r16-leg1').
CREATE TABLE matchweeks (
  id                text PRIMARY KEY,
  act               text NOT NULL CHECK (act IN ('league_phase', 'knockout')),
  sort_order        integer NOT NULL,
  label             text NOT NULL,
  status            text NOT NULL DEFAULT 'upcoming'
                      CHECK (status IN ('upcoming', 'open', 'in_progress', 'complete')),
  first_kickoff_at  timestamptz,             -- denormalized from matches (§3.4); NULL until a fixture exists
  completed_at      timestamptz,             -- set automatically on completion (§4.6)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX matchweeks_sort_key ON matchweeks (act, sort_order);

-- matches ------------------------------------------------------------------
CREATE TABLE matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id    text UNIQUE,
  stage          text NOT NULL,              -- 'league_phase' | 'playoff' | 'r16' | 'qf' | 'sf' | 'final'
  matchweek_id   text NOT NULL REFERENCES matchweeks (id),
  leg            smallint,                   -- knockout leg (1/2); NULL for single-leg / league
  kickoff_at     timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_team_id   uuid NOT NULL REFERENCES teams (id),
  away_team_id   uuid NOT NULL REFERENCES teams (id),
  home_score     integer,
  away_score     integer,
  home_score_aet integer,                    -- after extra time (knockout time basis, §4.4)
  away_score_aet integer,
  home_pens      integer,                    -- penalty shootout
  away_pens      integer,
  is_manual_override boolean NOT NULL DEFAULT false, -- (§5.3)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_distinct_teams CHECK (home_team_id <> away_team_id)
);

CREATE INDEX matches_matchweek_idx ON matches (matchweek_id);
CREATE INDEX matches_kickoff_idx ON matches (kickoff_at);
CREATE INDEX matches_home_idx ON matches (home_team_id);
CREATE INDEX matches_away_idx ON matches (away_team_id);

-- tournament_config --------------------------------------------------------
-- Admin-editable knobs only (§8.1). The fixed domain constants (§3.9) are NOT
-- stored here. Simple key -> jsonb store.
CREATE TABLE tournament_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- team_selections (permanent squad) ----------------------------------------
-- Exactly SQUAD_SIZE (4) rows per user, one per pot (§3.2). tier_id is
-- denormalized so pot-uniqueness can be enforced by a plain unique index, and a
-- composite FK ties it to the club's real pot.
CREATE TABLE team_selections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id     uuid NOT NULL,
  tier_id     smallint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_selections_team_tier_fk
    FOREIGN KEY (team_id, tier_id) REFERENCES teams (id, tier_id),
  CONSTRAINT team_selections_unique_team UNIQUE (user_id, team_id),  -- no duplicate club
  CONSTRAINT team_selections_unique_pot UNIQUE (user_id, tier_id)    -- at most one per pot
);

CREATE INDEX team_selections_user_idx ON team_selections (user_id);

-- updated_at triggers ------------------------------------------------------
CREATE TRIGGER teams_set_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER matchweeks_set_updated_at
  BEFORE UPDATE ON matchweeks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER matches_set_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_selections_set_updated_at
  BEFORE UPDATE ON team_selections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
