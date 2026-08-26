-- Phase 7 — scheduled provider sync (PLAN.md §5.2, §5.6, §9.5).

-- Distinguish polls made by the background job from admin-triggered ones, so
-- the sync log shows whether the schedule is actually keeping up on its own.
ALTER TABLE sync_runs
  ADD COLUMN trigger text NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled'));
