# TC_EVENT_TRACKER aggregate views — PLAN-0815-analytics-dashboard §3.2

Four read-only aggregate views for the "product behavior" tab of the ops
dashboard: retention, scan funnel, activity, and data health.

## ⚠️ Read this before applying anything

**I do not have database access to TC_EVENT_TRACKER** (`rqsmiovhqurvafmqvkro`)
and could not find the `ingest` edge function's source anywhere in the
TikCare GitHub org (searched all 30 repos, both GitHub code search and a
full recursive tree scan — genuinely not there, not a guess). So these
views are written from two sources, not from a verified live schema:

1. **The client event payload shape** — high confidence, since I wrote the
   SDK that produces it (`tikcare-analytics`, `src/index.js`'s `assemble()`).
   Every field name in that function I use here as-is: `event_name`,
   `app_id` (implied — the ingest function resolves it from the ingest key,
   per the plan doc, so it's presumably stored per-row), `occurred_at`,
   `user_id`, `anonymous_id`, `session_id`, `page_path`, `properties`
   (a JSON object holding `reason`/`stage`/`cpu_cores`/`memory_gb`/
   `dropped_since_last`/etc. — see `tikcare-analytics/src/sanitize.js`'s
   `ALLOWED_PROP_KEYS` for the full whitelist).
2. **The plan document's prose** for anything server-side-only that the
   client never sends: `device_type` (plan says the server parses this from
   `user_agent`), `clock_skew`, `cohort_week`, and the exact table names
   `events` / `user_first_seen`.

**Every column name that falls into bucket 2 is marked `-- ASSUMED` in the
SQL below.** Run `00_verify_schema.sql` first — it only reads
`information_schema`, touches nothing — and diff its output against the
column list each view assumes (also listed at the top of each view file)
before running `01`-`04`. Where a name doesn't match, fix the view's SQL
before applying it; a `CREATE VIEW` against a wrong column name fails
loudly and safely (nothing gets created), so this is a low-risk kind of
wrong to be — just needs a human to actually run the check first.

## Execution order

Views have no dependencies on each other — order among `01`-`04` doesn't
matter. `00` must run first (verification only, changes nothing).

```
psql "$TC_EVENT_TRACKER_URL" -f 00_verify_schema.sql   # read-only, review output
psql "$TC_EVENT_TRACKER_URL" -f 01_v_retention.sql
psql "$TC_EVENT_TRACKER_URL" -f 02_v_scan_funnel.sql
psql "$TC_EVENT_TRACKER_URL" -f 03_v_dau.sql
psql "$TC_EVENT_TRACKER_URL" -f 04_v_event_health.sql
```

All four `CREATE VIEW` statements are `CREATE OR REPLACE VIEW` — additive,
idempotent, safe to re-run after a column-name fix.

## Rollback

Views only, no tables/data touched — rollback is just:

```sql
DROP VIEW IF EXISTS v_retention;
DROP VIEW IF EXISTS v_scan_funnel;
DROP VIEW IF EXISTS v_dau;
DROP VIEW IF EXISTS v_event_health;
```

## Verification after applying

Each view file's own trailing comment has a `SELECT * FROM v_... LIMIT 10;`
smoke query with a one-line note on what a sane result looks like. Run all
four before wiring the `dashboard-stats` edge function to them.

## 05_events_daily_rollup.sql — retention guardrail (added 2026-09-02)

Not a view: enables pg_cron, creates the `events_daily` aggregate table,
backfills it from history, and schedules a nightly job (03:00 HKT) that
rolls up yesterday's raw events and deletes raw rows older than 90 days.
Motivation: autocapture v1.6.0 (allClickables + views:'all') multiplies
event volume ~10x, and TC_EVENT_TRACKER shares one Pro-plan database.
Long-term trend queries should read `events_daily`; per-event forensics
stay possible for the trailing 90 days in `events`.
