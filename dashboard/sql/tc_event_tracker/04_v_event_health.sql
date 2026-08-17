-- 04_v_event_health.sql -- PLAN-0815-analytics-dashboard §3.2, data health.
-- The dashboard's own instrument panel -- this is what catches a pipeline
-- outage (a client-side bug, a CORS misconfig, a dead ingest key) on day
-- one instead of someone noticing the retention chart looks thin weeks later.
--
-- Columns used, and confidence:
--   events.occurred_at, app_id                       -- CONFIRMED
--   events.properties->>'dropped_since_last'          -- CONFIRMED. This is
--       tikcare-analytics' own field name (src/index.js's assemble()) --
--       queue_dropped in the plan's prose IS this field, just renamed for
--       the chart. Solid.
--   a server-received timestamp, for clock_skew        -- NOT CONFIRMED AT ALL.
--       occurred_at is the CLIENT's clock; detecting client clock skew needs
--       a second, server-stamped timestamp to diff against, and I have no
--       evidence such a column exists under any name. Left commented out
--       below rather than guessing a name -- uncomment and fix the column
--       name once 00_verify_schema.sql confirms what it's actually called
--       (candidates to check for: received_at, ingested_at, server_ts,
--       created_at). If no such column exists at all, clock_skew genuinely
--       can't be computed from this table and the metric should come off
--       the dashboard card rather than staying as a permanent zero.
CREATE OR REPLACE VIEW v_event_health AS
SELECT
    occurred_at::date AS day,
    app_id,
    count(*) AS event_count,
    count(*) FILTER (WHERE (properties->>'dropped_since_last')::int > 0) AS events_reporting_drops,
    coalesce(sum((properties->>'dropped_since_last')::int), 0) AS queue_dropped_total
    -- , round(
    --     count(*) FILTER (WHERE abs(extract(epoch FROM (received_at - occurred_at))) > 300)::numeric
    --     / NULLIF(count(*), 0),
    --     4
    -- ) AS clock_skew_ratio
FROM events
GROUP BY 1, 2
ORDER BY 1, 2;

-- Verification: SELECT * FROM v_event_health ORDER BY day DESC LIMIT 10;
--   Sane result: event_count roughly steady day-to-day for an app with
--   stable traffic; a sudden drop to near-zero on some day is exactly the
--   "first sign of an outage" this view exists to surface. queue_dropped_total
--   should be a small fraction of event_count under normal network
--   conditions -- a large fraction is itself worth investigating (a flaky
--   ingest endpoint, an aggressive ad-blocker pattern match, etc).
