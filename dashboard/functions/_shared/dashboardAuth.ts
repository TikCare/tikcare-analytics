// Shared by both dashboard-stats-* functions. §3.4: "a pragmatic version" of
// access control -- one key, stored in the front end's localStorage, sent
// back as a header and checked here. Not a user session, not RLS -- this is
// an internal ops dashboard gate, not a product auth boundary. Aggregate
// views carry no PHI, so the cost of getting this wrong is "someone sees
// daily call counts", not a data breach; that is why a single shared secret
// is an acceptable answer here when it would not be anywhere else in this repo.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-dashboard-key',
};

// Same env var name in both functions' secrets, same value -- §3.4: "the same
// key doubles as the request header for both dashboard-stats functions."
const ACCESS_KEY = Deno.env.get('DASHBOARD_ACCESS_KEY') ?? '';

export function checkAccessKey(req: Request): Response | null {
  if (!ACCESS_KEY) {
    // Failing open on an unset secret would make the gate a no-op the day
    // someone forgets to run `supabase secrets set` -- fail closed instead.
    return new Response(JSON.stringify({ error: 'dashboard access key not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supplied = req.headers.get('x-dashboard-key');
  if (supplied !== ACCESS_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// Bounds every view query to a recent window. Aggregate views grow one row
// per (day, ...) forever; without a floor, "open the dashboard" eventually
// means "download the whole history" on every page load. Clamped so the
// ?days= query param can't be used to force an unbounded scan either.
export function windowDays(req: Request, fallback = 90, max = 365): number {
  const raw = new URL(req.url).searchParams.get('days');
  const n = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD, matches the views' `day`/`cohort_week` date columns
}
