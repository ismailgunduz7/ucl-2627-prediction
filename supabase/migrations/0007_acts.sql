-- Phase 6: season acts and the knockout path (PLAN.md §3.7, §8.1).

-- act_transfers ------------------------------------------------------------
-- One optional permanent squad change per participant when the knockout act
-- opens. The grant is modelled explicitly so an untouched grant can expire.
CREATE TABLE act_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'committed', 'expired')),
  from_team_id  uuid REFERENCES teams (id),
  to_team_id    uuid REFERENCES teams (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz
);

CREATE TRIGGER act_transfers_set_updated_at
  BEFORE UPDATE ON act_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Records the club's league finish so eliminations, the top-8 bonus and the
-- knockout draw all read from one settled source instead of recomputing.
ALTER TABLE teams ADD COLUMN league_rank integer;

-- Knockout ties -----------------------------------------------------------
-- A tie spans one or two legs; the winner advances. Legs live in `matches`
-- (each leg its own matchweek), this table holds the pairing and its result so
-- advancement points and medals are awarded exactly once.
CREATE TABLE knockout_ties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage         text NOT NULL CHECK (stage IN ('playoff', 'r16', 'qf', 'sf', 'final')),
  slot          integer NOT NULL,
  home_team_id  uuid REFERENCES teams (id),
  away_team_id  uuid REFERENCES teams (id),
  winner_team_id uuid REFERENCES teams (id),
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knockout_ties_unique_slot UNIQUE (stage, slot)
);

CREATE TRIGGER knockout_ties_set_updated_at
  BEFORE UPDATE ON knockout_ties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ties a match to its knockout pairing so both legs aggregate together.
ALTER TABLE matches ADD COLUMN tie_id uuid REFERENCES knockout_ties (id) ON DELETE SET NULL;
CREATE INDEX matches_tie_idx ON matches (tie_id);
