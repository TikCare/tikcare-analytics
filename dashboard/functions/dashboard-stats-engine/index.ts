// dashboard-stats-engine — TC_MEM half of the ops dashboard.
// PLAN-0815-analytics-dashboard §3.3/§3.4 (C2).
//
// Serves Tab 2 (engine health and cost), minus the p95-latency/health-hit-rate
// card, which the plan deliberately does not rebuild here -- that card is a
// static link-out to the native GCP dashboard, handled entirely in the front
// end (§3.3's last row). This function only covers the five cards backed by
// PLAN-0814's already-merged views (migrations 024-026) -- zero new SQL, per
// the plan's own header for this section.
//
// Deploy: see ../../README.md. TC_MEM is a project I do not have direct
// database access to in this session -- written and reviewed against
// migrations/024_monitoring_views.sql, 025_storage_growth.sql,
// 026_llm_cost_estimate.sql in the tikcare-memory repo, not run live.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkAccessKey, corsHeaders, cutoffDate, windowDays } from '../_shared/dashboardAuth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authError = checkAccessKey(req);
  if (authError) return authError;

  const days = windowDays(req);
  const since = cutoffDate(days);

  const [classification, extraction, storage, usage, cost] = await Promise.all([
    supabase.from('v_classification_failure_daily').select('*').gte('day', since).order('day'),
    supabase.from('v_extraction_retry_daily').select('*').gte('day', since).order('day'),
    supabase.from('v_storage_growth_daily').select('*').gte('day', since).order('day'),
    supabase.from('v_usage_calls_daily').select('*').gte('day', since).order('day'),
    supabase.from('v_llm_cost_daily_estimate').select('*').gte('day', since).order('day'),
  ]);

  const errors: Record<string, string> = {};
  if (classification.error) errors.classification_failure = classification.error.message;
  if (extraction.error) errors.extraction_retry = extraction.error.message;
  if (storage.error) errors.storage_growth = storage.error.message;
  if (usage.error) errors.usage_calls = usage.error.message;
  if (cost.error) errors.llm_cost = cost.error.message;

  // §3.3: "Show an unpriced state ... never show $0.00." any_priced tells the
  // front end in one field whether llm_price_sheet has anything in it yet,
  // rather than making every consumer re-derive it from priced flags per row.
  const costRows = cost.data ?? [];
  const anyPriced = costRows.some((r: { priced?: boolean }) => r.priced === true);

  return new Response(
    JSON.stringify({
      window_days: days,
      classification_failure: classification.data ?? [],
      extraction_retry: extraction.data ?? [],
      storage_growth: storage.data ?? [],
      usage_calls: usage.data ?? [],
      llm_cost: { rows: costRows, any_priced: anyPriced },
      ...(Object.keys(errors).length ? { errors } : {}),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
