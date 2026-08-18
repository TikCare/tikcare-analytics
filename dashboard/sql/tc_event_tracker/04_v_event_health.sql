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
--   events.clock_skew, events.received_at             -- CONFIRMED 2026-08-17
--       against the live schema (list_tables via the newly-connected
--       supabase_tc_event_tracker MCP). clock_skew is a server-computed
--       boolean (default false) -- using it directly rather than the
--       previous plan of diffing occurred_at against received_at ourselves
--       with a guessed threshold: the server's own flag is authoritative,
--       whatever its actual threshold is, and doesn't need this view to
--       guess at one.
--
-- security_invoker=true -- see 01_v_retention.sql's header for why.
CREATE OR REPLACE VIEW v_event_health WITH (security_invoker = true) AS
SELECT
    occurred_at::date AS day,
    app_id,
    count(*) AS event_count,
    count(*) FILTER (WHERE (properties->>'dropped_since_last')::int > 0) AS events_reporting_drops,
    coalesce(sum((properties->>'dropped_since_last')::int), 0) AS queue_dropped_total,
    count(*) FILTER (WHERE clock_skew) AS clock_skew_events,
    round(
        count(*) FILTER (WHERE clock_skew)::numeric / NULLIF(count(*), 0),
        4
    ) AS clock_skew_ratio
FROM events
GROUP BY 1, 2
ORDER BY 1, 2;

COMMENT ON VIEW v_event_health IS
  'PLAN-0815 §3.2. clock_skew_ratio uses the server-computed events.clock_skew flag directly (confirmed to exist 2026-08-17), not a client/server timestamp diff computed here.';

-- Verification: SELECT * FROM v_event_health ORDER BY day DESC LIMIT 10;
--   Sane result: event_count roughly steady day-to-day for an app with
--   stable traffic; a sudden drop to near-zero on some day is exactly the
--   "first sign of an outage" this view exists to surface. queue_dropped_total
--   should be a small fraction of event_count under normal network
--   conditions -- a large fraction is itself worth investigating (a flaky
--   ingest endpoint, an aggressive ad-blocker pattern match, etc).
--   clock_skew_ratio should be near 0 under normal conditions -- a spike
--   means client clocks are meaningfully wrong for a chunk of traffic.
