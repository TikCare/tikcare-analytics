# Dashboard front end

PLAN-0815-analytics-dashboard §3.1, C3+C4. Both tabs. One static page,
**zero build step** — plain `<script>` tags,
no bundler, no charting library — same philosophy as the SDK itself (see
`../../README.md`). Charts are hand-rolled inline SVG (`app.js`'s
`groupedBarChart`/`lineChart`), not because a library would be wrong, but
because pulling one in means vetting its license/security posture, and a
dozen simple charts don't need it.

## Access gate

On first load, prompts for the shared `X-Dashboard-Key` (§3.4) plus the two
edge function URLs, and stores all three in `localStorage`. Nothing is sent
anywhere except those two URLs. The ⚙ button in the header clears this and
re-shows the gate (e.g. to switch environments or rotate the key). A `401`
from `dashboard-stats-events` also bounces back to the gate with an error,
rather than showing a blank dashboard.

## What's implemented (Tab 1 — product behavior)

All four charts from §3.2, reading `dashboard-stats-events`'s response:

- **Retention curve** — grouped bar chart, D1/D7/D30 exact-day % per recent
  cohort week. Explicitly labeled "all apps combined" — `v_retention` has no
  `app_id` dimension (see that view's own header comment), so this one chart
  does NOT respect the app switcher below, on purpose.
- **Scan funnel** ⭐ — started/completed/failed totals + completion rate,
  plus a reason × device_type × cpu_cores failure breakdown table, both
  scoped to the selected app.
- **Activity** — DAU (solid line) vs WAU (dashed step) + total new users,
  scoped to the selected app.
- **Data health** — daily event volume bar chart + queue_dropped total +
  drop rate, scoped to the selected app. This is the chart that should make
  a pipeline outage visible as a bar dropping to near-zero.

App switcher (`#app-switcher`) is derived from whichever `app_id` values
actually appear in the fetched window — no hardcoded app list, so a new app
onboarding to `tikcare-analytics` shows up here automatically once it has
data.

`errors` in the API response (partial view failure, see
`../functions/README.md`) surfaces as a banner rather than blanking the
whole tab.

## What's implemented (Tab 2 — engine health & cost)

Five of the six cards from §3.3, reading `dashboard-stats-engine`'s
response — all backed by PLAN-0814's already-merged views, zero new SQL:

- **Classification failure rate** — line chart of `fallback_rate` × 100,
  red when the latest day exceeds the 1% alert threshold.
- **Extraction failure / abandonment** — `first_try_success`/`retried` bars,
  `abandoned` broken out as its own always-visible metric, never averaged
  into a rate (the plan is explicit that a terminal give-up state must not
  be diluted into invisibility by a mean).
- **Per-user storage trend** — line chart of `avg_bytes_per_user`. Renders
  an explicit banner (not a silently-empty chart) when there are zero rows,
  pointing at the pg_cron prerequisite from the runbook.
- **LLM call volume** — daily total bar chart (summed across endpoints) +
  a per-endpoint breakdown table.
- **LLM cost (estimate)** — `any_priced` from the edge function response
  gates this card: if `llm_price_sheet` is still empty, shows an explicit
  "unpriced" banner instead of a chart — **never renders $0.00**, matching
  §3.3's explicit instruction. Once partially priced, unpriced endpoints are
  excluded from the total and named separately rather than silently folded
  in as zero.
- **p95 latency / health hit-rate** — the sixth card, deliberately a static
  link-out to `console.cloud.google.com/monitoring/dashboards?project=tikcare-d0cb9`
  plus a note that both metrics are still flagged "not yet set up" in the
  PLAN-0814 runbook. Per §3.3, this one is explicitly NOT rebuilt here.

Tab 2 fetches on boot alongside Tab 1 (not lazily on first click) — the
acceptance criteria is answering one question per tab within 10 seconds of
opening the link, which a click-triggered fetch would eat into.

## Verified

Manually tested in-browser against representative mock data for both tabs:
a right-censored retention cohort (D30 legitimately "—"), a scan-failure
breakdown with two distinct reason/device combinations, a WAU step that's
flat across a week while DAU wiggles daily, an event-count anomaly day
(simulating an outage) confirming the data-health chart shows the dip, app
switcher re-render against a second app's numbers, a classification-rate
spike, extraction abandonment counting correctly, storage/usage number
formatting, and both the fully-unpriced and partially-priced LLM cost
states (confirming the total excludes unpriced rows rather than treating
them as zero). **Not tested against the real edge functions** — see
`../functions/README.md`'s own verification gap.

## Deploying

Per §3.1: "deployed to a subpath of any existing Firebase site." This
directory (`dashboard/web/`) is the entire deployable unit — copy or
`firebase deploy` it to whatever subpath, e.g.:

```bash
firebase deploy --only hosting:<target> \
  --public dashboard/web  # or copy dashboard/web/* into the site's public dir at the chosen subpath
```

No environment-specific values are baked in at build time — the gate
collects the edge function URLs and key at runtime, so the same static
files work for dev and prod; only what someone types into the gate differs.
