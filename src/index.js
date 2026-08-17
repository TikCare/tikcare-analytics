// TikCare analytics — framework-agnostic core.
//
// HARD BOUNDARY (plan §2.2): this module never reads process.env / import.meta.env,
// never imports the store, never touches the router. The host injects all of
// that via init(). Keep it that way or the SDK extraction becomes a rewrite.
//
// All public paths are try/catch-wrapped: analytics must never break the app.
import { newId, getAnonymousId, getSessionId, isReturning } from './id.js';
import { sanitizeProps, uuidOrNull, scrubPath } from './sanitize.js';
import { collectContext, collectUtm } from './context.js';
import { configureQueue, enqueue, flushQueue, claimDropCount } from './queue.js';
import { attachAutocapture } from './autocapture.js';

export { EVENTS } from './taxonomy.js';

let cfg = null;
let utm = {};
let returning = false;

function isEnabled() {
  if (!cfg) return false;
  try {
    return typeof cfg.enabled === 'function' ? cfg.enabled() !== false : cfg.enabled !== false;
  } catch {
    return false; // fail closed: a broken kill switch must not re-enable tracking
  }
}

export function init(config) {
  try {
    if (!config || !config.url || !config.ingestKey) return; // missing config → whole module no-ops
    returning = isReturning(); // must be read BEFORE getAnonymousId() creates the id
    cfg = { autoCapture: { clicks: true }, ...config };
    utm = collectUtm();
    configureQueue({ url: cfg.url, ingestKey: cfg.ingestKey });
    if (cfg.autoCapture.clicks !== false) attachAutocapture(trackInternal);
  } catch {
    cfg = null;
  }
}

// Identity consent (mock_id policy): events always flow, but the user's real
// identity rides along only with explicit consent. Without it (or logged out),
// user_id/anonymous_id/team_id/role are stripped and the session-scoped
// session_id is the only identifier — a full in-session path, nothing durable.
// Fail closed: an erroring/absent predicate means no identity.
function hasIdentityConsent() {
  try {
    return cfg.getIdentityConsent ? cfg.getIdentityConsent() === true : false;
  } catch {
    return false;
  }
}

function assemble(eventName, properties, extra) {
  const consented = hasIdentityConsent();
  const rawIdentity = (() => {
    try {
      return cfg.getIdentity ? cfg.getIdentity() || {} : {};
    } catch {
      return {};
    }
  })();
  const loggedIn = !!uuidOrNull(rawIdentity.userId);
  // Identity rules (mock_id policy):
  // - consented:            user_id + anonymous_id + session_id (full linkage)
  // - logged out:           anonymous_id + session_id (no refusal has occurred;
  //                         keeps anonymous retention + signup attribution)
  // - logged in, refused:   session_id only (explicit "no" strips everything
  //                         durable, including the cross-session anonymous_id)
  const identity = consented ? rawIdentity : {};
  const sendAnonId = consented || !loggedIn;
  const pagePath = (() => {
    try {
      return cfg.getPagePath ? scrubPath(cfg.getPagePath()) : null;
    } catch {
      return null;
    }
  })();
  const props = sanitizeProps(properties);
  const eventId = newId(); // minted HERE, at queue time; never regenerated on retry
  const dropped = claimDropCount(eventId); // cleared for good only after this event's batch lands
  if (dropped > 0) props.dropped_since_last = dropped;
  props.is_returning = returning; // common attributes (§9.6)
  props.platform = 'web';

  return {
    event_id: eventId,
    event_name: eventName,
    event_type: extra.event_type || 'track',
    environment: cfg.environment || 'development',
    app_version: cfg.appVersion || undefined,
    source: 'web',
    occurred_at: new Date().toISOString(),
    user_id: uuidOrNull(identity.userId),
    anonymous_id: sendAnonId ? uuidOrNull(getAnonymousId()) : undefined,
    session_id: uuidOrNull(getSessionId()),
    team_id: uuidOrNull(identity.teamId),
    role: identity.role || undefined,
    page_path: pagePath,
    element_id: extra.element_id || undefined,
    ...collectContext(),
    ...utm,
    properties: props,
  };
}

function trackInternal(eventName, properties, extra = {}) {
  try {
    if (!isEnabled()) return;
    enqueue(assemble(eventName, properties, extra));
  } catch {
    /* never throw into the app */
  }
}

export function track(eventName, properties) {
  trackInternal(eventName, properties, {});
}

export function trackPageView(properties) {
  trackInternal('page_viewed', properties, { event_type: 'page' });
}

export async function flush() {
  try {
    await flushQueue();
  } catch {
    /* noop */
  }
}
