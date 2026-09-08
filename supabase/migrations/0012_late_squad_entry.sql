-- Late squad entry (§3.2).
--
-- A participant who never picked a squad before the selection lock can still
-- build one once the season is under way. They join from the first matchweek
-- that is still unlocked at that moment, and the weeks that ran before it never
-- score for them. This column is where that starting week is frozen: NULL means
-- the participant was there from the first matchweek, so every week counts.
--
-- It is set once, when a late squad is committed, and never recomputed. Lock
-- instants move with the provider's kickoff times; a starting week that moved
-- with them would hand somebody points for a week they sat out.

ALTER TABLE users
  ADD COLUMN entry_matchweek_id text REFERENCES matchweeks (id);
