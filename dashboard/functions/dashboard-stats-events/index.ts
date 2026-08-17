// dashboard-stats-events — TC_EVENT_TRACKER half of the ops dashboard.
// PLAN-0815-analytics-dashboard §3.1/§3.2/§3.4 (C2).
//
// Serves Tab 1 (product behavior): retention, scan funnel, DAU/WAU/new users,
// data health. Reads ONLY the four aggregate views from
// dashboard/sql/tc_event_tracker/ (01-04) -- per §3.1's own principle, "the
// dashboard only ever reads aggregate views, and never touches a single raw
// event or any PHI." There is no code path in this function that can reach
// the `events` table directly.
//
// Deploy: see ../../README.md. This project (TC_EVENT_TRACKER,
// rqsmiovhqurvafmqvkro) is NOT one I have write/read access to in this
// session -- written and reviewed against the view definitions in
// dashboard/sql/tc_event_tracker/, but not run against the live database.
// Whoever deploys this should run the smoke check in the README first.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkAccessKey, corsHeaders, cutoffDate, windowDays } from '../_shared/dashboardAuth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  // Service role, not anon: RLS is enabled on `events`/`user_first_seen`
  // (per the plan's own Evidence table), and these are cross-user aggregates
  // no single caller's RLS policy is meant to grant. The views are the
  // access boundary here, not row ownership -- this key can only ever be
  // used through this function's four fixed SELECTs, never as a passthrough.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authError = checkAccessKey(req);
  if (authError) return authError;

  const days = windowDays(req);
  const since = cutoffDate(days);

  const [retention, scanFunnel, dau, eventHealth] = await Promise.all([
    supabase.from('v_retention').select('*').gte('cohort_week', since).order('cohort_week'),
    supabase.from('v_scan_funnel').select('*').gte('day', since).order('day'),
    supabase.from('v_dau').select('*').gte('day', since).order('day'),
    supabase.from('v_event_health').select('*').gte('day', since).order('day'),
  ]);

  // Partial failure still returns whatever succeeded, with the failing
  // section's error surfaced under `errors` -- one broken view (e.g. a
  // renamed column, see v_scan_funnel's ASSUMED device_type) should not
  // blank the other three charts.
  const errors: Record<string, string> = {};
  if (retention.error) errors.retention = retention.error.message;
  if (scanFunnel.error) errors.scan_funnel = scanFunnel.error.message;
  if (dau.error) errors.dau = dau.error.message;
  if (eventHealth.error) errors.event_health = eventHealth.error.message;

  return new Response(
    JSON.stringify({
      window_days: days,
      retention: retention.data ?? [],
      scan_funnel: scanFunnel.data ?? [],
      dau: dau.data ?? [],
      event_health: eventHealth.data ?? [],
      ...(Object.keys(errors).length ? { errors } : {}),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
