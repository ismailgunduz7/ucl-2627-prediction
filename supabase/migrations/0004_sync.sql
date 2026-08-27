-- Phase 3: provider sync, override audit, and mock external-id backfill
-- (PLAN.md §5, §8.1).

-- sync_runs (observability, §5.2) -----------------------------------------
CREATE TABLE sync_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  status            text NOT NULL CHECK (status IN ('success', 'error')),
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL DEFAULT now(),
  fixtures_seen     integer NOT NULL DEFAULT 0,
  matches_upserted  integer NOT NULL DEFAULT 0,
  matches_finished  integer NOT NULL DEFAULT 0,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_runs_created_idx ON sync_runs (created_at DESC);

-- match_override_audits (§5.3, §8.1) --------------------------------------
-- Append-only record of every manual match edit / flag clear.
CREATE TABLE match_override_audits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  admin_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  action         text NOT NULL CHECK (action IN ('override', 'clear_override')),
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb, -- { field: { from, to } }
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX match_override_audits_match_idx ON match_override_audits (match_id, created_at DESC);

-- Backfill stable mock external ids so the mock provider can map fixtures back
-- to our seeded rows through the same (external_id) path the real provider uses.
-- Real ids will replace these when teams are reseeded after the official draw.
UPDATE teams   SET external_id = 'mock:' || id::text WHERE external_id IS NULL;
UPDATE matches SET external_id = 'mock:' || id::text WHERE external_id IS NULL;
