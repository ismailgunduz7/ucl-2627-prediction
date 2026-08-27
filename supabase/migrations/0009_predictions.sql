-- Phase 7: Ahtapot Paul: 1X2 predictions on the week's matches (PLAN.md §18.9).

CREATE TABLE match_predictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  -- Outcome as seen from the home side, the way the fixture is written.
  pick        text NOT NULL CHECK (pick IN ('home', 'draw', 'away')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);

-- Scoring a week reads every prediction its matches carry.
CREATE INDEX match_predictions_match_idx ON match_predictions (match_id);
