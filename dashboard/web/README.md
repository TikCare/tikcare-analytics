# Dashboard front end

PLAN-0815-analytics-dashboard §3.1, C3 (Tab 1 only — Tab 2 is a placeholder,
ships in C4). One static page, **zero build step** — plain `<script>` tags,
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

## Verified

Manually tested in-browser against representative mock data covering: a
right-censored retention cohort (D30 legitimately "—"), a scan-failure
breakdown with two distinct reason/device combinations, a WAU step that's
flat across a week while DAU wiggles daily, and an event-count anomaly day
(simulating an outage) to confirm the data-health chart actually shows the
dip. App switcher re-render confirmed against a second app's numbers.
**Not tested against the real edge functions** — see
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
