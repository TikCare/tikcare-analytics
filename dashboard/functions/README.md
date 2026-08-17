# Dashboard edge functions

Two read-only functions backing the ops dashboard (PLAN-0815-analytics-dashboard
§3.1/§3.4). Each queries a fixed set of aggregate views and nothing else —
there is no code path in either function that can reach a raw `events` row or
any PHI-bearing table.

```
dashboard front end
   │                              │
   │ fetch + X-Dashboard-Key      │ fetch + X-Dashboard-Key
   ▼                              ▼
dashboard-stats-events         dashboard-stats-engine
@ TC_EVENT_TRACKER              @ TC_MEM
(dashboard/sql/tc_event_tracker/  (migrations 024-026, already merged
 01-04, this PR's own views)       via PLAN-0814)
```

| Function | Project | Views read |
|---|---|---|
| `dashboard-stats-events` | TC_EVENT_TRACKER (`rqsmiovhqurvafmqvkro`) | `v_retention`, `v_scan_funnel`, `v_dau`, `v_event_health` |
| `dashboard-stats-engine` | TC_MEM | `v_classification_failure_daily`, `v_extraction_retry_daily`, `v_storage_growth_daily`, `v_usage_calls_daily`, `v_llm_cost_daily_estimate` |

## ⚠️ Not verified against a live database

I do not have read/write access to either `TC_EVENT_TRACKER` or `TC_MEM` in
this session. Both functions were written directly against the view
definitions (`dashboard/sql/tc_event_tracker/*.sql` in this repo; migrations
`024_monitoring_views.sql`/`025_storage_growth.sql`/`026_llm_cost_estimate.sql`
in `tikcare-memory`) and syntax-checked with `tsc --noEmit`, but never run
against a real Supabase project. In particular `v_scan_funnel`'s `device_type`
column is flagged `ASSUMED` in its own SQL file — if that column doesn't
exist under that name, `dashboard-stats-events` will return a populated
`errors.scan_funnel` field rather than crash (see "Partial failure" below),
which is the first place to look if that chart comes up empty.

**Before trusting either function**, run:

```bash
curl -s https://<project-ref>.supabase.co/functions/v1/dashboard-stats-events \
  -H "x-dashboard-key: <the key>" | jq .
```

and confirm `errors` is absent and each array actually has rows (or is
sanely empty, if the underlying view has no data yet).

## Access control

Both functions read `DASHBOARD_ACCESS_KEY` from their own project's function
secrets and compare it against the `X-Dashboard-Key` request header
(`_shared/dashboardAuth.ts`). Per §3.4 this is deliberately **one shared key,
not a session** — aggregate numbers carry no PHI, so the bar is "not fully
public," not product-grade auth. Missing/wrong key → `401`. Secret unset on
the project → fails closed with `500`, not open.

Set the **same key value** on both projects so the front end only needs to
hold one key in `localStorage`:

```bash
supabase secrets set --project-ref <TC_EVENT_TRACKER ref> \
  DASHBOARD_ACCESS_KEY="<generated key>"

supabase secrets set --project-ref <TC_MEM ref> \
  DASHBOARD_ACCESS_KEY="<same generated key>"
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform —
do not set them. Service role (not anon) is used deliberately: RLS is
enabled on the underlying tables, and these are cross-user aggregates no
single caller's row-ownership policy is meant to grant. The four/five fixed
view queries in each function *are* the access boundary — this key is never
exposed as a passthrough to arbitrary tables.

## Deploying

```bash
supabase functions deploy dashboard-stats-events --project-ref <TC_EVENT_TRACKER ref>
supabase functions deploy dashboard-stats-engine --project-ref <TC_MEM ref>
```

Neither function reads a caller's Supabase session — there's no user to
verify, only the shared key — so `--no-verify-jwt` is required on both, the
opposite of `../../../supabase/functions/memory`'s rule. Without it, the
platform's own JWT gate rejects every request before this code ever runs.

## Partial failure

Each function fires all its view queries with `Promise.all` and returns
whatever succeeded — a broken view doesn't blank the other charts. Check the
response's `errors` object (present only when at least one query failed) to
tell "no data yet" apart from "this view is broken."

## `?days=N`

Both functions default to a 90-day window (`?days=` overrides it, clamped to
365) via `windowDays()`/`cutoffDate()` in `_shared/dashboardAuth.ts`. These
views grow one row per day forever; without a floor, opening the dashboard
means scanning the whole history on every load.
