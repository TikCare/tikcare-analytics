-- 02_v_scan_funnel.sql -- PLAN-0815-analytics-dashboard §3.2, scan funnel.
-- The chart Jack named specifically -- camera-status failure visibility.
--
-- Columns used, and confidence:
--   events.occurred_at, app_id, event_name          -- CONFIRMED (client payload)
--   events.properties->>'cpu_cores'                 -- CONFIRMED (tikcare-analytics
--                                                        HealthSeer instrumentation,
--                                                        see PLAN §2.4 -- sent on both
--                                                        scan_started AND scan_failed)
--   events.properties->>'reason'                    -- CONFIRMED, but only ever
--                                                        present on scan_failed rows;
--                                                        NULL on scan_started/completed
--                                                        by design, not a data gap
--   events.device_type                              -- CONFIRMED 2026-08-17 (live
--                                                        schema) -- the ASSUMED tag
--                                                        from this view's first draft
--                                                        turned out correct.
--
-- security_invoker=true -- see 01_v_retention.sql's header for why.
--
-- One row per (day, app, device_type, cpu_cores, reason) -- reason is NULL
-- for started/completed rows, which is exactly what lets a single view serve
-- both "top-line funnel" (sum started/completed, ignore reason) and "failure
-- breakdown" (filter failed > 0, group by reason/device_type/cpu_cores).
CREATE OR REPLACE VIEW v_scan_funnel WITH (security_invoker = true) AS
SELECT
    occurred_at::date AS day,
    app_id,
    device_type,                                    -- ASSUMED, see header
    (properties->>'cpu_cores')::int AS cpu_cores,
    properties->>'reason' AS reason,                 -- NULL except on failures
    count(*) FILTER (WHERE event_name = 'scan_started')   AS started,
    count(*) FILTER (WHERE event_name = 'scan_completed') AS completed,
    count(*) FILTER (WHERE event_name = 'scan_failed')    AS failed
FROM events
WHERE event_name IN ('scan_started', 'scan_completed', 'scan_failed')
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 2;

COMMENT ON VIEW v_scan_funnel IS
  'PLAN-0815 §3.2. Top-line funnel: SUM(started)/SUM(completed) grouped by day+app, ignore reason. Failure breakdown: WHERE failed > 0, group by reason/device_type/cpu_cores -- this directly answers whether the "10-20% of elderly devices can''t handle it" claim is a device problem (low_fps clustered on low cpu_cores) or a permission problem (permission_denied, device-independent).';

-- Verification: SELECT * FROM v_scan_funnel WHERE failed > 0 ORDER BY day DESC LIMIT 15;
--   Sane result: reason populated on every row (never NULL when failed > 0),
--   cpu_cores in a plausible range (1-32ish, not NULL/0 for most rows).
