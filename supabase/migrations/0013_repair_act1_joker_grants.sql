-- Top up the Act I joker grants that were handed out before the defaults changed.
--
-- A new account is granted its jokers from `joker_inventory_defaults` as it is
-- created (§3.6), and changing that config later deliberately does not reach
-- back into accounts that already exist. The 2026-27 season was opened with the
-- league-phase grant at 1 for `triple_boost` and `bench_boost`, raised to 2
-- after the first fourteen accounts had been created, so those fourteen play
-- the whole league phase two jokers short of everybody else.
--
-- This is the repair, and it is data only. It reads the target out of the
-- config row rather than naming a number, so it stays right if the defaults are
-- edited again before it runs, and it only touches a row whose grant actually
-- came out short: `remaining + played < target`. Everything already at or above
-- the target is left exactly as it is, which also makes a second run a no-op.
--
-- `played` counts league-phase activations that were not cancelled. A cancelled
-- one was refunded and is already back in `remaining_count`, so counting it
-- would hand out the same joker twice.

WITH target AS (
  SELECT jt.code, d.value::int AS want
    FROM tournament_config tc
    CROSS JOIN LATERAL jsonb_each_text(tc.value -> 'league_phase') AS d(key, value)
    JOIN joker_types jt ON jt.code = d.key
   WHERE tc.key = 'joker_inventory_defaults'
),
held AS (
  SELECT u.id AS user_id,
         t.code,
         t.want,
         COALESCE(ji.remaining_count, 0) AS remaining,
         (SELECT count(*)
            FROM joker_activations ja
            JOIN matchweeks mw ON mw.id = ja.matchweek_id
           WHERE ja.user_id = u.id
             AND ja.joker_type_code = t.code
             AND ja.cancelled_at IS NULL
             AND mw.act = 'league_phase')::int AS played
    FROM users u
    CROSS JOIN target t
    LEFT JOIN joker_inventory ji
           ON ji.user_id = u.id AND ji.joker_type_code = t.code
   WHERE NOT u.is_admin
)
INSERT INTO joker_inventory (user_id, joker_type_code, remaining_count)
SELECT user_id, code, GREATEST(want - played, 0)
  FROM held
 WHERE remaining + played < want
ON CONFLICT (user_id, joker_type_code)
DO UPDATE SET remaining_count = EXCLUDED.remaining_count, updated_at = now();
