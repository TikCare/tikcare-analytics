-- 00_verify_schema.sql -- READ-ONLY. Run this first, review the output,
-- and fix column names in 01-04 before applying them if anything below
-- doesn't match what those files assume. Changes nothing in the database.

-- Full column list for both source tables.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('events', 'user_first_seen')
ORDER BY table_name, ordinal_position;

-- Sanity check: do the specific columns the four views assume actually
-- exist? This will error out (relation/column does not exist) rather than
-- silently returning nothing if a name is wrong -- that's the point, an
-- error here is cheap and safe, a silently-wrong view is not.
SELECT
    event_name, app_id, occurred_at, user_id, anonymous_id, session_id,
    page_path, properties
FROM events
LIMIT 1;

SELECT user_id, first_seen_at
FROM user_first_seen
LIMIT 1;

-- ASSUMED, server-side-only columns (plan doc prose, not client payload --
-- see README.md). If either of these doesn't exist under this name, the
-- corresponding view (02_v_scan_funnel for device_type, 04_v_event_health
-- for clock_skew's server-received timestamp) needs a column-name fix.
SELECT device_type FROM events LIMIT 1;
-- No assumed name for "server received timestamp" is confident enough to
-- probe here -- 04_v_event_health.sql spells out the exact ambiguity and a
-- fallback if there's no such column at all.
