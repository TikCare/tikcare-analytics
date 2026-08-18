-- 03_v_dau.sql -- PLAN-0815-analytics-dashboard §3.2, activity (DAU/WAU + new users).
--
-- Columns used, and confidence:
--   events.occurred_at, app_id, user_id             -- CONFIRMED (client payload)
--   user_first_seen.first_seen_at, user_id           -- per plan doc prose
--   user_first_seen.app_id                           -- CONFIRMED 2026-08-17
--       (live schema) -- the ASSUMED tag from this view's first draft turned
--       out correct.
--
-- security_invoker=true -- see 01_v_retention.sql's header for why.
CREATE OR REPLACE VIEW v_dau WITH (security_invoker = true) AS
WITH daily_active AS (
    SELECT occurred_at::date AS day, app_id, count(DISTINCT user_id) AS dau
    FROM events
    WHERE user_id IS NOT NULL
    GROUP BY 1, 2
),
weekly_active AS (
    SELECT date_trunc('week', occurred_at)::date AS week, app_id, count(DISTINCT user_id) AS wau
    FROM events
    WHERE user_id IS NOT NULL
    GROUP BY 1, 2
),
new_users AS (
    SELECT first_seen_at::date AS day, app_id, count(*) AS new_users
    FROM user_first_seen
    GROUP BY 1, 2
)
SELECT
    d.day,
    d.app_id,
    d.dau,
    w.wau,
    coalesce(n.new_users, 0) AS new_users
FROM daily_active d
LEFT JOIN weekly_active w
    ON w.week = date_trunc('week', d.day)::date AND w.app_id = d.app_id
LEFT JOIN new_users n
    ON n.day = d.day AND n.app_id = d.app_id
ORDER BY d.day, d.app_id;

COMMENT ON VIEW v_dau IS
  'PLAN-0815 §3.2. wau is the SAME weekly total repeated on every day of that week (a week-grain metric joined onto a day-grain row) -- expected, not a bug; the dashboard should render it as a step, not read week-over-week deltas from consecutive days.';

-- Verification: SELECT * FROM v_dau ORDER BY day DESC LIMIT 10;
--   Sane result: dau <= wau always (a day is a subset of its week); new_users
--   <= dau for the same day (a new user is definitionally active that day).
