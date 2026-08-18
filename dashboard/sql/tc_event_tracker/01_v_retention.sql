-- 01_v_retention.sql -- PLAN-0815-analytics-dashboard §3.2, retention curve.
--
-- Columns used, and confidence:
--   events.user_id, events.occurred_at            -- CONFIRMED (client payload, tikcare-analytics/src/index.js)
--   user_first_seen.user_id, .first_seen_at        -- CONFIRMED 2026-08-17 (live schema)
--
-- security_invoker=true (all four views in this directory): Postgres/Supabase
-- default views to SECURITY DEFINER, which would run as the view's creator
-- rather than the querying role -- flagged ERROR by the security advisor the
-- moment these were first applied. Doesn't change today's behavior (the
-- dashboard-stats-events function reads these via the service-role key, which
-- already bypasses RLS regardless), but a future SELECT grant to
-- anon/authenticated would otherwise silently bypass events/user_first_seen's
-- RLS entirely -- fixed at creation time instead of left as a dormant risk.
--
-- Exact-day D1/D7/D30: "any event on exactly the nth day after the anchor."
-- Denominator is right-censored -- a cohort member only counts toward D7
-- eligibility once 7 full days have actually passed for them (§3.2's own
-- wording: "分母只納入 first_seen_at <= today − n").
--
-- Dashboard front end computes the percentage (retained/eligible) and must
-- label it "exact-day" next to the number, per the plan's own instruction --
-- this view deliberately outputs raw counts, not a pre-divided percentage,
-- so that labeling can't be silently dropped downstream.
--
-- Performance note: the EXISTS subquery is correlated per cohort row. Fine
-- at today's event volume (low thousands); if this ever gets slow, the fix
-- is a pre-aggregated (user_id, active_date) materialized table, not a
-- rewrite of this view's logic.
CREATE OR REPLACE VIEW v_retention WITH (security_invoker = true) AS
WITH cohorts AS (
    SELECT
        user_id,
        first_seen_at::date AS first_seen_date,
        date_trunc('week', first_seen_at)::date AS cohort_week
    FROM user_first_seen
),
activity AS (
    SELECT DISTINCT user_id, occurred_at::date AS active_date
    FROM events
    WHERE user_id IS NOT NULL
)
SELECT
    c.cohort_week,
    count(*) FILTER (WHERE c.first_seen_date <= current_date - 1)  AS d1_eligible,
    count(*) FILTER (
        WHERE c.first_seen_date <= current_date - 1
          AND EXISTS (SELECT 1 FROM activity a
                       WHERE a.user_id = c.user_id
                         AND a.active_date = c.first_seen_date + 1)
    ) AS d1_retained,
    count(*) FILTER (WHERE c.first_seen_date <= current_date - 7)  AS d7_eligible,
    count(*) FILTER (
        WHERE c.first_seen_date <= current_date - 7
          AND EXISTS (SELECT 1 FROM activity a
                       WHERE a.user_id = c.user_id
                         AND a.active_date = c.first_seen_date + 7)
    ) AS d7_retained,
    count(*) FILTER (WHERE c.first_seen_date <= current_date - 30) AS d30_eligible,
    count(*) FILTER (
        WHERE c.first_seen_date <= current_date - 30
          AND EXISTS (SELECT 1 FROM activity a
                       WHERE a.user_id = c.user_id
                         AND a.active_date = c.first_seen_date + 30)
    ) AS d30_retained
FROM cohorts c
GROUP BY c.cohort_week
ORDER BY c.cohort_week;

-- Verification: SELECT * FROM v_retention ORDER BY cohort_week DESC LIMIT 10;
--   Sane result: *_eligible columns are non-increasing as the window widens
--   (d30_eligible <= d7_eligible <= d1_eligible per cohort), *_retained <=
--   corresponding *_eligible. Recent cohort_weeks will show 0 for d30 columns
--   until 30 days have actually passed -- that's correct, not a bug.
