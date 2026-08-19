// TikCare Ops Dashboard — plain JS, no build step, no charting library
// (matches the SDK's own zero-dependency philosophy — see ../../README.md).
// PLAN-0815-analytics-dashboard §3.1-§3.4.
'use strict';

const LS = {
  key: 'tikcare_dashboard_key',
  eventsUrl: 'tikcare_dashboard_events_url',
  engineUrl: 'tikcare_dashboard_engine_url',
};

// ---------------------------------------------------------------- Gate ----

function loadConfig() {
  const key = localStorage.getItem(LS.key);
  const eventsUrl = localStorage.getItem(LS.eventsUrl);
  const engineUrl = localStorage.getItem(LS.engineUrl);
  if (!key || !eventsUrl || !engineUrl) return null;
  return { key, eventsUrl, engineUrl };
}

function saveConfig(key, eventsUrl, engineUrl) {
  localStorage.setItem(LS.key, key);
  localStorage.setItem(LS.eventsUrl, eventsUrl);
  localStorage.setItem(LS.engineUrl, engineUrl);
}

function clearConfig() {
  localStorage.removeItem(LS.key);
  localStorage.removeItem(LS.eventsUrl);
  localStorage.removeItem(LS.engineUrl);
}

function showGate(errMsg) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('gate').style.display = 'block';
  const err = document.getElementById('gate-err');
  if (errMsg) {
    err.textContent = errMsg;
    err.style.display = 'block';
  } else {
    err.style.display = 'none';
  }
  // Pre-fill from any previously saved (but now failing) config, so a wrong
  // key doesn't also throw away correctly-typed URLs.
  const cfg = loadConfig();
  if (cfg) {
    document.getElementById('cfg-key').value = cfg.key;
    document.getElementById('cfg-events-url').value = cfg.eventsUrl;
    document.getElementById('cfg-engine-url').value = cfg.engineUrl;
  }
}

document.getElementById('gate-submit').addEventListener('click', () => {
  const key = document.getElementById('cfg-key').value.trim();
  const eventsUrl = document.getElementById('cfg-events-url').value.trim();
  const engineUrl = document.getElementById('cfg-engine-url').value.trim();
  if (!key || !eventsUrl || !engineUrl) {
    document.getElementById('gate-err').textContent = 'All three fields are required.';
    document.getElementById('gate-err').style.display = 'block';
    return;
  }
  saveConfig(key, eventsUrl, engineUrl);
  boot();
});

document.getElementById('gate-reset').addEventListener('click', () => {
  clearConfig();
  showGate(null);
});

// --------------------------------------------------------------- Fetch ----

async function fetchStats(url, key, days) {
  const u = new URL(url);
  if (days) u.searchParams.set('days', String(days));
  const res = await fetch(u.toString(), {
    headers: { 'x-dashboard-key': key },
  });
  if (res.status === 401) {
    throw Object.assign(new Error('Access key rejected by ' + u.hostname), { authFailure: true });
  }
  if (!res.ok) {
    throw new Error(u.hostname + ' returned ' + res.status);
  }
  return res.json();
}

// ---------------------------------------------------------- SVG helpers ----

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Grouped bar chart: series = [{label, color, values: number[]}], categories = string[]
function groupedBarChart(categories, series, opts) {
  opts = opts || {};
  const W = 560, H = 160, padL = 30, padB = 24, padT = 8, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = opts.max != null ? opts.max
    : Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(svgEl('line', { class: 'axis', x1: padL, y1: H - padB, x2: W - padR, y2: H - padB }));

  const groupW = plotW / Math.max(1, categories.length);
  const barW = groupW / (series.length + 1);

  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const v = s.values[ci];
      const x = padL + ci * groupW + si * barW + barW / 2;
      if (v == null) {
        // "—" for right-censored / no-data cells rather than a misleading 0-height bar.
        const t = svgEl('text', { x: x + barW / 2, y: H - padB - 4, 'text-anchor': 'middle' });
        t.textContent = '—';
        svg.appendChild(t);
        return;
      }
      const h = plotH * Math.min(1, v / maxVal);
      const rect = svgEl('rect', {
        x, y: H - padB - h, width: Math.max(2, barW - 2), height: h,
        fill: s.color || 'var(--accent)',
      });
      svg.appendChild(rect);
    });
    if (opts.labelEvery == null || ci % opts.labelEvery === 0) {
      const t = svgEl('text', { x: padL + ci * groupW + groupW / 2, y: H - 8, 'text-anchor': 'middle' });
      t.textContent = cat;
      svg.appendChild(t);
    }
  });
  return svg;
}

// Multi-line chart: series = [{label, color, dashed, values: (number|null)[]}]
function lineChart(categories, series, opts) {
  opts = opts || {};
  const W = 560, H = 160, padL = 30, padB = 24, padT = 8, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null));
  const maxVal = Math.max(1, ...allVals);
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(svgEl('line', { class: 'axis', x1: padL, y1: H - padB, x2: W - padR, y2: H - padB }));

  const stepX = categories.length > 1 ? plotW / (categories.length - 1) : 0;

  series.forEach((s) => {
    let d = '';
    s.values.forEach((v, i) => {
      if (v == null) return;
      const x = padL + i * stepX;
      const y = H - padB - plotH * (v / maxVal);
      d += (d ? ' L ' : 'M ') + x + ' ' + y;
    });
    if (!d) return;
    const path = svgEl('path', {
      d, fill: 'none', stroke: s.color || 'var(--accent)', 'stroke-width': 2,
      'stroke-dasharray': s.dashed ? '3 3' : null,
    });
    if (!s.dashed) path.removeAttribute('stroke-dasharray');
    svg.appendChild(path);
  });

  const labelEvery = opts.labelEvery || Math.max(1, Math.ceil(categories.length / 8));
  categories.forEach((cat, i) => {
    if (i % labelEvery !== 0 && i !== categories.length - 1) return;
    const x = padL + i * stepX;
    const t = svgEl('text', { x, y: H - 8, 'text-anchor': 'middle' });
    t.textContent = cat.slice(5); // MM-DD
    svg.appendChild(t);
  });
  return svg;
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10; // one decimal
}

function fmtPct(v) {
  return v == null ? '—' : v + '%';
}

// -------------------------------------------------------- Data grouping ----

function distinctAppIds(eventsData) {
  const s = new Set();
  ['scan_funnel', 'dau', 'event_health'].forEach((k) => {
    (eventsData[k] || []).forEach((r) => { if (r.app_id) s.add(r.app_id); });
  });
  return Array.from(s).sort();
}

function groupSum(rows, keyFn, valKey) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + (Number(r[valKey]) || 0));
  });
  return m;
}

// ------------------------------------------------------------- Charts -----

function renderRetentionCard(rows) {
  const card = document.createElement('div');
  card.className = 'card wide';
  card.innerHTML = `<h2>Retention curve <span style="color:var(--text-dim);font-weight:400;">(all apps combined — v_retention has no app dimension)</span></h2>
    <div class="def">Exact-day D1/D7/D30: any event on exactly the Nth day after first_seen_at. Denominator (eligible) only counts cohort members for whom N full days have actually passed — right-censored, so recent cohorts legitimately show "—" for D30 until 30 days pass.</div>`;

  const recent = rows.slice(-8);
  if (!recent.length) {
    card.innerHTML += '<div class="placeholder">No cohorts in this window.</div>';
    return card;
  }

  const categories = recent.map((r) => r.cohort_week);
  const series = [
    { label: 'D1', color: '#4f8cff', values: recent.map((r) => pct(r.d1_retained, r.d1_eligible)) },
    { label: 'D7', color: '#3ecf8e', values: recent.map((r) => pct(r.d7_retained, r.d7_eligible)) },
    { label: 'D30', color: '#e0a634', values: recent.map((r) => pct(r.d30_retained, r.d30_eligible)) },
  ];
  card.appendChild(groupedBarChart(categories, series, { max: 100 }));

  const latest = recent[recent.length - 1];
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value">${fmtPct(pct(latest.d1_retained, latest.d1_eligible))}</div><div class="label">latest cohort D1 (exact-day)</div></div>
    <div class="metric"><div class="value">${fmtPct(pct(latest.d7_retained, latest.d7_eligible))}</div><div class="label">latest cohort D7 (exact-day)</div></div>
    <div class="metric"><div class="value">${fmtPct(pct(latest.d30_retained, latest.d30_eligible))}</div><div class="label">latest cohort D30 (exact-day)</div></div>`;
  card.appendChild(row);
  return card;
}

function renderScanFunnelCard(rows, appId) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Scan funnel ⭐</h2>
    <div class="def">scan_started → scan_completed, this app, this window. Failures broken down by reason × device_type × cpu_cores below.</div>`;

  const appRows = rows.filter((r) => r.app_id === appId);
  const started = appRows.reduce((a, r) => a + (r.started || 0), 0);
  const completed = appRows.reduce((a, r) => a + (r.completed || 0), 0);
  const failed = appRows.reduce((a, r) => a + (r.failed || 0), 0);
  const completionRate = pct(completed, started);

  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value">${started}</div><div class="label">started</div></div>
    <div class="metric"><div class="value ${completionRate == null ? 'dim' : completionRate < 70 ? 'bad' : 'ok'}">${fmtPct(completionRate)}</div><div class="label">completed / started</div></div>
    <div class="metric"><div class="value ${failed > 0 ? 'warn' : ''}">${failed}</div><div class="label">failed</div></div>`;
  card.appendChild(row);

  card.appendChild(groupedBarChart(['this window'], [
    { label: 'started', color: '#4f8cff', values: [started] },
    { label: 'completed', color: '#3ecf8e', values: [completed] },
    { label: 'failed', color: '#e35d5d', values: [failed] },
  ]));

  // Failure breakdown by reason × device_type × cpu_cores, top 10 by failed count.
  const failRows = appRows.filter((r) => (r.failed || 0) > 0);
  const table = document.createElement('table');
  table.className = 'breakdown';
  const bucket = new Map();
  failRows.forEach((r) => {
    const k = [r.reason || '(none)', r.device_type || '(unknown)', r.cpu_cores ?? '(unknown)'].join(' · ');
    bucket.set(k, (bucket.get(k) || 0) + (r.failed || 0));
  });
  const sorted = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  table.innerHTML = '<tr><th>reason · device_type · cpu_cores</th><th>failed</th></tr>' +
    (sorted.length
      ? sorted.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join('')
      : '<tr><td colspan="2" style="color:var(--text-dim);">No failures in this window.</td></tr>');
  card.appendChild(table);
  return card;
}

function renderActivityCard(rows, appId) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Activity</h2>
    <div class="def">DAU (solid) vs WAU (dashed, repeats across each week — a step, not a daily figure) + new users, this app.</div>`;

  const appRows = rows.filter((r) => r.app_id === appId).sort((a, b) => a.day.localeCompare(b.day));
  if (!appRows.length) {
    card.innerHTML += '<div class="placeholder">No activity in this window.</div>';
    return card;
  }
  const categories = appRows.map((r) => r.day);
  card.appendChild(lineChart(categories, [
    { label: 'DAU', color: '#4f8cff', values: appRows.map((r) => r.dau) },
    { label: 'WAU', color: '#9aa3b2', dashed: true, values: appRows.map((r) => r.wau) },
  ]));

  const latest = appRows[appRows.length - 1];
  const totalNew = appRows.reduce((a, r) => a + (r.new_users || 0), 0);
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value">${latest.dau ?? '—'}</div><div class="label">DAU (latest day)</div></div>
    <div class="metric"><div class="value">${latest.wau ?? '—'}</div><div class="label">WAU (current week)</div></div>
    <div class="metric"><div class="value">${totalNew}</div><div class="label">new users, this window</div></div>`;
  card.appendChild(row);
  return card;
}

function renderDataHealthCard(rows, appId) {
  const card = document.createElement('div');
  card.className = 'card wide';
  card.innerHTML = `<h2>Data health</h2>
    <div class="def">Daily event volume + queue_dropped (client-side buffer overflow before a batch could flush) — the dashboard's own instrument panel; a sudden drop to near-zero is the first sign of a pipeline outage, not a quiet day.</div>`;

  const appRows = rows.filter((r) => r.app_id === appId).sort((a, b) => a.day.localeCompare(b.day));
  if (!appRows.length) {
    card.innerHTML += '<div class="placeholder">No events in this window.</div>';
    return card;
  }
  const categories = appRows.map((r) => r.day);
  card.appendChild(groupedBarChart(categories, [
    { label: 'events', color: '#4f8cff', values: appRows.map((r) => r.event_count) },
  ], { labelEvery: Math.max(1, Math.ceil(categories.length / 10)) }));

  const totalEvents = appRows.reduce((a, r) => a + (r.event_count || 0), 0);
  const totalDropped = appRows.reduce((a, r) => a + (r.queue_dropped_total || 0), 0);
  const dropRate = pct(totalDropped, totalEvents + totalDropped);
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value">${totalEvents}</div><div class="label">events, this window</div></div>
    <div class="metric"><div class="value ${totalDropped > 0 ? 'warn' : 'ok'}">${totalDropped}</div><div class="label">queue_dropped, this window</div></div>
    <div class="metric"><div class="value ${dropRate != null && dropRate > 1 ? 'bad' : ''}">${fmtPct(dropRate)}</div><div class="label">drop rate</div></div>`;
  card.appendChild(row);
  return card;
}

// ---------------------------------------------------- Tab 2 (engine) ----

function fmtBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}

function renderClassificationCard(rows) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Classification failure rate</h2>
    <div class="def">v_classification_failure_daily. Baseline is 0 across the whole table at authoring time — alert threshold is fallback_rate &gt; 1%, sustained 15min (see the PLAN-0814 runbook for the actual alert wiring; this card is the same number, just graphed).</div>`;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  if (!sorted.length) {
    card.innerHTML += '<div class="placeholder">No classification data in this window.</div>';
    return card;
  }
  const categories = sorted.map((r) => r.day);
  card.appendChild(lineChart(categories, [
    { label: 'fallback_rate', color: '#e35d5d', values: sorted.map((r) => r.fallback_rate == null ? null : r.fallback_rate * 100) },
  ]));
  const latest = sorted[sorted.length - 1];
  const latestRate = latest.fallback_rate == null ? null : Math.round(latest.fallback_rate * 1000) / 10;
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value ${latestRate != null && latestRate > 1 ? 'bad' : 'ok'}">${fmtPct(latestRate)}</div><div class="label">latest day fallback_rate</div></div>
    <div class="metric"><div class="value dim">${latest.attempted ?? 0}</div><div class="label">attempted, latest day</div></div>`;
  card.appendChild(row);
  return card;
}

function renderExtractionCard(rows) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Extraction failure / abandonment</h2>
    <div class="def">v_extraction_retry_daily. abandoned is a terminal give-up state, shown as its own number below — never folded into retry_rate as an average.</div>`;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  if (!sorted.length) {
    card.innerHTML += '<div class="placeholder">No extraction data in this window.</div>';
    return card;
  }
  const categories = sorted.map((r) => r.day);
  card.appendChild(groupedBarChart(categories, [
    { label: 'first_try_success', color: '#3ecf8e', values: sorted.map((r) => r.first_try_success) },
    { label: 'retried', color: '#e0a634', values: sorted.map((r) => r.retried) },
  ], { labelEvery: Math.max(1, Math.ceil(categories.length / 8)) }));
  const totalAbandoned = sorted.reduce((a, r) => a + (r.abandoned || 0), 0);
  const totalRetried = sorted.reduce((a, r) => a + (r.retried || 0), 0);
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value ${totalAbandoned > 0 ? 'bad' : 'ok'}">${totalAbandoned}</div><div class="label">abandoned, this window (terminal — always alert on this)</div></div>
    <div class="metric"><div class="value dim">${totalRetried}</div><div class="label">retried, this window</div></div>`;
  card.appendChild(row);
  return card;
}

function renderStorageCard(rows) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Per-user storage trend</h2>
    <div class="def">v_storage_growth_daily. Empty until snapshot_storage_daily() has run at least once — confirm pg_cron is actually enabled in TC_MEM before assuming "no growth" (the runbook flags 025's schedule as a silent no-op otherwise).</div>`;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  if (!sorted.length) {
    card.innerHTML += '<div class="placeholder banner info">No rows yet — either no growth, or snapshot_storage_daily() / pg_cron has never run. Check the runbook before assuming the former.</div>';
    return card;
  }
  const categories = sorted.map((r) => r.day);
  card.appendChild(lineChart(categories, [
    { label: 'avg_bytes_per_user', color: '#4f8cff', values: sorted.map((r) => r.avg_bytes_per_user) },
  ]));
  const latest = sorted[sorted.length - 1];
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric"><div class="value">${fmtBytes(latest.avg_bytes_per_user)}</div><div class="label">avg / user, latest day</div></div>
    <div class="metric"><div class="value dim">${fmtBytes(latest.total_bytes)}</div><div class="label">total, latest day</div></div>
    <div class="metric"><div class="value dim">${latest.users_with_data ?? 0}</div><div class="label">users with data</div></div>`;
  card.appendChild(row);
  return card;
}

function renderUsageCard(rows) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>LLM call volume</h2>
    <div class="def">v_usage_calls_daily. One row per (day, endpoint) — summed to a daily total for the chart below; per-endpoint breakdown in the table.</div>`;
  if (!rows.length) {
    card.innerHTML += '<div class="placeholder">No usage data in this window.</div>';
    return card;
  }
  const byDay = groupSum(rows, (r) => r.day, 'calls');
  const days = Array.from(byDay.keys()).sort();
  card.appendChild(groupedBarChart(days, [
    { label: 'calls', color: '#4f8cff', values: days.map((d) => byDay.get(d)) },
  ], { labelEvery: Math.max(1, Math.ceil(days.length / 8)) }));

  const byEndpoint = groupSum(rows, (r) => r.endpoint, 'calls');
  const sortedEndpoints = Array.from(byEndpoint.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const table = document.createElement('table');
  table.className = 'breakdown';
  table.innerHTML = '<tr><th>endpoint</th><th>calls, this window</th></tr>' +
    sortedEndpoints.map(([ep, calls]) => `<tr><td>${escapeHtml(ep)}</td><td>${calls}</td></tr>`).join('');
  card.appendChild(table);
  return card;
}

function renderCostCard(llmCost) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>LLM cost (estimate)</h2>
    <div class="def">v_llm_cost_daily_estimate. A point estimate built on an owner-maintained price sheet, not measured token spend — never rendered as $0.00 for an unpriced endpoint.</div>`;
  const rows = (llmCost && llmCost.rows) || [];
  if (!rows.length) {
    card.innerHTML += '<div class="placeholder">No call volume in this window.</div>';
    return card;
  }
  if (!llmCost.any_priced) {
    card.innerHTML += '<div class="banner info">llm_price_sheet is empty — every endpoint is unpriced. Call volume is real (see LLM call volume card); cost cannot be estimated until someone who owns the price basis populates the sheet.</div>';
    return card;
  }
  const byDay = new Map();
  rows.forEach((r) => {
    if (!r.priced) return;
    byDay.set(r.day, (byDay.get(r.day) || 0) + (r.estimated_cost_usd || 0));
  });
  const days = Array.from(byDay.keys()).sort();
  card.appendChild(groupedBarChart(days, [
    { label: 'estimated_cost_usd', color: '#3ecf8e', values: days.map((d) => byDay.get(d)) },
  ], { labelEvery: Math.max(1, Math.ceil(days.length / 8)) }));

  const unpricedEndpoints = new Set(rows.filter((r) => !r.priced).map((r) => r.endpoint));
  const totalCost = days.reduce((a, d) => a + byDay.get(d), 0);
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `<div class="metric"><div class="value ok">$${totalCost.toFixed(2)}</div><div class="label">estimated, this window (priced endpoints only)</div></div>`;
  card.appendChild(row);
  if (unpricedEndpoints.size) {
    const warn = document.createElement('div');
    warn.className = 'banner info';
    warn.textContent = 'Still unpriced, excluded from the total above: ' + Array.from(unpricedEndpoints).join(', ');
    card.appendChild(warn);
  }
  return card;
}

function renderGcpLinkCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>p95 latency / health hit-rate</h2>
    <div class="def">Native GCP metrics — deliberately not rebuilt here (§3.3). As of this dashboard's last update, both are flagged "not yet set up" in the PLAN-0814 runbook: someone with gcloud access still needs to run the two dashboard-creation commands there.</div>
    <p style="margin:12px 0;"><a href="https://console.cloud.google.com/monitoring/dashboards?project=tikcare-d0cb9" target="_blank" rel="noopener">Open GCP Monitoring — tikcare-d0cb9 ↗</a></p>
    <p style="color:var(--text-dim);font-size:12px;">See docs/PLAN-0814-monitoring-runbook.md (tikcare-memory repo) §Metric #4/#5 for the exact <code>gcloud monitoring dashboards create</code> commands.</p>`;
  return card;
}

function renderEngineTab() {
  const grid = document.getElementById('engine-grid');
  grid.innerHTML = '';
  if (!currentEngineData) return;
  grid.appendChild(renderClassificationCard(currentEngineData.classification_failure || []));
  grid.appendChild(renderExtractionCard(currentEngineData.extraction_retry || []));
  grid.appendChild(renderStorageCard(currentEngineData.storage_growth || []));
  grid.appendChild(renderUsageCard(currentEngineData.usage_calls || []));
  grid.appendChild(renderCostCard(currentEngineData.llm_cost || { rows: [], any_priced: false }));
  grid.appendChild(renderGcpLinkCard());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------- Render -----

let currentEventsData = null;
let currentAppId = null;
let currentEngineData = null;

function renderProductTab() {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '';
  if (!currentEventsData) return;

  grid.appendChild(renderRetentionCard(currentEventsData.retention || []));
  grid.appendChild(renderScanFunnelCard(currentEventsData.scan_funnel || [], currentAppId));
  grid.appendChild(renderActivityCard(currentEventsData.dau || [], currentAppId));
  grid.appendChild(renderDataHealthCard(currentEventsData.event_health || [], currentAppId));
}

function renderAppSwitcher() {
  const el = document.getElementById('app-switcher');
  el.innerHTML = '';
  const apps = distinctAppIds(currentEventsData);
  if (!apps.length) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">No app_id found in this window\'s data.</span>';
    return;
  }
  if (!apps.includes(currentAppId)) currentAppId = apps[0];
  apps.forEach((appId) => {
    const btn = document.createElement('button');
    btn.textContent = appId;
    btn.className = appId === currentAppId ? 'active' : '';
    btn.addEventListener('click', () => {
      currentAppId = appId;
      renderAppSwitcher();
      renderProductTab();
    });
    el.appendChild(btn);
  });
}

function showBanner(msg, kind) {
  const el = document.getElementById('global-banner');
  if (!msg) { el.innerHTML = ''; return; }
  const div = document.createElement('div');
  div.className = 'banner ' + (kind || 'info');
  div.textContent = msg;
  el.innerHTML = '';
  el.appendChild(div);
}

// --------------------------------------------------------------- Tabs -----

document.getElementById('tab-btn-product').addEventListener('click', () => {
  document.getElementById('tab-btn-product').classList.add('active');
  document.getElementById('tab-btn-engine').classList.remove('active');
  document.getElementById('tab-product').style.display = 'block';
  document.getElementById('tab-engine').style.display = 'none';
});
document.getElementById('tab-btn-engine').addEventListener('click', () => {
  document.getElementById('tab-btn-engine').classList.add('active');
  document.getElementById('tab-btn-product').classList.remove('active');
  document.getElementById('tab-engine').style.display = 'block';
  document.getElementById('tab-product').style.display = 'none';
});

// --------------------------------------------------------------- Boot -----

async function boot() {
  const cfg = loadConfig();
  if (!cfg) { showGate(null); return; }

  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('header-sub').textContent = 'Loading last 90 days…';
  showBanner(null);

  // Both tabs fetch on boot rather than lazily-on-click: the acceptance
  // criteria (§3.4) is answering three questions -- one per tab -- inside
  // 10 seconds of opening the link, which a first click-triggered fetch
  // would eat into.
  const [eventsResult, engineResult] = await Promise.allSettled([
    fetchStats(cfg.eventsUrl, cfg.key, 90),
    fetchStats(cfg.engineUrl, cfg.key, 90),
  ]);

  if (eventsResult.status === 'rejected' && eventsResult.reason && eventsResult.reason.authFailure) {
    showGate('Access key was rejected — check the key and try again.');
    return;
  }

  const bannerParts = [];

  if (eventsResult.status === 'fulfilled') {
    currentEventsData = eventsResult.value;
    if (currentEventsData.errors) {
      bannerParts.push('Product behavior: some views failed to load (' +
        Object.keys(currentEventsData.errors).join(', ') + ')');
    }
    renderAppSwitcher();
    renderProductTab();
  } else {
    document.getElementById('product-grid').innerHTML = '';
    bannerParts.push('Failed to load dashboard-stats-events: ' + eventsResult.reason.message);
  }

  if (engineResult.status === 'fulfilled') {
    currentEngineData = engineResult.value;
    if (currentEngineData.errors) {
      bannerParts.push('Engine health: some views failed to load (' +
        Object.keys(currentEngineData.errors).join(', ') + ')');
    }
    renderEngineTab();
  } else {
    document.getElementById('engine-grid').innerHTML = '';
    bannerParts.push('Failed to load dashboard-stats-engine: ' + engineResult.reason.message);
  }

  document.getElementById('header-sub').textContent =
    `Window: last 90 days · updated ${new Date().toLocaleString()}`;
  showBanner(bannerParts.length ? bannerParts.join(' · ') + ' — see dashboard/functions/README.md.' : null, 'error');
}

boot();
