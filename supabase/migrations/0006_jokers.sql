-- Phase 5 — jokers (PLAN.md §3.6, §8.1).

-- joker_types --------------------------------------------------------------
CREATE TABLE joker_types (
  code        text PRIMARY KEY,
  name        text NOT NULL,       -- Turkish display name
  sort_order  integer NOT NULL
);

INSERT INTO joker_types (code, name, sort_order) VALUES
  ('weekly_swap',        'Haftalık değişim',    10),
  ('triple_boost',       'Üçlü kaptan (×3)',    20),
  ('clean_sheet_shield', 'Gol yememe kalkanı',  30),
  ('bench_boost',        'Bench boost',          40);

-- joker_inventory ----------------------------------------------------------
-- Per-user remaining counts; reset on act transition (Phase 6).
CREATE TABLE joker_inventory (
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joker_type_code  text NOT NULL REFERENCES joker_types (code),
  remaining_count  integer NOT NULL DEFAULT 0 CHECK (remaining_count >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, joker_type_code)
);

CREATE TRIGGER joker_inventory_set_updated_at
  BEFORE UPDATE ON joker_inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- joker_activations --------------------------------------------------------
-- At most ONE non-cancelled activation per (user, matchweek) — enforced by the
-- partial unique index below AND the joker-service (§3.6, §8.1). A cancelled row
-- (cancelled_at set) frees the slot for a different joker before lock.
CREATE TABLE joker_activations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  matchweek_id     text NOT NULL REFERENCES matchweeks (id),
  joker_type_code  text NOT NULL REFERENCES joker_types (code),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz
);

CREATE UNIQUE INDEX joker_activations_one_live
  ON joker_activations (user_id, matchweek_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX joker_activations_user_idx ON joker_activations (user_id);
CREATE INDEX joker_activations_mw_idx ON joker_activations (matchweek_id);

-- Grant the initial Act I inventory to existing participants (§3.6). New users
-- get theirs at account creation via the auth-service.
INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
SELECT u.id, jt.code,
       CASE jt.code
         WHEN 'weekly_swap' THEN 2
         WHEN 'triple_boost' THEN 1
         WHEN 'clean_sheet_shield' THEN 2
         WHEN 'bench_boost' THEN 1
       END
FROM users u CROSS JOIN joker_types jt
WHERE NOT u.is_admin
ON CONFLICT DO NOTHING;
