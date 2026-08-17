# tikcare-analytics

Framework-agnostic tracking SDK shared across MindVault, Medical Scribe, and
HealthSeer PWA. Pure ESM, **zero dependencies, zero build step** — the
module never reads `process.env`/`import.meta.env`, never imports a state
store, never touches a router. The host app injects all of that through
`init()`. Keep it that way: the day this module reaches into framework
internals is the day it stops being shareable across three different stacks
(CRA+Redux, Vite+TS+react-router, and whatever comes next).

## Provenance

This package is the merge of two SDK copies that drifted after being
developed independently in `Tikcare-MindVault` and `Medical-Scribe-React`.
Four files (`context.js`, `id.js`, `taxonomy.js`, `transport.js`) were
byte-identical and carried over as-is. The other four merged one
divergent feature from each side:

- **From MindVault**: the identity-consent layer (see [Consent model](#consent-model-mock_id-policy) below) — events always flow, but a user's durable identity only rides along with explicit consent.
- **From Medical Scribe**: stricter dropped-event accounting in `queue.js` (`claimDropCount`/`pendingClaims`/`settleBatch`) — a batch's claimed drop count is only truly cleared once that batch gets a confirmed 2xx; on permanent failure the count (plus the batch itself) rides the next attempt instead of silently vanishing.

`test/merge-assertions.test.mjs` pins both behaviors down as regression
tests — run `npm test` before touching either mechanism.

## Install

```bash
npm install github:TikCare/tikcare-analytics#v1.0.0
```

No private registry needed — this is a plain git dependency, pinned to a
tag. Don't track bare `main`; cut a new tag when the package changes and
bump the consuming app's dependency deliberately.

## `init(config)`

Call once, as early as possible in the app's entry point. All fields are
read defensively (missing/throwing callbacks degrade gracefully, they never
crash the host app).

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | ✅ | The `ingest` edge function URL. Without this (or `ingestKey`) the whole module no-ops. |
| `ingestKey` | `string` | ✅ | Per-app ingest key. Semi-public (ships in client JS) — it identifies the app, it does not authorize arbitrary access. |
| `appId` | `string` | — | Informational only. The server resolves the real `app_id` from `ingestKey` via the `INGEST_KEYS` map; a client-declared value here is ignored server-side. |
| `environment` | `string` | — | e.g. `'production'` / `'development'`. Defaults to `'development'` if omitted. |
| `appVersion` | `string` | — | Your `package.json` version (or a build SHA). Lets you slice data by release. |
| `getIdentity` | `() => { userId?, teamId?, role? }` | — | Called per-event. `userId`/`teamId` must be UUIDs or they're dropped (`uuidOrNull`). |
| `getPagePath` | `() => string` | — | **Return a route template, not the raw pathname**, for any parameterized route (e.g. `/book/:ailmentId`, not `/book/headache`) — see [Route templating](#route-templating). `scrubPath()` also defensively replaces any UUID/numeric path segment with `:id` as a second layer, but don't rely on that alone. |
| `enabled` | `() => boolean` | — | Kill switch, checked before every event. A throwing/absent predicate fails closed (`false`). |
| `getIdentityConsent` | `() => boolean` | — | See [Consent model](#consent-model-mock_id-policy). A throwing/absent predicate fails closed (no identity attached). |
| `autoCapture` | `{ clicks?: boolean }` | — | Defaults to `{ clicks: true }`. Set `clicks: false` to disable automatic `element_clicked` capture on `[data-track-id]` elements. |

### Other exports

- `track(eventName, properties)` — fire a custom event. `properties` is
  filtered through the client-side whitelist mirror (`sanitize.js`) before
  being queued — unlisted keys are silently dropped, string values
  truncated to 200 chars, max 20 keys kept. The server holds the
  authoritative whitelist and re-filters everything regardless.
- `trackPageView(properties)` — fire a `page_viewed` event. Wire this to
  your router's navigation event if you're not using autocapture for it.
- `flush()` — force an immediate queue flush (events otherwise batch at 20
  events or every 10s, whichever comes first). Rarely needed directly.
- `EVENTS` — the shared event-name taxonomy, re-exported from `taxonomy.js`.

## Consent model (`mock_id` policy)

**Events always flow.** Consent never gates *whether* an event is sent —
only whether the user's durable identity rides along with it. This keeps
retention/funnel analysis intact even for users who decline, at the cost of
losing cross-session linkage for them specifically.

| State | `user_id` | `anonymous_id` | `session_id` |
|---|---|---|---|
| Consented | ✅ | ✅ | ✅ |
| Not logged in (no refusal has occurred) | — | ✅ | ✅ |
| Logged in, consent refused | — | — | ✅ |

A logged-in refusal is the strictest state: it strips even the
cross-session `anonymous_id`, leaving only a session-scoped identifier with
no persistent linkage at all. This is deliberate — an explicit "no" should
mean no, not "no except for the thing you can't see."

## Route templating

If your app has any parameterized route, `getPagePath` must resolve it to
its template string, not the live URL — a raw pathname fragments a single
logical page into one row per parameter value, and if the parameter itself
is sensitive (e.g. a health condition, a record ID), you'd be sending that
value into the event store's `page_path` field. Use your router's
path-matching utility (e.g. react-router's `matchPath`) against your route
table and return the template on a match.

## Property whitelist

`sanitize.js`'s `ALLOWED_PROP_KEYS` is a **fail-early mirror** of the
ingest edge function's server-side whitelist — matching it here just means
a bad property gets dropped client-side instead of silently server-side.
**The server's copy is authoritative.** If you need a new property key,
add it there first; adding it only here does nothing.

## Wiring examples

### Vite + TypeScript (e.g. HealthSeer PWA)

```ts
// src/main.tsx
import { init } from 'tikcare-analytics';
import { matchPath } from 'react-router-dom';
import packageJson from '../package.json';
import { routeTemplates } from './routeTemplates'; // e.g. ['/book/:ailmentId']

function currentPagePath(): string {
  const path = window.location.pathname;
  for (const template of routeTemplates) {
    if (matchPath(template, path)) return template;
  }
  return path;
}

init({
  url: import.meta.env.VITE_ANALYTICS_URL,
  ingestKey: import.meta.env.VITE_ANALYTICS_INGEST_KEY,
  appId: 'healthseer-pwa', // informational only, see table above
  environment: import.meta.env.MODE,
  appVersion: packageJson.version,
  getIdentity: () => ({ userId: getCurrentUserId() /* from your AppStateContext */ }),
  getPagePath: currentPagePath,
  enabled: () => true,
  getIdentityConsent: () => getAnalyticsConsentPreference(), // from Settings
});
```

### Create React App + Redux (e.g. MindVault)

```ts
// src/index.tsx
import { init as initAnalytics } from 'tikcare-analytics';
import store from './store';
import packageJson from '../package.json';

initAnalytics({
  url: process.env.REACT_APP_ANALYTICS_URL,
  ingestKey: process.env.REACT_APP_ANALYTICS_INGEST_KEY,
  appId: 'mindvault',
  environment: process.env.REACT_APP_ENV || process.env.NODE_ENV,
  appVersion: packageJson.version,
  getIdentity: () => {
    const s = store.getState().globalState;
    return { userId: s?.userDetails?.id, role: s?.role || undefined };
  },
  // All-static routes: pathname is already ID-free. If a param route is
  // ever added here, switch to a route-template lookup (see Vite example).
  getPagePath: () => window.location.pathname,
  enabled: () => true,
  getIdentityConsent: () => {
    const consent = store.getState().globalState?.userDetails?.anonymous_analytics_enabled;
    return consent === true;
  },
});
```

## Testing

```bash
npm test
```

Runs `test/merge-assertions.test.mjs` against Node's built-in test runner
(`node:test`) — no test-framework dependency. The two tests pin the merge's
two behavioral assertions (consent stripping, drop-count recovery); a
minimal browser-global stub layer (`localStorage`/`sessionStorage`/
`fetch`/etc.) lives inline in the test file since `src/` targets a real
browser, not Node.
