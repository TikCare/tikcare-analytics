// Frontend copy of the property-key allowlist. This is a fail-early guardrail —
// the ingest edge function holds the authoritative copy and re-filters everything.
export const ALLOWED_PROP_KEYS = new Set([
  'option', 'tab', 'template_id', 'duration_ms', 'count', 'success', 'error_code',
  'language', 'vital_id', 'filter',
  'reason', 'stage', 'cpu_cores', 'memory_gb', 'metrics_count',
  'route', 'turn_index',
  'step', 'step_index', 'scroll_depth', 'dwell_ms', 'provider_id', 'plan',
  'price_cents', 'type', 'channel',
  'dropped_since_last',
  'is_returning', 'platform',
]);

export function sanitizeProps(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  let kept = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_PROP_KEYS.has(k) || kept >= 20) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    kept++;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defensive page_path scrubber: replace any path segment that is a uuid or a
// pure number with ':id' before the event is queued. All current routes are
// static, so output is unchanged today — this guards future param routes.
export function scrubPath(path) {
  if (typeof path !== 'string' || path === '') return path;
  return path
    .split('/')
    .map((seg) => (UUID_RE.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

// Identity fields must be uuids or the server rejects the whole event —
// better to drop a malformed id than lose the event.
export function uuidOrNull(v) {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}
